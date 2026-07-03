#!/usr/bin/env node
/**
 * dev-proxy.mjs — tiny CORS proxy for local dev.
 *
 * Usage:  node dev-proxy.mjs
 *         Companion endpoint → http://localhost:8011/v1/chat/completions
 *
 * Forwards requests to https://your-gateway.example.com with CORS headers added.
 */
import http from 'node:http';
import https from 'node:https';

const TARGET = 'your-gateway.example.com';
const PORT = 8011;

function proxy(req, res) {
  // CORS headers
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
    res.end(`Proxy error: ${err.message}`);
  });

  req.pipe(upstream);
}

http.createServer(proxy).listen(PORT, () => {
  console.log(`CORS proxy → https://${TARGET}  |  http://localhost:${PORT}`);
});
