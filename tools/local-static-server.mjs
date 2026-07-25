#!/usr/bin/env node
/**
 * tools/local-static-server.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase E1: a dependency-light local static
 * file server for everyday development on a Windows PC, no build step,
 * no external package beyond Node's own built-in http/fs/path modules.
 *
 * Default: http://localhost:4173/?qa=1
 *
 * Requirements met:
 *   - correct MIME types for .js/.mjs/.json/images (and the handful of
 *     other extensions this project actually uses)
 *   - project-root containment: every resolved path is verified to
 *     stay inside PROJECT_ROOT after resolution -- a request for
 *     "/../../etc/passwd" (or any encoded/traversal variant) is
 *     rejected with 403, never served
 *   - no directory traversal
 *   - a clear console message printing the exact URL to open
 *   - Ctrl+C (SIGINT) cleanup: closes the server and exits cleanly
 *
 * This server exists ONLY for local human/manual verification in a
 * real desktop browser -- it is NOT used by any Playwright suite in
 * this project (those all use the Navigation-Free In-Memory Harness,
 * qa/helpers/playwright-lumixa-test-runtime.mjs, which never spawns a
 * real network server or navigates to localhost).
 *
 * Run: node tools/local-static-server.mjs [port]
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 4173;

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

/**
 * Resolves a request path against PROJECT_ROOT and verifies the result
 * is still contained within PROJECT_ROOT (fails closed on any
 * traversal attempt -- ../, encoded variants, absolute-path overrides,
 * null bytes, etc.). Returns null when containment cannot be proven.
 */
export function resolveContainedPath(requestUrl, projectRoot = PROJECT_ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestUrl.split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding -- reject, never guess
  }
  if (decoded.includes('\0')) return null; // reject embedded NUL bytes outright
  const urlPath = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(projectRoot, `.${urlPath}`);
  const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
  if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) {
    return null; // escaped project root -- reject
  }
  return resolved;
}

export function startLocalStaticServer({ port = DEFAULT_PORT, projectRoot = PROJECT_ROOT, quiet = false } = {}) {
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
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const url = `http://localhost:${port}/?qa=1`;
      if (!quiet) {
        console.log(`LUMIXA local-first dev server running.`);
        console.log(`Open: ${url}`);
        console.log('Press Ctrl+C to stop.');
      }
      const cleanup = () => {
        if (!quiet) console.log('\nShutting down local-first dev server...');
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      resolve({ server, url, port, cleanup });
    });
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const portArg = Number(process.argv[2]);
  const port = Number.isFinite(portArg) && portArg > 0 ? portArg : DEFAULT_PORT;
  startLocalStaticServer({ port });
}
