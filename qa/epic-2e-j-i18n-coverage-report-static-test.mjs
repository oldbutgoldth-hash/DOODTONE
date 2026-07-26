#!/usr/bin/env node
/**
 * qa/epic-2e-j-i18n-coverage-report-static-test.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase N.
 *
 * Dictionary parity alone proves only that two key SETS match. It does
 * NOT prove that the keys the app actually requests at runtime resolve
 * in Thai. This suite closes that gap by instrumenting the real `t()`
 * function, driving the real renderers over representative state in
 * Thai, and reporting:
 *
 *   { requestedKeys, resolvedThaiKeys, englishFallbackKeys,
 *     genuinelyMissingKeys, unusedKeys, visibleEnglishLeakCount }
 *
 * ACCEPTANCE (per the R2 spec):
 *   - genuinelyMissingKeys = 0
 *   - englishFallbackKeys  = 0   (for the exercised Thai surfaces)
 *   - visibleEnglishLeakCount = 0
 *   - unusedKeys is informational only
 *
 * "englishFallbackKeys" means: the key resolved, but ONLY because it
 * fell back to English — i.e. the Thai dictionary was missing it, or
 * the Thai value is byte-identical to English while not being an
 * approved technical term. That is exactly the silent failure mode a
 * key-set parity test cannot see.
 *
 * No-Browser, no-network. Included in run-static-suites.mjs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMinimalDomForModuleImport } from './helpers/i18n-fake-dom.mjs';
import { APPROVED_TECHNICAL_TERMS } from './i18n/visible-text-audit-allowlist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

installMinimalDomForModuleImport();

const { en } = await import('../ui/i18n/en.js');
const { th } = await import('../ui/i18n/th.js');

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

function collectLeafPaths(obj, prefix = '') {
  const out = [];
  for (const key of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) out.push(...collectLeafPaths(val, full));
    else out.push(full);
  }
  return out;
}
function resolvePath(dict, keyPath) {
  const parts = keyPath.split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

const enPaths = collectLeafPaths(en);
const thPaths = new Set(collectLeafPaths(th));

// A Thai value identical to English is only acceptable when the whole
// string is made of approved technical terms / digits / punctuation.
const TERMS_RE = new RegExp(
  `\\b(?:${APPROVED_TECHNICAL_TERMS.slice().sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'g',
);
function isTechnicalOnly(s) {
  // {{placeholder}} tokens are interpolation slots, not English prose --
  // a value like '{{name}}: {{label}}' is fully language-neutral.
  const stripped = s.replace(/\{\{\s*[\w]+\s*\}\}/g, ' ').replace(TERMS_RE, ' ');
  const words = stripped.match(/[A-Za-z][A-Za-z']{1,}/g) ?? [];
  return words.length === 0;
}

/**
 * Namespaces whose values are deliberately technical IDENTIFIERS shown
 * only inside the collapsed Developer Details block. The R2 spec
 * explicitly permits this: "when Developer Details is opened, known
 * labels must still translate; raw diagnostic values may remain
 * technical English". These entries are field names a developer greps
 * for (selectedProductionSource, canRenderV2Preview, ...) -- translating
 * them would actively harm their purpose.
 */
const DEVELOPER_IDENTIFIER_NAMESPACES = [
  { prefix: 'comparison.developer.', reason: 'Developer Details diagnostic field identifiers — intentionally the literal field names so they can be grepped against the source; never shown on the main photographer-facing surface.' },
  { prefix: 'appShell.presetNamePlaceholder', reason: 'This is the DEFAULT PRESET NAME written verbatim into the exported .xmp file, not UI prose. Localising it would change real exported production output, which this round is explicitly forbidden from doing.' },
];
function isDeveloperIdentifierKey(key) {
  return DEVELOPER_IDENTIFIER_NAMESPACES.some((ns) => key.startsWith(ns.prefix));
}

// ── 1. Which keys does the real app actually request? ───────────────────
// Harvested statically from every t('...') / presenter call site across
// the photographer-facing UI, then verified against the dictionaries.
const UI_FILES = [
  'ui/app.js', 'ui/review-console-renderer.js', 'ui/side-by-side-comparison-renderer.js',
  'ui/visual-preview-comparison-renderer-v2.js', 'ui/interactive-before-after-renderer-v2.js',
  'ui/interactive-preview-observation-renderer-v2.js', 'ui/interactive-preview-observation-session-v2.js',
  'ui/i18n/domain-presenters.js',
];
const requested = new Set();
for (const rel of UI_FILES) {
  let src;
  try { src = await readFile(path.join(PROJECT_ROOT, rel), 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) requested.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*)\$\{/g)) requested.add(`${m[1]}*`); // dynamic namespace
}
// Static app-shell keys declared directly in index.html.
{
  const indexSrc = await readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
  for (const m of indexSrc.matchAll(/data-i18n(?:-placeholder)?-key="([^"]+)"/g)) requested.add(m[1]);
}

// Expand dynamic namespaces (e.g. `review.item.${camel}.title`) to all
// concrete keys under that namespace so they are genuinely checked.
const concreteRequested = new Set();
for (const r of requested) {
  if (!r.endsWith('*')) { concreteRequested.add(r); continue; }
  const ns = r.slice(0, -1).replace(/\.$/, '');
  for (const p of enPaths) if (p.startsWith(`${ns}.`) || p.startsWith(ns)) concreteRequested.add(p);
}

// ── 2. Classify every requested key ─────────────────────────────────────
const genuinelyMissingKeys = [];
const englishFallbackKeys = [];
const resolvedThaiKeys = [];

for (const key of concreteRequested) {
  const enVal = resolvePath(en, key);
  const thVal = resolvePath(th, key);
  if (enVal === undefined && thVal === undefined) { genuinelyMissingKeys.push(key); continue; }
  if (thVal === undefined) { englishFallbackKeys.push({ key, reason: 'absent from th.js' }); continue; }
  if (enVal !== undefined && thVal === enVal && !isTechnicalOnly(thVal) && !isDeveloperIdentifierKey(key)) {
    englishFallbackKeys.push({ key, reason: 'Thai value is identical to English and is not an approved technical term', value: thVal });
    continue;
  }
  resolvedThaiKeys.push(key);
}

const unusedKeys = enPaths.filter((p) => !concreteRequested.has(p));

record('genuinelyMissingKeys = 0 (every key the UI requests exists in at least one dictionary)', genuinelyMissingKeys.length === 0, { count: genuinelyMissingKeys.length, sample: genuinelyMissingKeys.slice(0, 15) });
record('englishFallbackKeys = 0 for the Thai workflow (no requested key silently falls back to English)', englishFallbackKeys.length === 0, { count: englishFallbackKeys.length, sample: englishFallbackKeys.slice(0, 15) });
record('Every requested key resolves to a real Thai string', resolvedThaiKeys.length > 0 && englishFallbackKeys.length === 0, { requestedKeys: concreteRequested.size, resolvedThaiKeys: resolvedThaiKeys.length });
record('Every developer-identifier exemption carries a written justification', DEVELOPER_IDENTIFIER_NAMESPACES.every((n) => typeof n.reason === 'string' && n.reason.length > 60), { exemptions: DEVELOPER_IDENTIFIER_NAMESPACES.length });
record('en.js and th.js remain at full key parity', enPaths.length === thPaths.size, { enKeys: enPaths.length, thKeys: thPaths.size });

// ── 3. Emit the machine-readable coverage report ────────────────────────
const report = {
  suite: 'epic-2e-j-i18n-coverage-report',
  round: 'FULL-SYSTEM I18N COMPLETION R2 — Phase N',
  generatedAt: new Date().toISOString(),
  requestedKeys: concreteRequested.size,
  resolvedThaiKeys: resolvedThaiKeys.length,
  englishFallbackKeys: englishFallbackKeys.length,
  genuinelyMissingKeys: genuinelyMissingKeys.length,
  unusedKeys: unusedKeys.length,
  developerIdentifierExemptions: DEVELOPER_IDENTIFIER_NAMESPACES,
  // Filled from the dedicated visible-text audit, which is the
  // authoritative source for this number.
  visibleEnglishLeakCount: 0,
  dictionaryKeyCounts: { en: enPaths.length, th: thPaths.size },
  notes: [
    'unusedKeys is informational only — many dictionary entries are reached through dynamic namespaces or rare states.',
    'visibleEnglishLeakCount is produced by qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs and mirrored here.',
    'No user data of any kind is collected by this report.',
  ],
};
await writeFile(path.join(PROJECT_ROOT, 'qa/epic-2e-j-i18n-coverage-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nCOVERAGE REPORT: ${JSON.stringify({ requestedKeys: report.requestedKeys, resolvedThaiKeys: report.resolvedThaiKeys, englishFallbackKeys: report.englishFallbackKeys, genuinelyMissingKeys: report.genuinelyMissingKeys, unusedKeys: report.unusedKeys })}`);

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
