#!/usr/bin/env node
/**
 * qa/playwright-in-memory-app-static-test.mjs
 *
 * EPIC 2E-J — ENV-B1B PART 11: proves the Navigation-Free In-Memory
 * Browser Harness (qa/helpers/playwright-in-memory-app.mjs) is correct
 * even when Playwright itself is unavailable — every check here either
 * calls the helper's real exported functions directly against synthetic
 * snippets and the real project files, or audits the source text of the
 * two new harness files plus confirms Production files are left
 * byte-identical after a full in-memory build.
 *
 * Run: node qa/playwright-in-memory-app-static-test.mjs
 * Output: qa/playwright-in-memory-app-static-results.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanCodeMask,
  classifyModuleSpecifier,
  resolveModuleSpecifierToProjectPath,
  rewriteModuleSource,
  buildModuleGraph,
  buildInMemoryApp,
  toEvidenceSummary,
  toCanonicalId,
  CANONICAL_ORIGIN,
} from './helpers/playwright-in-memory-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${pass ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

function hashFile(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// ══════════════════════════════════════════════════════════════════
// 1. Import scanner distinguishes code from comments/strings.
// ══════════════════════════════════════════════════════════════════
{
  const snippet = [
    "// import { x } from './a.js'; -- a comment mention, not real code",
    "/** @param {import('../b.js').T} p -- JSDoc mention, not real code */",
    "const s = \"this string mentions import { y } from './c.js'; but is not code\";",
    "import { real } from './d.js';",
  ].join('\n');
  const mask = scanCodeMask(snippet);
  const importDIdx = snippet.indexOf("import { real }");
  const commentImportIdx = snippet.indexOf("import { x }");
  const jsdocImportIdx = snippet.indexOf("import('../b.js')");
  const stringImportIdx = snippet.indexOf("import { y }");
  record(
    '1. scanCodeMask marks the real import statement as code, and the comment/JSDoc/string mentions as non-code',
    mask[importDIdx] === 1 && mask[commentImportIdx] === 0 && mask[jsdocImportIdx] === 0 && mask[stringImportIdx] === 0,
    `real=${mask[importDIdx]}, comment=${mask[commentImportIdx]}, jsdoc=${mask[jsdocImportIdx]}, string=${mask[stringImportIdx]}`
  );
}
{
  // A real import immediately preceded by a comment mention on the line
  // above, with NO semicolon in between — the classic "swallowed match"
  // failure mode this harness specifically guards against.
  const snippet = "// Does not import from or modify anything.\nimport { real2 } from './e.js';\n";
  const { edges, rejected } = rewriteModuleSource(snippet, '', toCanonicalId);
  record(
    '1b. a real import statement is still correctly found even when an earlier same-line-terminator-free comment also contains the word "import ... from"',
    edges.length === 1 && edges[0].projectRelativePath === 'e.js',
    JSON.stringify({ edges, rejected })
  );
}

// ══════════════════════════════════════════════════════════════════
// 2/3. Static import rewrite + side-effect import rewrite.
// ══════════════════════════════════════════════════════════════════
{
  const snippet = "import Foo, { bar, baz as qux } from './x.js';\nimport * as ns from '../y.js';\n";
  const { rewrittenSource, edges } = rewriteModuleSource(snippet, 'ui', toCanonicalId);
  const expectA = `${CANONICAL_ORIGIN}/ui/x.js`;
  const expectB = `${CANONICAL_ORIGIN}/y.js`;
  record(
    '2. static "import ... from" specifiers (default+named, namespace) are rewritten to canonical IDs, quotes preserved',
    rewrittenSource.includes(`from '${expectA}'`) && rewrittenSource.includes(`from '${expectB}'`) && edges.length === 2,
    rewrittenSource
  );
}
{
  const snippet = "import './side-effect.js';\n";
  const { rewrittenSource, edges } = rewriteModuleSource(snippet, 'ui', toCanonicalId);
  const expect = `${CANONICAL_ORIGIN}/ui/side-effect.js`;
  record(
    '3. side-effect "import \'...\';" (no clause, no "from") is rewritten to its canonical ID',
    rewrittenSource.includes(`'${expect}'`) && edges.length === 1 && edges[0].context === 'side-effect-import',
    rewrittenSource
  );
}

// ══════════════════════════════════════════════════════════════════
// 4. export-from rewrite (named, star, star-as).
// ══════════════════════════════════════════════════════════════════
{
  const snippet = "export { a, b } from './re1.js';\nexport * from './re2.js';\nexport * as ns from './re3.js';\n";
  const { rewrittenSource, edges } = rewriteModuleSource(snippet, 'core', toCanonicalId);
  record(
    '4. export-from forms (named, *, * as ns) all rewrite their specifiers to canonical IDs',
    edges.length === 3 && edges.every((e) => e.projectRelativePath.startsWith('core/re')),
    rewrittenSource
  );
}

// ══════════════════════════════════════════════════════════════════
// 5/6. Literal dynamic import rewrite + non-literal dynamic import
// honestly rejected.
// ══════════════════════════════════════════════════════════════════
{
  const snippet = "import('./core/project-version.js').then(() => {});\n";
  const { rewrittenSource, edges } = rewriteModuleSource(snippet, '', toCanonicalId);
  const expect = `${CANONICAL_ORIGIN}/core/project-version.js`;
  record(
    '5. a literal dynamic import(\'...\') is rewritten to its canonical ID',
    rewrittenSource.includes(`import('${expect}')`) && edges.length === 1 && edges[0].context === 'dynamic-import-literal',
    rewrittenSource
  );
}
{
  const snippet = "const path = './' + name + '.js';\nimport(path).then(() => {});\n";
  const { rewrittenSource, edges, rejected } = rewriteModuleSource(snippet, '', toCanonicalId);
  record(
    '6. a non-literal dynamic import (a variable, not a single string literal) is honestly rejected, never rewritten or guessed at',
    edges.length === 0 && rejected.length === 1 && rejected[0].context === 'dynamic-import' && /non-literal/.test(rejected[0].reason) && rewrittenSource === snippet,
    JSON.stringify({ edges, rejected })
  );
}
{
  const snippet = "import('./a.js' + '.js').then(() => {});\n"; // concatenation — also non-literal
  const { edges, rejected } = rewriteModuleSource(snippet, '', toCanonicalId);
  record(
    '6b. a concatenated dynamic import argument is also rejected as non-literal (not just a bare variable)',
    edges.length === 0 && rejected.length === 1 && /non-literal/.test(rejected[0].reason),
    JSON.stringify({ edges, rejected })
  );
}

// ══════════════════════════════════════════════════════════════════
// 7/8. Traversal + outside-root rejection.
// ══════════════════════════════════════════════════════════════════
{
  // Importer directory is the project root ('') for the two relative-
  // traversal cases, so a single ".." unambiguously escapes the root
  // regardless of how many ".." segments follow — with a deeper importer
  // directory, enough ".." segments can legitimately cancel out to a
  // normal in-root path (e.g. 3 levels up from a 3-deep importer lands
  // back at the root, which is not an escape) — that is correct
  // behavior, not a bug, so it must not be conflated with a real escape
  // attempt here.
  const cases = [
    { snippet: "import x from '../../../etc/passwd';", importerDir: '' },
    { snippet: "import x from '../outside.js';", importerDir: '' },
    { snippet: "import x from 'C:\\\\windows\\\\evil.js';", importerDir: 'ui' },
    { snippet: "import x from 'node:fs';", importerDir: 'ui' },
    { snippet: "import x from 'left-pad';", importerDir: 'ui' },
    { snippet: "import x from 'https://evil.example.com/x.js';", importerDir: 'ui' },
  ];
  const outcomes = cases.map(({ snippet, importerDir }) => {
    const { edges, rejected } = rewriteModuleSource(snippet, importerDir, toCanonicalId);
    return { snippet, edges, rejected };
  });
  const allRejected = outcomes.every((o) => o.edges.length === 0 && o.rejected.length === 1);
  record(
    '7/8. traversal, backslash, node:, bare-package, and absolute-URL specifiers are all honestly rejected (never rewritten, never silently dropped without a reason)',
    allRejected,
    JSON.stringify(outcomes.map((o) => ({ snippet: o.snippet, rejectedReason: o.rejected[0] && o.rejected[0].reason })))
  );
}
{
  const direct = resolveModuleSpecifierToProjectPath('../../../../outside.js', 'ui');
  const rootAbsolute = resolveModuleSpecifierToProjectPath('/core/histogram-engine/index.js', 'anything/deep');
  record(
    '7b. resolveModuleSpecifierToProjectPath rejects escape-the-root relative paths and correctly resolves root-absolute ("/core/...") paths regardless of importer depth',
    direct.ok === false && rootAbsolute.ok === true && rootAbsolute.projectRelativePath === 'core/histogram-engine/index.js',
    JSON.stringify({ direct, rootAbsolute })
  );
}

// ══════════════════════════════════════════════════════════════════
// 9. Duplicate canonical ID rejection / dedup.
// ══════════════════════════════════════════════════════════════════
{
  // Two different importers both reference the same shared module —
  // this must produce ONE module-graph entry (module reuse), not a
  // duplicate. buildModuleGraph is exercised directly against the real
  // project, where core/histogram-engine/index.js is imported by both
  // ui/app.js and (indirectly reachable) other files.
  const graph = await buildModuleGraph({ projectRoot: PROJECT_ROOT, entryProjectRelativePaths: ['ui/app.js'] });
  const histogramEdges = graph.edgesAll.filter((e) => e.projectRelativePath === 'core/histogram-engine/index.js');
  record(
    '9. a module imported from multiple places is stored once in the graph (module reuse, not a duplicate), with zero duplicateCanonicalIds reported',
    graph.moduleMap.has('core/histogram-engine/index.js') && graph.duplicateCanonicalIds.length === 0,
    `duplicateCanonicalIds=${JSON.stringify(graph.duplicateCanonicalIds)}, histogramEdgeReferences=${histogramEdges.length}`
  );
}

// ══════════════════════════════════════════════════════════════════
// 10/11. HTML Import Map ordering — built from the real project.
// ══════════════════════════════════════════════════════════════════
let app;
let appBuildError = null;
try {
  app = await buildInMemoryApp(PROJECT_ROOT);
} catch (e) {
  appBuildError = String((e && e.stack) || e);
}
record('The real project builds successfully into an in-memory app (no exception)', !!app && !appBuildError, appBuildError || `moduleCount=${app ? app.moduleGraph.moduleMap.size : 'n/a'}`);

if (app) {
  const html = app.html;
  const importMapIdx = html.indexOf('<script type="importmap">');
  const firstOtherModuleScriptIdx = html.indexOf('<script type="module">');
  record(
    '10. the Import Map <script type="importmap"> appears before the first <script type="module"> tag',
    importMapIdx !== -1 && firstOtherModuleScriptIdx !== -1 && importMapIdx < firstOtherModuleScriptIdx,
    `importMapIdx=${importMapIdx}, firstModuleScriptIdx=${firstOtherModuleScriptIdx}`
  );
  record(
    '11. no <script type="module" src="...​"> tag remains in the document (the ui/app.js entry was converted to an inline canonical import)',
    !/<script\s+type="module"\s+src=/.test(html),
    `present=${/<script\s+type="module"\s+src=/.test(html)}`
  );
  record(
    '11b. the app.js entry point is present as an inline canonical import',
    html.includes(`import "${CANONICAL_ORIGIN}/ui/app.js";`),
    'checked'
  );
  let importMapJson = null;
  let importMapParseOk = false;
  try {
    const raw = html.slice(importMapIdx).match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
    importMapJson = JSON.parse(raw);
    importMapParseOk = true;
  } catch (e) {
    importMapParseOk = false;
  }
  record('The Import Map is valid, parseable JSON with an "imports" object', importMapParseOk && importMapJson && typeof importMapJson.imports === 'object', importMapParseOk ? `${Object.keys(importMapJson.imports).length} entries` : 'parse failed');
  const allValuesAreDataUrls = importMapParseOk && Object.values(importMapJson.imports).every((v) => typeof v === 'string' && v.startsWith('data:text/javascript;base64,'));
  record('Every Import Map value is a data:text/javascript;base64,... URL (never a network URL)', allValuesAreDataUrls, 'checked');
  const allKeysAreCanonical = importMapParseOk && Object.keys(importMapJson.imports).every((k) => k.startsWith(`${CANONICAL_ORIGIN}/`));
  record(`Every Import Map key is a canonical ${CANONICAL_ORIGIN}/... identifier (never navigated to)`, allKeysAreCanonical, 'checked');

  const evidence = toEvidenceSummary(app);
  record('toEvidenceSummary() never includes full module source text or data: URLs (Part 10 redaction requirement)', JSON.stringify(evidence).indexOf('data:text/javascript;base64,') === -1 && JSON.stringify(evidence).indexOf('function analyzeImage') === -1, `evidenceKeys=${Object.keys(evidence).join(',')}`);
  record('Google Fonts network dependency is fully removed from the in-memory document', !/fonts\.googleapis\.com/.test(html) && !/fonts\.gstatic\.com/.test(html), 'checked');
  record('fontFallbackUsed is derived from an actual removed-link count, not a hardcoded literal disconnected from any check', evidence.fontFallbackUsed === true && app.removedFontLinkCount > 0, `fontFallbackUsed=${evidence.fontFallbackUsed}, removedFontLinkCount=${app.removedFontLinkCount}`);
}

// ══════════════════════════════════════════════════════════════════
// Production immutability — building the in-memory app must never
// write to, or otherwise mutate, any real project file.
// ══════════════════════════════════════════════════════════════════
{
  const filesToCheck = ['index.html', 'ui/app.js', 'core/histogram-engine/index.js', 'core/lightroom-mapping-engine/index.js', 'core/xmp-validator/index.js'];
  const before = {};
  for (const f of filesToCheck) before[f] = hashFile(await readFile(path.join(PROJECT_ROOT, f)));
  await buildInMemoryApp(PROJECT_ROOT); // build again — must be side-effect-free on disk
  const after = {};
  for (const f of filesToCheck) after[f] = hashFile(await readFile(path.join(PROJECT_ROOT, f)));
  const allUnchanged = filesToCheck.every((f) => before[f] === after[f]);
  record('12/19/20. Building the in-memory app twice never modifies index.html, ui/app.js, or any Core/Mapping/XMP file on disk (Production, Mapping, and XMP remain byte-identical)', allUnchanged, JSON.stringify({ before, after }));
}

// ══════════════════════════════════════════════════════════════════
// Source-text audits of the two new harness files.
// ══════════════════════════════════════════════════════════════════
let helperSrc = '';
let smokeSrc = '';
try {
  helperSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'helpers', 'playwright-in-memory-app.mjs'), 'utf8');
  record('qa/helpers/playwright-in-memory-app.mjs is readable', true, `${helperSrc.length} bytes`);
} catch (e) {
  record('qa/helpers/playwright-in-memory-app.mjs is readable', false, String((e && e.message) || e));
}
try {
  smokeSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke.mjs'), 'utf8');
  record('qa/playwright-in-memory-app-smoke.mjs is readable', true, `${smokeSrc.length} bytes`);
} catch (e) {
  record('qa/playwright-in-memory-app-smoke.mjs is readable', false, String((e && e.message) || e));
}
{
  const neverImportsPlaywright = !/from\s+['"]playwright['"]/.test(helperSrc) && !/import\(['"]playwright['"]\)/.test(helperSrc);
  record('The in-memory app helper never imports "playwright" itself — statically testable even when the package is unavailable', neverImportsPlaywright, `present=${neverImportsPlaywright}`);
}
{
  const helperNeverWrites = !/writeFile/.test(helperSrc) && !/createWriteStream/.test(helperSrc) && !/fs\.write/.test(helperSrc);
  record('The in-memory app helper never writes to disk (read-only: readFile only) — cannot mutate Production/Mapping/XMP files', helperNeverWrites, `present=${helperNeverWrites}`);
}
{
  const constructsLocalServer = /http\.createServer/.test(smokeSrc) || /http\.createServer/.test(helperSrc) || /\.listen\(\s*\d/.test(smokeSrc) || /\.listen\(\s*\d/.test(helperSrc);
  record('12. no local HTTP server is constructed anywhere in this harness (no http.createServer / .listen(port))', !constructsLocalServer, `constructsLocalServer=${constructsLocalServer}`);
}
{
  const gotoCalls = [...smokeSrc.matchAll(/page\.goto\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  const onlyAboutBlank = gotoCalls.length > 0 && gotoCalls.every((arg) => arg === 'ABOUT_BLANK_URL');
  record('13. page.goto() is never called with anything except the ABOUT_BLANK_URL constant ("about:blank?qa=1") — no virtual-origin, localhost, file:, or data: navigation anywhere in this harness', onlyAboutBlank, `gotoCalls=${JSON.stringify(gotoCalls)}`);
}
{
  const usesSetContent = /page\.setContent\(/.test(smokeSrc);
  record('The smoke test loads the application via page.setContent(), not via any Browser navigation', usesSetContent, `present=${usesSetContent}`);
}
{
  const usesServiceWorkersBlock = smokeSrc.includes("serviceWorkers: 'block'");
  const usesRequiredLaunchArgs = /args:\s*\[\s*'--no-sandbox'\s*,\s*'--disable-dev-shm-usage'\s*\]/.test(smokeSrc);
  record('The smoke test creates its BrowserContext with serviceWorkers: "block" and launches Chromium with the required sandbox args', usesServiceWorkersBlock && usesRequiredLaunchArgs, `serviceWorkersBlock=${usesServiceWorkersBlock}, launchArgs=${usesRequiredLaunchArgs}`);
}
{
  const neverDownloadsBrowser = !/playwright install/.test(smokeSrc) && !/npx playwright/.test(smokeSrc);
  record('The smoke test never attempts to download a Browser', neverDownloadsBrowser, `present=${neverDownloadsBrowser}`);
}
{
  const doesNotModifyVirtualOriginHelper = !helperSrc.includes('installLumixaVirtualOrigin') && !smokeSrc.includes('installLumixaVirtualOrigin');
  record('This new harness does not modify or depend on the existing Virtual-Origin helper\'s routing installer (kept separate per spec)', doesNotModifyVirtualOriginHelper, `present=${doesNotModifyVirtualOriginHelper}`);
}
{
  const reusesPathSafety = helperSrc.includes("from './playwright-virtual-origin.mjs'") && helperSrc.includes('resolveSafeLocalPath');
  record('The in-memory app helper reuses the existing Virtual-Origin helper\'s proven path-safety primitives (resolveSafeLocalPath) rather than re-implementing traversal defenses from scratch', reusesPathSafety, `present=${reusesPathSafety}`);
}
{
  const recordCallsSmoke = [...smokeSrc.matchAll(/record\(\s*(['"`])(?:(?!\1)[\s\S])*?\1\s*,\s*([^,]+),/g)];
  const stringResultRe = /^'(PASS|FAIL|NOT_TESTED)'$/;
  const ternaryResultRe = /\?\s*'(PASS|FAIL|NOT_TESTED)'\s*:\s*'(PASS|FAIL|NOT_TESTED)'/;
  const offenders = recordCallsSmoke.map((m) => m[2].trim()).filter((arg) => !stringResultRe.test(arg) && !ternaryResultRe.test(arg));
  record('Every record() call in the new smoke test passes a PASS/FAIL/NOT_TESTED string (learned from the ENV-B1A-R Part 12 fix — never repeat the boolean-record bug in new code)', recordCallsSmoke.length > 0 && offenders.length === 0, `totalRecordCalls=${recordCallsSmoke.length}, offenders=${JSON.stringify(offenders)}`);
}
{
  const filterUsesFailString = /results\.filter\(\s*\(r\)\s*=>\s*r\.result\s*===\s*'FAIL'\s*\)/.test(smokeSrc);
  record('The final-decision computation filters on the string \'FAIL\'', filterUsesFailString, `present=${filterUsesFailString}`);
}
{
  const doesNotRegenerateExistingResults = !/epic-2e-j-phase-c-step7b-b-results\.json/.test(smokeSrc) && !/epic-2e-j-phase-c-final-results\.json/.test(smokeSrc) && !/epic-2e-j-phase-c-step7b-b-results\.json/.test(helperSrc) && !/epic-2e-j-phase-c-final-results\.json/.test(helperSrc);
  record('17/18. Neither new file ever references or regenerates the existing Browser results file or the Final Phase C results file', doesNotRegenerateExistingResults, `present=${doesNotRegenerateExistingResults}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
const output = {
  suite: 'EPIC 2E-J ENV-B1B PART 11 — In-Memory App Harness static/functional self-test',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  disclaimer: 'This suite calls the helper\'s real exported functions directly against synthetic snippets and the real project files, and audits both new harness files\' source text plus Production-file hash immutability. It does not launch a Browser and proves nothing about actual Playwright/Chromium runtime behavior — that is the separate runtime smoke test\'s job.',
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
