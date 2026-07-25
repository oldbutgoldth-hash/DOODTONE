#!/usr/bin/env node
/**
 * tools/local-static-server.mjs
 *
 * LOCAL-FIRST LAN-CAPABLE DEV SERVER.
 *
 * Defaults:
 *   host: 127.0.0.1
 *   port: 4173
 *
 * Overrides:
 *   CLI:  node tools/local-static-server.mjs [port] [host]
 *   ENV:  PORT=3000 HOST=0.0.0.0 node tools/local-static-server.mjs
 *
 * Use `npm run dev:lan` for the user's current LAN workflow:
 *   http://<computer-ip>:3000/?qa=1
 */

import http from 'node:http';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 4173;
const DEFAULT_HOST = '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function resolveContainedPath(requestUrl, projectRoot = PROJECT_ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestUrl.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const urlPath = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(projectRoot, `.${urlPath}`);
  const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
  if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

export function listLanIpv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const records of Object.values(networkInterfaces ?? {})) {
    for (const record of records ?? []) {
      if (record && record.family === 'IPv4' && record.internal !== true && typeof record.address === 'string') {
        addresses.push(record.address);
      }
    }
  }
  return [...new Set(addresses)].sort();
}

export function startLocalStaticServer({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  projectRoot = PROJECT_ROOT,
  quiet = false,
} = {}) {
  const server = http.createServer(async (req, res) => {
    const resolved = resolveContainedPath(req.url ?? '/', projectRoot);
    if (!resolved) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden — request path escapes the project root or is malformed.');
      return;
    }
    try {
      const st = await stat(resolved);
      if (!st.isFile()) throw new Error('not a regular file');
      const data = await readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store, max-age=0',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const localHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      const localUrl = `http://${localHost}:${port}/?qa=1`;
      const lanUrls = (host === '0.0.0.0' || host === '::')
        ? listLanIpv4Addresses().map((ip) => `http://${ip}:${port}/?qa=1`)
        : [];
      if (!quiet) {
        console.log('LUMIXA local-first dev server running.');
        console.log(`Local: ${localUrl}`);
        for (const url of lanUrls) console.log(`LAN:   ${url}`);
        console.log('Press Ctrl+C to stop.');
      }
      let closing = false;
      const cleanup = () => {
        if (closing) return;
        closing = true;
        if (!quiet) console.log('\nShutting down local-first dev server...');
        server.close(() => process.exit(0));
      };
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
      resolve({ server, localUrl, lanUrls, port, host, cleanup });
    });
  });
}

const isMainModule = (() => {
  try { return import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href; } catch { return false; }
})();

if (isMainModule) {
  const portArg = Number(process.argv[2] ?? process.env.PORT);
  const port = Number.isFinite(portArg) && portArg > 0 && portArg <= 65535 ? portArg : DEFAULT_PORT;
  const hostArg = process.argv[3] ?? process.env.HOST ?? DEFAULT_HOST;
  const host = typeof hostArg === 'string' && hostArg.trim() ? hostArg.trim() : DEFAULT_HOST;
  startLocalStaticServer({ port, host }).catch((err) => {
    console.error(`Local server failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
