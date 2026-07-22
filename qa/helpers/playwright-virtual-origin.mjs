/**
 * qa/helpers/playwright-virtual-origin.mjs
 *
 * EPIC 2E-J — ENV-B1A-R: a reusable Playwright BrowserContext routing
 * helper that serves this project's own files under a stable virtual
 * origin (http://lumixa.test) instead of any local HTTP server or
 * localhost/127.0.0.1 address. This module is ENVIRONMENT HARNESS ONLY
 * — it never imports 'playwright' itself (it only operates on an
 * already-created BrowserContext passed in by the caller), so its pure
 * helper functions (path safety, MIME mapping, origin/external
 * classification) can be statically imported and unit-tested even in
 * an environment where the Playwright Node package or a Browser binary
 * is unavailable.
 *
 * SECURITY: `resolveSafeLocalPath` / `classifyRequestPath` are the
 * single source of truth for path safety. They reject (never merely
 * "clean") on: literal `..` traversal segments, `%2e%2e`/double- and
 * triple-encoded traversal, any backslash (literal or encoded, e.g.
 * `%5c`), Windows drive-letter prefixes (`C:` / `C:\`), and any null
 * byte (literal or `%00`) at any decode depth. A final containment
 * check re-verifies the fully resolved absolute path is still inside
 * `projectRoot` before any file is ever read from disk — defense in
 * depth even if the earlier string-level checks had a gap.
 *
 * No external network fallback: every request that is not (a) under
 * the virtual origin, (b) fonts.googleapis.com, or (c) fonts.gstatic.com
 * is recorded and aborted — never forwarded to the real network.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ── Part 5 — MIME types ──────────────────────────────────────────────
export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xmp': 'application/rdf+xml',
  '.wasm': 'application/wasm',
};
export const DEFAULT_MIME_TYPE = 'application/octet-stream';

/** Maps a file extension (e.g. '.html', case-insensitive) to its MIME type; unknown extensions fall back to application/octet-stream. */
export function getMimeType(ext) {
  if (typeof ext !== 'string') return DEFAULT_MIME_TYPE;
  return MIME_TYPES[ext.toLowerCase()] ?? DEFAULT_MIME_TYPE;
}

// ── Part 4 — safe local file routing ─────────────────────────────────

/**
 * Fully decodes a percent-encoded string, repeatedly, so double- or
 * triple-encoded traversal sequences (e.g. `%252e%252e` -> `%2e%2e` ->
 * `..`) cannot survive a single-pass decode. Returns `null` on
 * malformed percent-encoding (never throws). Capped at 6 iterations —
 * genuinely legitimate paths never require anywhere near that many
 * decode passes, so hitting the cap is itself treated as suspicious by
 * the caller (the final iteration's value is still returned, and the
 * caller's own traversal/null-byte checks still apply to it).
 */
export function decodeFullyOrNull(input) {
  if (typeof input !== 'string') return null;
  let current = input;
  for (let i = 0; i < 6; i++) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return next;
    current = next;
  }
  return current;
}

/**
 * Classifies a raw URL pathname (no query string, no origin) as either
 * a safe project-relative path or a rejected one. Never touches the
 * filesystem — pure string/path logic only.
 * @returns {{ok:true, relativePath:string}|{ok:false, reason:string}}
 */
export function classifyRequestPath(rawPathname) {
  if (typeof rawPathname !== 'string' || rawPathname.length === 0) {
    return { ok: false, reason: 'empty or non-string path' };
  }
  if (rawPathname.includes('\0')) return { ok: false, reason: 'raw null byte in request path' };

  const decoded = decodeFullyOrNull(rawPathname);
  if (decoded === null) return { ok: false, reason: 'malformed percent-encoding' };
  if (decoded.includes('\0') || /%00/i.test(decoded)) return { ok: false, reason: 'null byte present after decoding' };
  if (decoded.includes('\\')) return { ok: false, reason: 'backslash (literal or encoded) rejected' };

  let relative = decoded.replace(/^\/+/, '');
  if (relative === '') relative = 'index.html'; // "/" maps to index.html

  // Windows drive-letter prefix (e.g. "C:" or "C:\") rejected outright.
  if (/^[a-zA-Z]:/.test(relative)) return { ok: false, reason: 'Windows drive-letter prefix rejected' };
  // Any ".." path segment anywhere — before normalization, so a
  // normalize()-only check can never be tricked by a segment that
  // normalize() would otherwise silently resolve away.
  if (/(^|\/)\.\.(\/|$)/.test(relative)) return { ok: false, reason: 'parent-directory traversal segment rejected' };

  const normalized = path.posix.normalize(relative);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    return { ok: false, reason: 'normalized path escapes project root' };
  }
  return { ok: true, relativePath: normalized };
}

/**
 * Resolves a raw URL pathname to an absolute on-disk path strictly
 * inside `projectRoot`, or a rejection reason. Performs a SECOND,
 * independent containment check on the fully resolved absolute path
 * (defense in depth) — never trusts the string-level classification
 * alone before touching the filesystem.
 * @returns {{ok:true, filePath:string}|{ok:false, reason:string}}
 */
export function resolveSafeLocalPath(projectRoot, rawPathname) {
  const classified = classifyRequestPath(rawPathname);
  if (!classified.ok) return { ok: false, reason: classified.reason };

  const rootResolved = path.resolve(typeof projectRoot === 'string' ? projectRoot : process.cwd());
  const candidate = path.resolve(rootResolved, classified.relativePath);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate !== rootResolved && !candidate.startsWith(rootWithSep)) {
    return { ok: false, reason: 'resolved path escapes projectRoot (defense-in-depth containment check)' };
  }
  return { ok: true, filePath: candidate };
}

// ── Part 3/6 — origin and external-request classification ───────────

/** True when `url` is a request under the given virtual origin (e.g. "http://lumixa.test"). */
export function isVirtualOriginRequest(url, origin) {
  if (typeof url !== 'string' || typeof origin !== 'string') return false;
  return url === origin || url.startsWith(`${origin}/`) || url.startsWith(`${origin}?`);
}

/** True for any fonts.googleapis.com stylesheet request (offline stub target). */
export function isGoogleFontsStylesheetRequest(url) {
  return typeof url === 'string' && /^https:\/\/fonts\.googleapis\.com\//.test(url);
}

/** True for any fonts.gstatic.com font-asset request (offline stub target). */
export function isGoogleFontsAssetRequest(url) {
  return typeof url === 'string' && /^https:\/\/fonts\.gstatic\.com\//.test(url);
}

/** True for genuinely unexpected external network targets — anything that is neither the virtual origin nor a recognized Google Fonts host. Never true for the virtual origin or the two Google Fonts hosts. */
export function isUnexpectedExternalRequest(url, origin) {
  if (typeof url !== 'string') return false;
  if (isVirtualOriginRequest(url, origin)) return false;
  if (isGoogleFontsStylesheetRequest(url) || isGoogleFontsAssetRequest(url)) return false;
  return /^https?:\/\//.test(url);
}

/** True for any localhost/127.0.0.1/private-IP-looking target — this harness must never navigate to or request one. */
export function isLocalhostOrPrivateIpRequest(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)([:/]|$)/i.test(url);
}

// ── Installer ─────────────────────────────────────────────────────────

/**
 * Installs virtual-origin routing on a Playwright BrowserContext (or
 * Page — anything with a `.route(pattern, handler)` method). Never
 * imports 'playwright' itself; the caller supplies an already-created
 * context. A single universal `**\/*` handler classifies and dispatches
 * every request — deliberately NOT multiple separately-registered
 * `context.route()` calls, since Playwright matches routes in
 * most-recently-registered-first order and a broad catch-all
 * registered after specific patterns would shadow them.
 *
 * @param {{ route: (pattern: string, handler: (route: any) => Promise<void>) => Promise<void> }} context
 * @param {{ projectRoot: string, origin?: string }} options
 * @returns {Promise<{ externalRequestLog: string[], localRequestLog: Array<{url:string, status:number}>, fontFallbackUsed: boolean }>}
 */
export async function installLumixaVirtualOrigin(context, options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const projectRoot = typeof opts.projectRoot === 'string' ? opts.projectRoot : process.cwd();
  const origin = typeof opts.origin === 'string' ? opts.origin : 'http://lumixa.test';

  const state = {
    externalRequestLog: [],
    localRequestLog: [],
    fontFallbackUsed: false,
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = typeof request.method === 'function' ? request.method() : 'GET';

    if (isVirtualOriginRequest(url, origin)) {
      let pathname;
      try {
        pathname = new URL(url).pathname;
      } catch {
        await route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: 'Forbidden: unparsable URL' });
        state.localRequestLog.push({ url, status: 403 });
        return;
      }
      const resolved = resolveSafeLocalPath(projectRoot, pathname);
      if (!resolved.ok) {
        await route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: `Forbidden: ${resolved.reason}` });
        state.localRequestLog.push({ url, status: 403 });
        return;
      }
      let data;
      try {
        data = await readFile(resolved.filePath);
      } catch {
        await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not Found' });
        state.localRequestLog.push({ url, status: 404 });
        return;
      }
      const contentType = getMimeType(path.extname(resolved.filePath));
      if (method === 'HEAD') {
        await route.fulfill({ status: 200, contentType, headers: { 'content-length': String(data.length) }, body: '' });
      } else {
        await route.fulfill({ status: 200, contentType, body: data });
      }
      state.localRequestLog.push({ url, status: 200 });
      return;
    }

    if (isGoogleFontsStylesheetRequest(url)) {
      state.fontFallbackUsed = true;
      await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '/* offline stub: fonts.googleapis.com is intentionally unreachable in this sandbox */' });
      return;
    }
    if (isGoogleFontsAssetRequest(url)) {
      state.fontFallbackUsed = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    // Anything else — recorded, then aborted. Never forwarded to the
    // real network, regardless of host.
    state.externalRequestLog.push(url);
    await route.abort('blockedbyclient');
  });

  return state;
}
