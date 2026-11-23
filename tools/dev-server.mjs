// Local preview server: serves ./docs and reloads the browser when a file changes.
// Usage: node tools/dev-server.mjs   (PORT=4173 by default)
import http from 'node:http';
import { createReadStream, watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const reloadSnippet = "<script>new EventSource('/__reload').onmessage = () => location.reload();</script>";
const clients = new Set();

let timer;
watch(root, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const res of clients) res.write('data: reload\n\n');
  }, 100);
});

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }

    try {
      if ((await stat(file)).isDirectory()) {
        res.writeHead(301, { Location: `${url.pathname}/` }).end();
        return;
      }
      const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      if (type.startsWith('text/html')) {
        const html = await readFile(file, 'utf8');
        res.end(html.replace('</body>', `${reloadSnippet}\n</body>`));
      } else {
        createReadStream(file).pipe(res);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}`));
