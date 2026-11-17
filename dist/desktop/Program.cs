using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PiCreator;

internal static class Program
{
    internal static bool SmokeTest;
    internal static readonly string Home = AppContext.BaseDirectory;
    internal static readonly string Local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PiCreator");

    [STAThread]
    static void Main(string[] args)
    {
        SmokeTest = args.Contains("--smoke-test");
        ApplicationConfiguration.Initialize();
        try
        {
            // An instance owns its server and data directory until the window closes.
            Directory.CreateDirectory(Local);
            using var instanceLock = new FileStream(Path.Combine(Home, ".picreator.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            using var window = new MainWindow();
            Application.Run(window);
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(Local, "startup-error.log"), ex.ToString());
            if (!SmokeTest) MessageBox.Show(ex.Message + "\n\nIf another Pi Creator window is open, close it first.\nLogs: " + Local, "Pi Creator", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.ExitCode = 1;
        }
    }
}

internal sealed class MainWindow : Form
{
    readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    readonly Label loading = new() { Text = "Starting Pi Creator?", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    readonly CancellationTokenSource closing = new();
    readonly StringBuilder serverLog = new();
    readonly TaskCompletionSource<string> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly string runtime = Path.Combine(Program.Local, "runtime", Guid.NewGuid().ToString("N"));
    Process? server;
    ProcessJob? job;
    string? origin;
    bool stopping;

    public MainWindow()
    {
        Text = "Pi Creator ? Image Workbench";
        Width = 1400; Height = 950; MinimumSize = new Size(1000, 700);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(browser); Controls.Add(loading);
        Shown += async (_, _) => await StartAsync();
        FormClosed += (_, _) => Stop();
    }

    async Task StartAsync()
    {
        try
        {
            // Unpack embedded Node and source into a private, per-run working folder.
            // Projects/exports are stored outside it and survive cleanup and rebuilds.
            Directory.CreateDirectory(runtime);
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("PiCreator.payload.zip")!)
            using (var zip = new ZipArchive(payload)) zip.ExtractToDirectory(runtime);
            closing.Token.ThrowIfCancellationRequested();
            var storage = Program.SmokeTest ? Path.Combine(runtime, "smoke-storage") : Program.Home;
            Directory.CreateDirectory(Path.Combine(storage, "data"));
            Directory.CreateDirectory(Path.Combine(storage, "exports"));

            // Let the OS choose a free loopback port. Node reports the actual URL.
            var start = new ProcessStartInfo(Path.Combine(runtime, "node.exe"))
            {
                WorkingDirectory = runtime, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.ArgumentList.Add(Path.Combine(runtime, "server.mjs"));
            start.Environment["PORT"] = "0";
            start.Environment["PICREATOR_DATA"] = Path.Combine(storage, "data");
            start.Environment["PICREATOR_EXPORTS"] = Path.Combine(storage, "exports");
            // Do not inherit user Node flags that could change the embedded server.
            start.Environment.Remove("NODE_OPTIONS");
            start.Environment.Remove("NODE_PATH");
            server = new Process { StartInfo = start, EnableRaisingEvents = true };
            server.OutputDataReceived += (_, e) => Record(e.Data);
            server.ErrorDataReceived += (_, e) => Record(e.Data);
            server.Exited += (_, _) =>
            {
                ready.TrySetException(new InvalidOperationException("The local server stopped unexpectedly."));
                if (!stopping && IsHandleCreated) BeginInvoke(() => { if (!stopping) Fail(new InvalidOperationException("The local server stopped. Please reopen Pi Creator.")); });
            };
            job = new ProcessJob();
            server.Start();
            // Windows terminates the child even if the wrapper crashes or is killed.
            job.Assign(server);
            server.BeginOutputReadLine(); server.BeginErrorReadLine();
            origin = await ready.Task.WaitAsync(TimeSpan.FromSeconds(30), closing.Token);
            using (var client = new HttpClient())
                (await client.GetAsync(origin, closing.Token)).EnsureSuccessStatusCode();

            // Evergreen WebView2 is shared with Windows; its writable profile is per user.
            var profile = Program.SmokeTest ? Path.Combine(runtime, "webview") : Path.Combine(Program.Local, "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            closing.Token.ThrowIfCancellationRequested();
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; OpenLink(e.Uri); };
            browser.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (e.Uri == origin + "/" || e.Uri.StartsWith(origin + "/", StringComparison.Ordinal)) return;
                e.Cancel = true; OpenLink(e.Uri);
            };
            // WebView2 provides the usual download/save dialog for JSON and tar archives.
            browser.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess) { Fail(new InvalidOperationException("Unable to display the local app: " + e.WebErrorStatus)); return; }
                loading.Visible = false;
                if (Program.SmokeTest) await SmokeAsync();
            };
            browser.CoreWebView2.Navigate(origin);
        }
        catch (OperationCanceledException) when (stopping) { }
        catch (Exception ex) { if (!stopping) Fail(ex); }
    }

    void Record(string? line)
    {
        if (line == null) return;
        lock (serverLog) serverLog.AppendLine(line);
        var match = Regex.Match(line, @"^Pi Creator: (http://127\.0\.0\.1:\d+)$");
        if (match.Success) ready.TrySetResult(match.Groups[1].Value);
    }

    static void OpenLink(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http")
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    async Task SmokeAsync()
    {
        try
        {
            // Exercise the real packaged WebView, JS modules, server, persistence and export.
            string? report = null;
            for (var i = 0; i < 100; i++)
            {
                report = await browser.ExecuteScriptAsync("document.querySelector('#nav button') !== null");
                if (report == "true") break;
                await Task.Delay(100);
            }
            if (report != "true") throw new Exception("The app did not render its navigation.");
            var result = await browser.ExecuteScriptAsync("""
                (async () => {
                    const { defaults } = await import('/model.js');
                    const config = defaults(); config.ssh.enabled = false;
                    const post = async (url, data) => {
                        const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
                        if (!response.ok) throw Error(await response.text());
                        return response.json();
                    };
                    const saved = await post('/api/projects', {config});
                    const exported = await post('/api/projects/' + saved.id + '/export', {revision:saved.revision});
                    const download = await fetch(exported.download);
                    if (!download.ok || !(await download.arrayBuffer()).byteLength) throw Error('Archive download failed');
                    if (!exported.files.includes('rpi-builder-snapshot.ps1')) throw Error('Snapshot script missing');
                    window.smokeResult = {ok:true,title:document.title,files:exported.files.length,download:exported.download};
                })().catch(error => { window.smokeResult = {ok:false,error:error.message}; });
                """);
            // ExecuteScriptAsync does not await JavaScript promises, so poll the result.
            for (var i = 0; i < 100; i++)
            {
                result = await browser.ExecuteScriptAsync("window.smokeResult || null");
                if (result != "null") break;
                await Task.Delay(100);
            }
            using var parsed = JsonDocument.Parse(result);
            if (!parsed.RootElement.GetProperty("ok").GetBoolean()) throw new Exception(result);
            File.WriteAllText(Path.Combine(Program.Home, "smoke-result.json"), result);
            using var screenshot = File.Create(Path.Combine(Program.Home, "smoke.png"));
            await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, screenshot);
            Close();
        }
        catch (Exception ex) { Fail(ex); }
    }

    void Fail(Exception ex)
    {
        File.WriteAllText(Path.Combine(Program.Local, "startup-error.log"), ex.ToString());
        if (Program.SmokeTest) File.WriteAllText(Path.Combine(Program.Home, "smoke-result.json"), JsonSerializer.Serialize(new { ok = false, error = ex.ToString() }));
        else MessageBox.Show(this, ex.Message + "\n\nLogs: " + Program.Local + "\nWebView2 Runtime: https://developer.microsoft.com/microsoft-edge/webview2/", "Pi Creator", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Environment.ExitCode = 1;
        Close();
    }

    void Stop()
    {
        stopping = true; closing.Cancel();
        browser.Dispose();
        try { if (server is { HasExited: false }) { server.Kill(true); server.WaitForExit(5000); } } catch (InvalidOperationException) { }
        job?.Dispose(); server?.Dispose();
        lock (serverLog) File.WriteAllText(Path.Combine(Program.Local, "server.log"), serverLog.ToString());
        // Only the exact per-run extraction folder is removed, never data or exports.
        try { Directory.Delete(runtime, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        closing.Dispose();
    }
}
