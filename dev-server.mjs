#!/usr/bin/env node
/**
 * dev-server.mjs — static file server + CORS proxy in one process.
 *
 * Usage:  node dev-server.mjs
 *         Open http://localhost:8011 in browser.
 *
 * - Serves static files from current directory (index.html, css/, js/, models/)
 * - Proxies /v1/* requests to https://your-gateway.example.com with CORS headers
 * - No need for `npx serve` or separate terminals
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = 'your-gateway.example.com';
const PORT = 8011;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vrm': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  } catch {
    // fallback to index.html for SPA-style routing
    try {
      const index = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(index);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
}

function proxyToGateway(req, res) {
  // ⚠️ DEV ONLY — TLS verification is disabled for local development.
  // NEVER use this in production. The Authorization header is forwarded
  // in plain text to any MITM attacker when rejectUnauthorized is false.

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const opts = {
    hostname: TARGET,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: TARGET },
    rejectUnauthorized: false,
  };

  const upstream = https.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Gateway unreachable: ${err.message}`);
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  // API requests → proxy to gateway
  if (req.url.startsWith('/v1/')) {
    proxyToGateway(req, res);
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, () => {
  // ⚠️ Refuse to start in production — the proxy has rejectUnauthorized: false
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: dev-server.mjs must not run in production (rejectUnauthorized is disabled).');
    process.exit(1);
  }

  console.log(`\n🔺 OpenAB Companion dev server`);
  console.log(`   http://localhost:${PORT}  ←  open this in your browser`);
  console.log(`   API proxy → https://${TARGET}/v1/*\n`);
});
