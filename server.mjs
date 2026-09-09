#!/usr/bin/env node
/**
 * MJ PDF Viewer — development server
 *
 * A ~60-line static file server with correct MIME types for ES modules,
 * web fonts and PDFs, long-lived caching for fingerprints-free assets is
 * intentionally NOT enabled so edits show up on refresh.
 *
 *   node server.mjs            → http://localhost:8080
 *   PORT=3000 node server.mjs  → custom port
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const ROOT = resolve(new URL('.', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = decodeURIComponent(url.pathname);

  // SPA-style fallback and directory index
  if (path.endsWith('/')) path += 'index.html';
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(ROOT, 'index.html');
  }

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const { size } = statSync(file);

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`MJ PDF Viewer dev server → http://localhost:${PORT}`);
});
