#!/usr/bin/env node
/**
 * A static file server, for looking at what this repository generates.
 *
 * Two things need it and neither can be served any other way here:
 *
 *   - the gallery (`npm run gallery`) is a self-contained HTML file, and a browser will not open
 *     it from `file:` when the tool driving the browser only accepts http(s);
 *   - the render matrix writes screenshots to `render-out/`, which are only useful if you can
 *     flick through them.
 *
 * It is deliberately tiny — no dependencies, no directory listing, no caching headers — because
 * it exists to look at files, not to be a web server. Vite serves the actual example app.
 *
 * Usage: node scripts/serve-static.mjs [dir] [port]
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'render-out'));
const port = Number(process.argv[3] ?? 8017);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

createServer((request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  const path = join(root, normalize(requested).replace(/^([/\\])+/, ''));

  // Never serve outside the directory that was asked for: `..` in a URL is not a feature here.
  if (!path.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  try {
    if (statSync(path).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
  } catch {
    response.writeHead(404).end('not found');
    return;
  }

  response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});
