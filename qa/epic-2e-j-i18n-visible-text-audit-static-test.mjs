#!/usr/bin/env node
/**
 * qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase L.
 *
 * Scans the photographer-facing Renderer/App source for hardcoded
 * visible English, and fails closed when any is found outside the
 * bounded, individually-justified allowlist.
 *
 * WHAT COUNTS AS VISIBLE TEXT (forbidden when English prose):
 *   - el(tag, { text: 'English sentence' })
 *   - .textContent = 'English sentence'
 *   - badge('English', ...) / sectionHeading('English', ...)
 *   - listRow('English', ...) / riskCell('English', ...)
 *   - statusLine(..., { confirmedText: 'English', ... })
 *   - setAttribute('aria-label', 'English sentence')
 *   - local English label maps used for presentation
 *       ({ en: '...', th: '...' } pairs in a renderer)
 *
 * WHAT IS ALLOWED (never reported):
 *   - import paths, internal IDs/codes, CSS strings, comments
 *   - console.* / throw new Error(...) developer diagnostics
 *   - the approved technical-term allowlist (LUMIXA, Legacy, XMP, ...)
 *   - ui/i18n/en.js (the English dictionary is English by definition)
 *   - qa/, tools/, docs/ (not photographer-facing)
 *   - per-file allowlisted strings, each carrying a written reason
 *
 * SELF-TEST: the suite additionally runs its own detector against a
 * hostile in-memory sample containing exactly one visible hardcoded
 * English sentence, and FAILS if the detector does not catch it. A
 * detector that cannot catch a known leak is worthless as a gate.
 *
 * No-Browser, no-network. Included in run-static-suites.mjs.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVED_TECHNICAL_TERMS, FILE_ALLOWLIST, OUT_OF_SCOPE_PATH_PATTERNS, CODE_SUPERSEDED_FILES } from './i18n/visible-text-audit-allowlist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

// Photographer-facing surfaces in scope for this audit.
const SCANNED_FILES = [
  'ui/review-console-renderer.js',
  'ui/side-by-side-comparison-renderer.js',
  'ui/visual-preview-comparison-renderer-v2.js',
  'ui/visual-preview-comparison-controller-v2.js',
  'ui/isolated-visual-preview-renderer-v2.js',
  'ui/interactive-before-after-renderer-v2.js',
  'ui/interactive-preview-observation-renderer-v2.js',
  'ui/interactive-preview-observation-controller-v2.js',
  'ui/interactive-preview-observation-session-v2.js',
  'ui/app.js',
  'ui/ui-engine.js',
];

const TERMS_PATTERN = APPROVED_TECHNICAL_TERMS
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const TERMS_RE = new RegExp(`\\b(?:${TERMS_PATTERN})\\b`, 'g');

/**
 * True when `s` looks like real English PROSE a photographer would
 * read -- as opposed to a code, ID, CSS fragment, or a string made up
 * only of approved technical terms.
 */
export function looksLikeVisibleEnglishProse(s) {
  if (typeof s !== 'string') return false;
  const raw = s.trim();
  if (!raw) return false;

  // Strip approved technical terms, then see what English is left.
  const stripped = raw.replace(TERMS_RE, ' ');

  // Must contain at least two ASCII-alphabetic words of >=2 chars to
  // be prose (single words like 'passed' are codes/labels handled by
  // the code-map rules, not prose).
  const words = stripped.match(/[A-Za-z][A-Za-z']{1,}/g) ?? [];
  if (words.length < 2) return false;

  // Anything containing Thai characters is already localized.
  if (/[฀-๿]/.test(raw)) return false;

  // CSS / style declarations, selectors, urls, paths, mime types.
  if (/[;:]\s*(?:var\(|#[0-9a-f]{3,8}|\d+px|\d+%)/i.test(raw)) return false;
  if (/^(?:[.#]?[\w-]+\s*[:{]|--[\w-]+)/.test(raw)) return false;
  // CSS rule blocks / selector lists, e.g. ".a.b{cursor:ew-resize;user-select:none;}"
  if (/\{[^}]*:[^}]*\}/.test(raw)) return false;
  if (/^[.#]?[\w-]+(?:[.#:][\w-]+)*\s*\{/.test(raw)) return false;
  if (/^(?:https?:|\.{0,2}\/|[\w-]+\/[\w-]+)/.test(raw)) return false;
  if (/^[a-z]+(?:-[a-z0-9]+)+$/.test(raw)) return false;      // kebab-case code
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(raw)) return false;  // camelCase code
  if (/^[A-Z][A-Z0-9_]+$/.test(raw)) return false;            // CONST_CODE
  // Dotted i18n key path, e.g. 'review.risk.skinRisk' -- this is a
  // lookup key handed to t(), never text rendered to a photographer.
  if (/^[a-z][\w]*(?:\.[A-Za-z][\w]*){1,}$/.test(raw)) return false;
  if (/^[\w.-]+\.(?:js|mjs|json|png|css|html)$/i.test(raw)) return false;

  // Style blobs are long but full of ':' and ';' and no sentence.
  const punctuationDensity = (raw.match(/[;:]/g) ?? []).length;
  if (punctuationDensity >= 3 && !/[.!?]/.test(raw)) return false;

  return true;
}

/** Removes comments and console/throw diagnostics so they are never scanned. */
function stripNonVisibleRegions(src) {
  let out = src;
  out = out.replace(/\/\*[\s\S]*?\*\//g, ' ');       // block comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');   // line comments (not "://")
  out = out.replace(/console\s*\.\s*\w+\s*\([\s\S]*?\)\s*;/g, ' ');
  out = out.replace(/throw new \w*Error\s*\([\s\S]*?\)\s*;/g, ' ');
  return out;
}

/** Extracts candidate VISIBLE strings with their construction site. */
function extractVisibleStringCandidates(src) {
  const found = [];
  const push = (kind, text, index) => { if (text) found.push({ kind, text, index }); };
  const S = `'((?:[^'\\\\]|\\\\.)*)'`;   // single-quoted
  const D = `"((?:[^"\\\\]|\\\\.)*)"`;   // double-quoted
  const STR = `(?:${S}|${D})`;

  const patterns = [
    ['text-property', new RegExp(`\\btext\\s*:\\s*${STR}`, 'g')],
    ['textContent', new RegExp(`\\.textContent\\s*=\\s*${STR}`, 'g')],
    ['badge', new RegExp(`\\bbadge\\s*\\(\\s*${STR}`, 'g')],
    ['sectionHeading', new RegExp(`\\bsectionHeading\\s*\\(\\s*${STR}`, 'g')],
    ['listRow', new RegExp(`\\blistRow\\s*\\(\\s*${STR}`, 'g')],
    ['riskCell', new RegExp(`\\briskCell\\s*\\(\\s*${STR}`, 'g')],
    ['confirmedText', new RegExp(`\\bconfirmedText\\s*:\\s*${STR}`, 'g')],
    ['anomalyText', new RegExp(`\\banomalyText\\s*:\\s*${STR}`, 'g')],
    ['unknownText', new RegExp(`\\bunknownText\\s*:\\s*${STR}`, 'g')],
    ['aria-label', new RegExp(`['"]aria-label['"]\\s*[,:]\\s*${STR}`, 'g')],
    ['title-attr', new RegExp(`['"]title['"]\\s*[,:]\\s*${STR}`, 'g')],
    ['placeholder', new RegExp(`['"]placeholder['"]\\s*[,:]\\s*${STR}`, 'g')],
    ['setAnalysisBox', new RegExp(`setAnalysisBox\\s*\\([^,]*,\\s*${STR}`, 'g')],
    ['local-en-map', new RegExp(`\\ben\\s*:\\s*${STR}`, 'g')],
    // Result-object / message-carrying strings. These are the ones
    // that leak English into the UI indirectly: a renderer or
    // controller emits an English sentence inside its result object,
    // and a downstream panel displays it verbatim. Catching only
    // direct DOM calls would score these files a flattering 0.
    ['push-string', new RegExp(`\\.push\\s*\\(\\s*${STR}`, 'g')],
    ['message-prop', new RegExp(`\\b(?:message|summary|reason|warning|label|description|title|note|caption|hint|guidance|blocker)\\s*:\\s*${STR}`, 'g')],
    ['return-string', new RegExp(`\\breturn\\s+${STR}\\s*;`, 'g')],
    ['array-literal-sentence', new RegExp(`(?:\\[|,)\\s*${STR}\\s*(?=,|\\])`, 'g')],
  ];

  for (const [kind, re] of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) push(kind, m[1] ?? m[2], m.index);
  }

  // De-duplicate identical (kind,text) pairs from overlapping patterns.
  const seen = new Set();
  return found.filter((c) => {
    const key = `${c.kind}::${c.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main scan ────────────────────────────────────────────────────────────
const leaksByFile = {};
let totalLeaks = 0;

for (const rel of SCANNED_FILES) {
  if (OUT_OF_SCOPE_PATH_PATTERNS.some((re) => re.test(rel))) continue;
  let src;
  try {
    src = await readFile(path.join(PROJECT_ROOT, rel), 'utf8');
  } catch {
    record(`Scanned file is readable: ${rel}`, false, { rel, readable: false });
    totalLeaks += 1;
    continue;
  }

  // Files whose English text is superseded by a translated stable-code
  // channel are verified separately (see the dedicated check below)
  // rather than string-by-string.
  if (Object.prototype.hasOwnProperty.call(CODE_SUPERSEDED_FILES, rel)) continue;

  const allowedTexts = new Set((FILE_ALLOWLIST[rel] ?? []).map((e) => e.text));
  const stripped = stripNonVisibleRegions(src);
  const candidates = extractVisibleStringCandidates(stripped);

  const fileLeaks = [];
  for (const c of candidates) {
    if (allowedTexts.has(c.text.trim())) continue;
    if (!looksLikeVisibleEnglishProse(c.text)) continue;
    fileLeaks.push({ kind: c.kind, text: c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text });
  }

  if (fileLeaks.length > 0) {
    leaksByFile[rel] = fileLeaks;
    totalLeaks += fileLeaks.length;
  }
}

// ── Code-superseded files: prove the code channel really exists ─────────
{
  const isolatedSrc = await readFile(path.join(PROJECT_ROOT, 'ui/isolated-visual-preview-renderer-v2.js'), 'utf8');
  const controllerSrc = await readFile(path.join(PROJECT_ROOT, 'ui/visual-preview-comparison-controller-v2.js'), 'utf8');
  const rendererSrc = await readFile(path.join(PROJECT_ROOT, 'ui/visual-preview-comparison-renderer-v2.js'), 'utf8');

  record('isolated-visual-preview-renderer-v2.js emits stable warningCodes alongside its English honesty warnings',
    isolatedSrc.includes('const HONESTY_WARNING_CODES = [') && isolatedSrc.includes('warningCodes:'), {});
  record('isolated-visual-preview-renderer-v2.js attaches a reasonCode to its failure/success reasons',
    (isolatedSrc.match(/reasonCodes:/g) ?? []).length >= 20, { reasonCodeSites: (isolatedSrc.match(/reasonCodes:/g) ?? []).length });
  record('visual-preview-comparison-controller-v2.js emits stable blockerCodes alongside its English blockers',
    controllerSrc.includes('const blockerCodes = []') && controllerSrc.includes('blockerCodes,'), {});
  record('The Visual Preview renderer PREFERS the translated codes over the raw English strings',
    rendererSrc.includes('presentLimitationCode') && rendererSrc.includes('presentReasonCode') && rendererSrc.includes('presentBlockerCode')
    && rendererSrc.includes("_safeArray(sideResult?.warningCodes)") && rendererSrc.includes('_safeArray(cs.blockerCodes)'), {});
  record('Every code-superseded file carries a written justification naming the superseding code channel',
    Object.values(CODE_SUPERSEDED_FILES).every((r) => typeof r === 'string' && r.length > 60), {});
}

// ── Report per-file ──────────────────────────────────────────────────────
for (const rel of SCANNED_FILES) {
  if (Object.prototype.hasOwnProperty.call(CODE_SUPERSEDED_FILES, rel)) continue;
  const fileLeaks = leaksByFile[rel] ?? [];
  record(
    `No hardcoded visible English prose in ${rel}`,
    fileLeaks.length === 0,
    fileLeaks.length === 0 ? { leaks: 0 } : { leaks: fileLeaks.length, samples: fileLeaks.slice(0, 8) },
  );
}

record('Total visible English leak count across all scanned photographer-facing files is 0', totalLeaks === 0, { visibleEnglishLeakCount: totalLeaks });

// ── Allowlist hygiene: every entry must carry a real reason ──────────────
{
  let allHaveReasons = true;
  const bad = [];
  for (const [file, entries] of Object.entries(FILE_ALLOWLIST)) {
    for (const e of entries) {
      if (typeof e.reason !== 'string' || e.reason.trim().length < 20) {
        allHaveReasons = false;
        bad.push({ file, text: e.text });
      }
    }
  }
  record('Every allowlist entry carries a written justification of at least 20 characters', allHaveReasons, { badEntries: bad });

  const totalAllowlisted = Object.values(FILE_ALLOWLIST).reduce((n, a) => n + a.length, 0);
  record('The allowlist stays bounded (<= 40 entries) so it can never become a silent escape hatch', totalAllowlisted <= 40, { totalAllowlisted });
}

// ── Hostile self-test: the detector MUST catch a known leak ─────────────
{
  const hostileSample = `
    import { t } from './i18n/index.js';
    function render(container, lang) {
      container.appendChild(el('div', { text: 'Every required check has been completed and passed.' }));
    }
  `;
  const strippedHostile = stripNonVisibleRegions(hostileSample);
  const hostileCandidates = extractVisibleStringCandidates(strippedHostile);
  const hostileLeaks = hostileCandidates.filter((c) => looksLikeVisibleEnglishProse(c.text));
  record('HOSTILE SELF-TEST: the detector catches a sample containing exactly one visible hardcoded English sentence', hostileLeaks.length === 1, { caught: hostileLeaks.map((l) => l.text) });

  // And must NOT flag an already-translated equivalent.
  const cleanSample = `
    container.appendChild(el('div', { text: t('review.summary.allPassed', null, lang) }));
    const code = 'export-path-unchanged';
    const styles = 'display:flex;align-items:center;gap:8px';
  `;
  const cleanCandidates = extractVisibleStringCandidates(stripNonVisibleRegions(cleanSample));
  const cleanLeaks = cleanCandidates.filter((c) => looksLikeVisibleEnglishProse(c.text));
  record('HOSTILE SELF-TEST: the detector does NOT false-positive on t()-sourced text, kebab-case codes, or CSS strings', cleanLeaks.length === 0, { falsePositives: cleanLeaks.map((l) => l.text) });

  // Technical-term-only strings must not be flagged.
  const termsOnly = ['Legacy', 'Controlled V2', 'XMP', 'Identity fallback', 'Adobe Camera Raw'];
  const termFalsePositives = termsOnly.filter((s) => looksLikeVisibleEnglishProse(s));
  record('HOSTILE SELF-TEST: approved technical terms alone are never reported as English leaks', termFalsePositives.length === 0, { termFalsePositives });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
console.log(`visibleEnglishLeakCount=${totalLeaks}`);
if (failCount > 0) process.exit(1);
