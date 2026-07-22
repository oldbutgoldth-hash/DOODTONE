#!/usr/bin/env node
/**
 * qa/playwright-virtual-origin-helper-static-test.mjs
 *
 * EPIC 2E-J — ENV-B1A-R PART 11: proves the reusable Virtual-Origin
 * helper (qa/helpers/playwright-virtual-origin.mjs) is correct even
 * when Playwright itself is unavailable — every check here calls the
 * helper's real, pure exported functions directly (path normalization,
 * traversal rejection, MIME mapping, origin matching, external-host
 * classification, Google Fonts classification), plus a source-text
 * audit of both harness files confirming no localhost/127.0.0.1
 * strings appear in navigation code, no local HTTP server is
 * constructed, and neither file imports 'node:http'.
 *
 * Run: node qa/playwright-virtual-origin-helper-static-test.mjs
 * Output: qa/playwright-virtual-origin-helper-static-results.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMimeType,
  decodeFullyOrNull,
  classifyRequestPath,
  resolveSafeLocalPath,
  isVirtualOriginRequest,
  isGoogleFontsStylesheetRequest,
  isGoogleFontsAssetRequest,
  isUnexpectedExternalRequest,
  isLocalhostOrPrivateIpRequest,
} from './helpers/playwright-virtual-origin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${pass ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

// ══════════════════════════════════════════════════════════════════
// Path normalization + traversal rejection (real function calls).
// ══════════════════════════════════════════════════════════════════
{
  const legit = [
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/ui/app.js', 'ui/app.js'],
    ['/qa/epic-2e-j-phase-c-step7b-b-test.mjs', 'qa/epic-2e-j-phase-c-step7b-b-test.mjs'],
  ];
  const allLegitPass = legit.every(([input, expected]) => {
    const r = classifyRequestPath(input);
    return r.ok === true && r.relativePath === expected;
  });
  record('Path normalization: legitimate paths (including "/" -> index.html) resolve to the expected project-relative path', allLegitPass, JSON.stringify(legit.map(([i]) => classifyRequestPath(i))));
}
{
  const TRAVERSAL_PATHS = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/qa/../../secret.txt',
    '/qa/%2e%2e/%2e%2e/secret.txt',
    '/qa%2f..%2fsecret.txt',
    '/qa%5c..%5csecret.txt',
    '/C:%5csecret.txt',
    '/%00secret.txt',
    '/%252e%252e/secret.txt', // double-encoded traversal
    '/qa/..%2f..%2fsecret.txt',
  ];
  const evidence = TRAVERSAL_PATHS.map((p) => ({ path: p, result: classifyRequestPath(p) }));
  const allRejected = evidence.every((e) => e.result.ok === false);
  record('Traversal rejection: every required traversal path (literal, encoded, double-encoded, backslash, drive-letter, null-byte) is rejected', allRejected, JSON.stringify(evidence));
}
{
  // resolveSafeLocalPath's independent defense-in-depth containment
  // check, exercised directly (never merely trusting classifyRequestPath).
  const safe = resolveSafeLocalPath(PROJECT_ROOT, '/index.html');
  const unsafe = resolveSafeLocalPath(PROJECT_ROOT, '/../../../../etc/passwd');
  const rootResolved = path.resolve(PROJECT_ROOT);
  record('resolveSafeLocalPath: a legitimate path resolves strictly inside projectRoot', safe.ok === true && safe.filePath.startsWith(rootResolved), JSON.stringify(safe));
  record('resolveSafeLocalPath: a traversal attempt is rejected before any filesystem access', unsafe.ok === false, JSON.stringify(unsafe));
}
{
  // decodeFullyOrNull: malformed percent-encoding never throws, degrades to null.
  const malformed = decodeFullyOrNull('%E0%A4%A');
  const doubleEncoded = decodeFullyOrNull('%252e%252e');
  record('decodeFullyOrNull: malformed percent-encoding degrades to null (never throws)', malformed === null, `result=${JSON.stringify(malformed)}`);
  record('decodeFullyOrNull: double-encoded traversal fully decodes to ".."', doubleEncoded === '..', `result=${JSON.stringify(doubleEncoded)}`);
}

// ══════════════════════════════════════════════════════════════════
// MIME mapping.
// ══════════════════════════════════════════════════════════════════
{
  const expected = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8', '.xmp': 'application/rdf+xml', '.wasm': 'application/wasm',
  };
  const allMatch = Object.entries(expected).every(([ext, mime]) => getMimeType(ext) === mime);
  record('MIME mapping: all 13 required extensions map to their exact required MIME type', allMatch, JSON.stringify(Object.keys(expected).map((ext) => ({ ext, got: getMimeType(ext) }))));
  record('MIME mapping: an unknown extension falls back to application/octet-stream', getMimeType('.xyz') === 'application/octet-stream', `got=${getMimeType('.xyz')}`);
  record('MIME mapping: extension matching is case-insensitive', getMimeType('.HTML') === 'text/html; charset=utf-8', `got=${getMimeType('.HTML')}`);
}

// ══════════════════════════════════════════════════════════════════
// Origin matching + external-host / Google Fonts classification.
// ══════════════════════════════════════════════════════════════════
{
  const ORIGIN = 'http://lumixa.test';
  record('Origin matching: the origin root itself matches', isVirtualOriginRequest(ORIGIN, ORIGIN) === true, `url=${ORIGIN}`);
  record('Origin matching: a path under the origin matches', isVirtualOriginRequest(`${ORIGIN}/index.html?qa=1`, ORIGIN) === true, `url=${ORIGIN}/index.html?qa=1`);
  record('Origin matching: a different host does NOT match (e.g. a prefix-confusable host)', isVirtualOriginRequest('http://lumixa.test.evil.com/index.html', ORIGIN) === false, 'url=http://lumixa.test.evil.com/index.html');
  record('Origin matching: localhost never matches the virtual origin', isVirtualOriginRequest('http://localhost:19997/index.html', ORIGIN) === false, 'url=http://localhost:19997/index.html');
}
{
  record('Google Fonts classification: fonts.googleapis.com stylesheet requests are recognized', isGoogleFontsStylesheetRequest('https://fonts.googleapis.com/css2?family=Inter') === true, 'checked');
  record('Google Fonts classification: fonts.gstatic.com asset requests are recognized', isGoogleFontsAssetRequest('https://fonts.gstatic.com/s/inter/v1/font.woff2') === true, 'checked');
  record('Google Fonts classification: an unrelated host is never misclassified as Google Fonts', isGoogleFontsStylesheetRequest('https://evil.example.com/fonts.googleapis.com/x') === false && isGoogleFontsAssetRequest('https://evil.example.com/fonts.gstatic.com/x') === false, 'checked');
}
{
  const ORIGIN = 'http://lumixa.test';
  record('External-host classification: a genuinely external host is flagged unexpected', isUnexpectedExternalRequest('https://example.com/track.js', ORIGIN) === true, 'checked');
  record('External-host classification: the virtual origin itself is never flagged unexpected', isUnexpectedExternalRequest(`${ORIGIN}/ui/app.js`, ORIGIN) === false, 'checked');
  record('External-host classification: Google Fonts hosts are never flagged unexpected (they are stubbed, not aborted-and-logged)', isUnexpectedExternalRequest('https://fonts.googleapis.com/css2', ORIGIN) === false && isUnexpectedExternalRequest('https://fonts.gstatic.com/s/x', ORIGIN) === false, 'checked');
}
{
  record('Localhost/private-IP detection: localhost is flagged', isLocalhostOrPrivateIpRequest('http://localhost:19997/') === true, 'checked');
  record('Localhost/private-IP detection: 127.0.0.1 is flagged', isLocalhostOrPrivateIpRequest('http://127.0.0.1:8080/') === true, 'checked');
  record('Localhost/private-IP detection: a private 192.168.x.x address is flagged', isLocalhostOrPrivateIpRequest('http://192.168.1.5/') === true, 'checked');
  record('Localhost/private-IP detection: the virtual origin itself is never flagged', isLocalhostOrPrivateIpRequest('http://lumixa.test/index.html') === false, 'checked');
}

// ══════════════════════════════════════════════════════════════════
// Source-text audit: no localhost string in navigation code, no local
// HTTP server construction, no node:http import — in EITHER harness file.
// ══════════════════════════════════════════════════════════════════
let helperSrc = '';
let smokeSrc = '';
try {
  helperSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'helpers', 'playwright-virtual-origin.mjs'), 'utf8');
  record('qa/helpers/playwright-virtual-origin.mjs is readable', true, `${helperSrc.length} bytes`);
} catch (e) {
  record('qa/helpers/playwright-virtual-origin.mjs is readable', false, String((e && e.message) || e));
}
try {
  smokeSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-smoke.mjs'), 'utf8');
  record('qa/playwright-virtual-origin-smoke.mjs is readable', true, `${smokeSrc.length} bytes`);
} catch (e) {
  record('qa/playwright-virtual-origin-smoke.mjs is readable', false, String((e && e.message) || e));
}
{
  // "localhost" is permitted to appear ONLY inside the private-IP
  // detection helper/comments (whose entire purpose is to recognize
  // and reject it) — never in the actual navigation target or a
  // constructed server URL.
  const navigatesToLocalhost = /page\.goto\([^)]*localhost/i.test(smokeSrc) || /page\.goto\([^)]*127\.0\.0\.1/i.test(smokeSrc);
  const navUrlIsVirtualOrigin = smokeSrc.includes("const NAV_URL = `${ORIGIN}/index.html?qa=1`;") && smokeSrc.includes("const ORIGIN = 'http://lumixa.test';");
  record('No localhost/127.0.0.1 string is ever used as the navigation target — navigation goes only to the virtual origin', !navigatesToLocalhost && navUrlIsVirtualOrigin, `navigatesToLocalhost=${navigatesToLocalhost}, navUrlIsVirtualOrigin=${navUrlIsVirtualOrigin}`);
}
{
  const constructsLocalServer = /http\.createServer/.test(smokeSrc) || /http\.createServer/.test(helperSrc) || /\.listen\(\s*\d/.test(smokeSrc) || /\.listen\(\s*\d/.test(helperSrc);
  record('No local HTTP server is constructed anywhere in the harness (no http.createServer / .listen(port))', !constructsLocalServer, `constructsLocalServer=${constructsLocalServer}`);
}
{
  const importsNodeHttp = /from\s+['"]node:http['"]/.test(smokeSrc) || /from\s+['"]node:http['"]/.test(helperSrc) || /require\(['"]node:?http['"]\)/.test(smokeSrc) || /require\(['"]node:?http['"]\)/.test(helperSrc);
  record('Neither harness file imports "node:http"', !importsNodeHttp, `importsNodeHttp=${importsNodeHttp}`);
}
{
  const usesVirtualOriginConstant = helperSrc.includes("'http://lumixa.test'") && smokeSrc.includes("'http://lumixa.test'");
  record('Both harness files reference the exact virtual origin "http://lumixa.test"', usesVirtualOriginConstant, `present=${usesVirtualOriginConstant}`);
}
{
  const usesServiceWorkersBlock = smokeSrc.includes("serviceWorkers: 'block'");
  record('The smoke test creates its BrowserContext with serviceWorkers: "block"', usesServiceWorkersBlock, `present=${usesServiceWorkersBlock}`);
}
{
  const singleUniversalRouteHandler = (helperSrc.match(/await context\.route\(/g) || []).length === 1 && helperSrc.includes("await context.route('**/*', async (route) => {");
  record('The helper installs exactly ONE universal route handler (never multiple context.route() calls that could shadow each other via LIFO matching)', singleUniversalRouteHandler, `present=${singleUniversalRouteHandler}`);
}
{
  const neverImportsPlaywright = !/from\s+['"]playwright['"]/.test(helperSrc) && !/import\(['"]playwright['"]\)/.test(helperSrc);
  record('The helper module never imports "playwright" itself (only operates on an already-created context) — statically testable even when the package is unavailable', neverImportsPlaywright, `present=${neverImportsPlaywright}`);
}
{
  const neverDownloadsBrowser = !/playwright install/.test(smokeSrc) && !/npx playwright/.test(smokeSrc);
  record('The smoke test never attempts to download a Browser (no "playwright install" / "npx playwright" invocation)', neverDownloadsBrowser, `present=${neverDownloadsBrowser}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
const output = {
  suite: 'EPIC 2E-J ENV-B1A-R PART 11 — Virtual-Origin helper static/functional self-test',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  disclaimer: 'This suite calls the helper\'s real exported pure functions directly (path safety, MIME mapping, origin/external/Google-Fonts classification) and audits the two harness files\' source text. It does not launch a Browser and proves nothing about actual Playwright/Chromium behavior — that is the separate runtime smoke test\'s job.',
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-helper-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
