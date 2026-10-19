#!/usr/bin/env node
// Minimal local web server for the pre-built application (Node.js built-ins only, no internet needed).
// Usage: node scripts/serve.mjs [port]   → open http://localhost:4173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('The application has not been built yet. Run:  npm install  and then  npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path.includes('..')) {
      res.writeHead(400).end('Bad request');
      return;
    }
    let file = join(root, path || 'index.html');
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = join(root, 'index.html');
    const body = await readFile(file);
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    headers['Cache-Control'] = file.endsWith('sw.js') || file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, headers).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`\nAU Tax & Trading Ledger is running at ${url}`);
  console.log('Your data stays in your browser on this computer. Press Ctrl+C to stop the server.');
  console.log('Tip: after the first visit you can install it as an app and use it offline.\n');
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => undefined);
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Close the other window, or run: node scripts/serve.mjs 4174`);
  else console.error(e);
  process.exit(1);
});
