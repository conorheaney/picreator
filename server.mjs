import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { defaults, validate, normalizeProject } from './public/model.js';
import { generate, tar } from './lib/export.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(process.env.PICREATOR_DATA || path.join(root, 'data'));
const exportRoot = path.resolve(process.env.PICREATOR_EXPORTS || path.join(root, 'exports'));
const publicRoot = path.join(root, 'public');
const idPattern = /^[a-f0-9-]{36}$/;
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw Object.assign(new Error('Project exceeds the 2 MB limit.'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function read(id) {
  if (!idPattern.test(id)) throw Object.assign(new Error('Invalid project ID.'), { status: 400 });
  try { const doc = JSON.parse(await fs.readFile(path.join(data, id, 'project.json'), 'utf8')); doc.config = normalizeProject(doc.config); return doc; } catch (e) { if (e.code === 'ENOENT') throw Object.assign(new Error('Project not found.'), { status: 404 }); throw e; }
}
async function write(id, doc) {
  const dir = path.join(data, id); await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, path.join(dir, 'project.json'));
}
// Serialise writes to prevent lost-update races between browser tabs.
let writes = Promise.resolve();
const mutation = fn => { const task = writes.then(fn); writes = task.catch(() => {}); return task; };
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (![expectedHost, `localhost:${server.address().port}`].includes(req.headers.host)) return json(res, 403, { error: 'Invalid host.' });
    if (req.headers.origin && ![`http://${expectedHost}`, `http://localhost:${server.address().port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
    const url = new URL(req.url, `http://${expectedHost}`), route = url.pathname;
    if (route.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method) && !req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json.' });
      if (route === '/api/projects' && req.method === 'GET') {
        await fs.mkdir(data, { recursive: true });
        const list = [];
        for (const entry of await fs.readdir(data, { withFileTypes: true })) if (entry.isDirectory() && idPattern.test(entry.name)) {
          const doc = await read(entry.name); list.push({ id: entry.name, name: doc.config.project.name, updatedAt: doc.updatedAt, revision: doc.revision });
        }
        return json(res, 200, list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      if (route === '/api/projects' && req.method === 'POST') {
        const input = await body(req), config = normalizeProject(input.config ?? defaults());
        // Drafts may have semantic errors, but malformed imports are rejected.
        const v = validate(config);
        if (v.malformed) return json(res, 400, { error: 'Invalid project format.', validation: v });
        const id = randomUUID(), doc = { config, revision: 1, updatedAt: new Date().toISOString() };
        await mutation(() => write(id, doc));
        return json(res, 201, { id, ...doc });
      }
      const archiveMatch = route.match(/^\/api\/exports\/([a-z][a-z0-9-]{0,47}-(?:[0-9]+-)?[a-f0-9]{8})\.tar\.gz$/);
      if (archiveMatch && req.method === 'GET') {
        const archive = await fs.readFile(path.join(exportRoot, archiveMatch[1] + '.tar.gz')).catch(e => { if (e.code === 'ENOENT') throw Object.assign(new Error('Export not found.'), { status: 404 }); throw e; });
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${archiveMatch[1]}.tar.gz"`, 'Content-Length': archive.length, 'Cache-Control': 'no-store' }); return res.end(archive);
      }
      const match = route.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/(export|download))?$/);
      if (match) {
        const [, id, action] = match;
        if (!action && req.method === 'GET') return json(res, 200, { id, ...await read(id) });
        if (!action && req.method === 'PUT') {
          const input = await body(req);
          return await mutation(async () => {
            const current = await read(id);
            if (input.revision !== current.revision) return json(res, 409, { error: 'This project changed in another window. Download your draft, then reload the saved project.' });
            const v = validate(input.config);
            if (v.malformed) return json(res, 400, { error: 'Invalid project format.', validation: v });
            const doc = { config: normalizeProject(input.config), revision: current.revision + 1, updatedAt: new Date().toISOString() };
            await write(id, doc); return json(res, 200, { id, ...doc });
          });
        }
        if (action === 'export' && req.method === 'POST') {
          const input = await body(req), doc = await read(id);
          if (input.revision !== doc.revision) return json(res, 409, { error: 'Save the latest project before exporting.' });
          const result = generate(doc.config);
          // Reserve a fresh directory; retry a short-ID collision without overwriting exports.
          let folder, dest;
          await fs.mkdir(exportRoot, { recursive: true });
          for (;;) {
            folder = `${doc.config.project.slug}-${randomUUID().slice(0, 8)}`;
            dest = path.join(exportRoot, folder);
            try { await fs.mkdir(dest); break; }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
          }
          for (const [name, file] of Object.entries(result.files)) {
            const target = path.join(dest, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content, { mode: file.mode });
          }
          await fs.writeFile(dest + '.tar.gz', gzipSync(tar(result.files, doc.config.project.slug)), { mode: 0o600 });
          return json(res, 200, { folder: dest, download: `/api/exports/${folder}.tar.gz`, files: Object.keys(result.files) });
        }
        if (action === 'download' && req.method === 'GET') {
          const { config } = await read(id), { files } = generate(config);
          const archive = gzipSync(tar(files, config.project.slug));
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${config.project.slug}.tar.gz"`, 'Content-Length': archive.length, 'Cache-Control': 'no-store' }); return res.end(archive);
        }
      }
      if (route === '/api/preview' && req.method === 'POST') {
        const input = await body(req); return json(res, 200, generate(input.config));
      }
      return json(res, 404, { error: 'API route not found.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const allow = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (!allow[route]) return json(res, 404, { error: 'Not found.' });
    const [file, type] = allow[route]; res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(await fs.readFile(path.join(publicRoot, file)));
  } catch (e) { json(res, e.status || (e.validation ? 422 : 500), { error: e.status || e.validation ? e.message : 'The operation failed. Check the local server console.', ...(e.validation ? { validation: e.validation } : {}) }); if (!e.status && !e.validation) console.error(e.message); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT || 4310), '127.0.0.1', () => console.log(`Pi Creator: http://127.0.0.1:${server.address().port}`));
}
