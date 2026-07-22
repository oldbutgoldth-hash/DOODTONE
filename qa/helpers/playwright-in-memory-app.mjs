/**
 * qa/helpers/playwright-in-memory-app.mjs
 *
 * EPIC 2E-J — ENV-B1B: Navigation-Free In-Memory Browser Harness.
 *
 * This sandbox blocks Browser navigation to any non-"about:" target
 * (net::ERR_BLOCKED_BY_ADMINISTRATOR) — localhost, 127.0.0.1, private
 * IPs, public HTTP/HTTPS hosts, file:, data: navigation, and this
 * project's own virtual origin (http://lumixa.test, see
 * qa/helpers/playwright-virtual-origin.mjs) are all blocked before
 * Playwright route fulfillment. What DOES work: `about:blank?qa=1`
 * navigation, `page.setContent(...)`, inline JavaScript, Import Maps,
 * and `data:` JavaScript modules referenced by an Import Map.
 *
 * This module builds, entirely in memory and from real project files
 * read off disk via Node's `fs` (never via a fetch/Browser request),
 * a self-contained HTML document that:
 *   - preserves the real index.html's DOM structure, IDs, inline CSS,
 *     and inline scripts;
 *   - strips the two Google Fonts <link> tags (the only network
 *     dependency in index.html) — no network is ever contacted;
 *   - discovers the complete local ES module graph reachable from
 *     index.html's module script(s), using a bounded, comment/string-
 *     aware code scanner (never a broad regex-only replacement over
 *     raw, un-scanned source);
 *   - rewrites every local import/export/dynamic-import specifier to a
 *     canonical `https://lumixa.invalid/<project-relative-path>`
 *     identifier (an identifier only — never navigated to or
 *     requested);
 *   - packages every rewritten module as a deterministic
 *     `data:text/javascript;base64,...` URL bound to its canonical ID
 *     via a single `<script type="importmap">`.
 *
 * The resulting document is loaded via `page.setContent(...)` after a
 * single `page.goto('about:blank?qa=1')` — no other navigation target
 * is ever used by this module or its companion smoke test.
 *
 * This module never imports 'playwright' itself (pure Node/fs logic
 * only), so every exported function here is directly unit-testable
 * even when the Playwright package or a Browser binary is unavailable.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  resolveSafeLocalPath,
  classifyRequestPath,
} from './playwright-virtual-origin.mjs';

export const CANONICAL_ORIGIN = 'https://lumixa.invalid';

// ══════════════════════════════════════════════════════════════════
// PART 4 (bounded tokenizer/scanner) — a hand-rolled JS code/comment/
// string/template/regex-literal scanner. Produces a same-length mask
// where mask[i] === 1 means "position i is real executable code" and
// mask[i] === 0 means "position i is inside a // or /* */ comment, or
// inside a plain (non-import-clause) string/template/regex literal
// body". This is what lets the specifier-rewrite regexes below safely
// ignore JSDoc comments like `{@param {import('../x').T}}` and inert
// strings that merely contain the word "import" — the deliberate
// alternative to "a broad unsafe Regex-only replacement" the spec
// calls out.
// ══════════════════════════════════════════════════════════════════
export function scanCodeMask(src) {
  const n = src.length;
  const mask = new Uint8Array(n);
  const modeStack = ['code'];
  const braceDepthStack = [0];
  let i = 0;
  let prevSignificant = '';

  const top = () => modeStack[modeStack.length - 1];

  while (i < n) {
    const mode = top();
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';

    if (mode === 'line-comment') {
      if (c === '\n') modeStack.pop();
      i++;
      continue;
    }
    if (mode === 'block-comment') {
      if (c === '*' && c2 === '/') { modeStack.pop(); i += 2; continue; }
      i++;
      continue;
    }
    if (mode === 'string-single' || mode === 'string-double') {
      const quote = mode === 'string-single' ? "'" : '"';
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { modeStack.pop(); prevSignificant = quote; }
      i++;
      continue;
    }
    if (mode === 'template') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { modeStack.pop(); prevSignificant = '`'; i++; continue; }
      if (c === '$' && c2 === '{') {
        modeStack.push('template-expr');
        braceDepthStack.push(0);
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (mode === 'template-expr') {
      // Inside ${ ... } — this is real code (kept as mask=1 below via
      // the fallthrough), with brace/nested-literal tracking so we know
      // when to pop back to plain template text.
      if (c === '/' && c2 === '/') { modeStack.push('line-comment'); i += 2; continue; }
      if (c === '/' && c2 === '*') { modeStack.push('block-comment'); i += 2; continue; }
      if (c === "'") { modeStack.push('string-single'); i++; continue; }
      if (c === '"') { modeStack.push('string-double'); i++; continue; }
      if (c === '`') { modeStack.push('template'); i++; continue; }
      if (c === '{') { braceDepthStack[braceDepthStack.length - 1]++; mask[i] = 1; i++; continue; }
      if (c === '}') {
        const d = braceDepthStack[braceDepthStack.length - 1];
        if (d === 0) { braceDepthStack.pop(); modeStack.pop(); mask[i] = 1; i++; continue; }
        braceDepthStack[braceDepthStack.length - 1] = d - 1;
        mask[i] = 1;
        i++;
        continue;
      }
      mask[i] = 1;
      if (!/\s/.test(c)) prevSignificant = c;
      i++;
      continue;
    }

    // mode === 'code'
    if (c === '/' && c2 === '/') { modeStack.push('line-comment'); i += 2; continue; }
    if (c === '/' && c2 === '*') { modeStack.push('block-comment'); i += 2; continue; }
    if (c === "'") { modeStack.push('string-single'); i++; continue; }
    if (c === '"') { modeStack.push('string-double'); i++; continue; }
    if (c === '`') { modeStack.push('template'); i++; continue; }
    if (c === '/' && !/[\w$)\]]/.test(prevSignificant)) {
      // Best-effort regex-literal scan so a '/' inside a real regex is
      // never mistaken for a comment start or a division operator.
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        if (src[j] === '[') { inClass = true; j++; continue; }
        if (src[j] === ']') { inClass = false; j++; continue; }
        if (src[j] === '/' && !inClass) { ok = true; j++; break; }
        j++;
      }
      if (ok) { i = j; prevSignificant = '/'; continue; }
      // Not a valid regex literal — fall through, treat '/' as plain code.
    }
    mask[i] = 1;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }

  return mask;
}

// ══════════════════════════════════════════════════════════════════
// PART 3 — module specifier classification (reuses the Virtual-Origin
// helper's own path-safety primitives for the actual filesystem
// containment check, rather than re-implementing traversal defenses).
// ══════════════════════════════════════════════════════════════════
export function classifyModuleSpecifier(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0) {
    return { ok: false, reason: 'empty or non-string module specifier' };
  }
  if (specifier.includes('\0') || /%00/i.test(specifier)) {
    return { ok: false, reason: 'null byte in module specifier' };
  }
  if (specifier.startsWith('node:')) {
    return { ok: false, reason: `node: import not allowed in a Browser module: "${specifier}"` };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(specifier) || specifier.startsWith('//')) {
    return { ok: false, reason: `absolute URL / protocol-relative import not allowed (network-zero contract): "${specifier}"` };
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return { ok: true, kind: 'relative' };
  }
  if (specifier.startsWith('/')) {
    return { ok: true, kind: 'root-absolute' };
  }
  return { ok: false, reason: `bare package import not supported: "${specifier}"` };
}

/** Resolves a module specifier to a project-relative POSIX path, given the importer's own project-relative directory. Rejects traversal/backslash/outside-root. */
export function resolveModuleSpecifierToProjectPath(specifier, importerProjectRelativeDir) {
  const classified = classifyModuleSpecifier(specifier);
  if (!classified.ok) return { ok: false, reason: classified.reason };

  let combined;
  if (classified.kind === 'root-absolute') {
    combined = specifier.replace(/^\/+/, '');
  } else {
    const dir = importerProjectRelativeDir === '' || importerProjectRelativeDir == null ? '.' : importerProjectRelativeDir;
    combined = path.posix.normalize(path.posix.join(dir, specifier));
  }
  if (combined.includes('\\')) return { ok: false, reason: 'backslash in resolved module path rejected' };
  if (combined === '..' || combined.startsWith('../') || combined.startsWith('/') || /^[a-zA-Z]:/.test(combined)) {
    return { ok: false, reason: `module specifier escapes project root: "${specifier}" from "${importerProjectRelativeDir}"` };
  }
  return { ok: true, projectRelativePath: combined };
}

export function toCanonicalId(projectRelativePath) {
  return `${CANONICAL_ORIGIN}/${projectRelativePath}`;
}

// ══════════════════════════════════════════════════════════════════
// Balanced-parenthesis scan for a dynamic import(...) argument, quote-
// aware so a ')' inside a string doesn't prematurely close the scan.
// ══════════════════════════════════════════════════════════════════
function extractBalancedParens(src, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { start: openParenIndex, end: i + 1 };
    }
  }
  return null; // unterminated
}

const LITERAL_STRING_RE = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/d;

// ══════════════════════════════════════════════════════════════════
// PART 4 — rewrite every local import/export-from/literal-dynamic-
// import specifier in a module's source to its canonical
// https://lumixa.invalid/<path> identifier. Non-literal dynamic
// imports, bare/node:/outside-root specifiers are honestly rejected
// (left untouched in the source, recorded with a reason) — never
// silently dropped, never guessed at.
// ══════════════════════════════════════════════════════════════════
export function rewriteModuleSource(src, importerProjectRelativeDir, canonicalIdResolver) {
  const mask = scanCodeMask(src);
  const replacements = [];
  const edges = [];
  const rejected = [];

  function considerSpecifier(specifier, specStart, specEnd, context) {
    const resolved = resolveModuleSpecifierToProjectPath(specifier, importerProjectRelativeDir);
    if (!resolved.ok) {
      rejected.push({ specifier, reason: resolved.reason, context });
      return;
    }
    const canonicalId = canonicalIdResolver(resolved.projectRelativePath);
    edges.push({ specifier, projectRelativePath: resolved.projectRelativePath, canonicalId, context });
    replacements.push({ start: specStart, end: specEnd, replacement: canonicalId });
  }

  const STATIC_PATTERNS = [
    { re: /\bimport\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*;?/gd, context: 'side-effect-import' },
    { re: /\bimport\s+(?!['"(])[^;]*?\bfrom\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*;?/gd, context: 'import-from' },
    { re: /\bexport\s+[^;]*?\bfrom\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*;?/gd, context: 'export-from' },
  ];
  for (const { re, context } of STATIC_PATTERNS) {
    let m;
    while ((m = re.exec(src)) !== null) {
      if (mask[m.index] !== 1) {
        // The keyword sits inside a comment/string/template — not a real
        // statement. Because the middle `[^;]*?...from` clause is
        // unbounded across newlines, a false start like this can swallow
        // a REAL import statement that follows later in the same
        // no-semicolon stretch (e.g. a multi-line comment immediately
        // above a real import, with no semicolon in between). Rewind
        // lastIndex to just past this false start (not past the whole
        // consumed span) so the real statement gets its own, correctly
        // bounded match on the next iteration instead of being silently
        // skipped.
        re.lastIndex = m.index + 1;
        continue;
      }
      const specifier = m[2];
      const [specStart, specEnd] = m.indices[2];
      considerSpecifier(specifier, specStart, specEnd, context);
    }
  }

  // Literal dynamic import('...') — non-literal arguments are honestly rejected, never rewritten.
  const dynRe = /\bimport\s*(?=\()/g;
  let dm;
  while ((dm = dynRe.exec(src)) !== null) {
    if (mask[dm.index] !== 1) continue; // e.g. JSDoc `{import('../x').T}` inside a /** */ comment
    let openIdx = dm.index + dm[0].length;
    while (openIdx < src.length && src[openIdx] !== '(') openIdx++;
    const span = extractBalancedParens(src, openIdx);
    if (!span) { rejected.push({ specifier: null, reason: 'unterminated dynamic import(...)', context: 'dynamic-import' }); continue; }
    const content = src.slice(span.start + 1, span.end - 1);
    const leadingWs = content.length - content.trimStart().length;
    const trailingWs = content.length - content.trimEnd().length;
    const specStart = span.start + 1 + leadingWs;
    const specEnd = span.end - 1 - trailingWs;
    const literalText = src.slice(specStart, specEnd);
    const literalMatch = LITERAL_STRING_RE.exec(literalText);
    if (!literalMatch) {
      rejected.push({ specifier: null, reason: 'non-literal dynamic import rejected (argument is not a single string literal)', context: 'dynamic-import', raw: literalText.slice(0, 120) });
      continue;
    }
    const specifier = literalMatch[2];
    const [gStart, gEnd] = literalMatch.indices[2];
    considerSpecifier(specifier, specStart + gStart, specStart + gEnd, 'dynamic-import-literal');
  }

  replacements.sort((a, b) => b.start - a.start);
  let rewritten = src;
  for (const r of replacements) {
    rewritten = rewritten.slice(0, r.start) + r.replacement + rewritten.slice(r.end);
  }

  return { rewrittenSource: rewritten, edges, rejected };
}

// ══════════════════════════════════════════════════════════════════
// PART 3 — discover and build the complete local module graph starting
// from one or more entry project-relative paths. QA Node scripts are
// never visited (nothing under ui/ or core/ imports them).
// ══════════════════════════════════════════════════════════════════
export async function buildModuleGraph({ projectRoot, entryProjectRelativePaths }) {
  const moduleMap = new Map(); // projectRelativePath -> { canonicalId, source, rewrittenSource, edgeCount }
  const edgesAll = [];
  const rejectedAll = [];
  const duplicateCanonicalIds = [];
  const canonicalIdSeen = new Set();

  const canonicalIdFor = (p) => toCanonicalId(p);

  const queue = [...entryProjectRelativePaths];
  const queued = new Set(queue);

  while (queue.length > 0) {
    const relPath = queue.shift();
    if (moduleMap.has(relPath)) continue;

    const resolved = resolveSafeLocalPath(projectRoot, '/' + relPath);
    if (!resolved.ok) {
      rejectedAll.push({ specifier: relPath, reason: resolved.reason, context: 'module-path-resolution', from: null });
      continue;
    }
    let source;
    try {
      source = await readFile(resolved.filePath, 'utf8');
    } catch (e) {
      rejectedAll.push({ specifier: relPath, reason: `file read failed: ${(e && e.message) || e}`, context: 'module-read', from: null });
      continue;
    }

    const importerDir = path.posix.dirname(relPath);
    const { rewrittenSource, edges, rejected } = rewriteModuleSource(source, importerDir === '.' ? '' : importerDir, canonicalIdFor);

    const canonicalId = canonicalIdFor(relPath);
    if (canonicalIdSeen.has(canonicalId)) duplicateCanonicalIds.push(canonicalId);
    else canonicalIdSeen.add(canonicalId);

    moduleMap.set(relPath, { canonicalId, source, rewrittenSource, edgeCount: edges.length });
    edgesAll.push(...edges.map((e) => ({ ...e, from: relPath })));
    rejectedAll.push(...rejected.map((r) => ({ ...r, from: relPath })));

    for (const e of edges) {
      if (!moduleMap.has(e.projectRelativePath) && !queued.has(e.projectRelativePath)) {
        queue.push(e.projectRelativePath);
        queued.add(e.projectRelativePath);
      }
    }
  }

  return { moduleMap, edgesAll, rejectedAll, duplicateCanonicalIds };
}

// ══════════════════════════════════════════════════════════════════
// PART 5 — data: URL + Import Map construction.
// ══════════════════════════════════════════════════════════════════
export function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

export function buildImportMap(moduleMap) {
  const imports = {};
  for (const mod of moduleMap.values()) {
    imports[mod.canonicalId] = toDataUrl(mod.rewrittenSource);
  }
  return { imports };
}

export function buildImportMapScriptTag(moduleMap) {
  const importMap = buildImportMap(moduleMap);
  return `<script type="importmap">${JSON.stringify(importMap)}</script>`;
}

// ══════════════════════════════════════════════════════════════════
// PART 6 — local static asset discovery + inlining as data: URLs.
// This project's index.html currently references no local <img src>,
// <link rel="icon">, or local CSS files (only the two Google Fonts
// stylesheet links, which are removed rather than inlined — see
// transformIndexHtml) — so localAssetCount is 0 in practice, but the
// logic is implemented generically and covered by the static self-test
// against a synthetic snippet.
// ══════════════════════════════════════════════════════════════════
const ASSET_ATTR_RE = /\b(src|href)="([^"]+)"/g;

export function findLocalHtmlAssetReferences(html) {
  const found = [];
  let m;
  ASSET_ATTR_RE.lastIndex = 0;
  while ((m = ASSET_ATTR_RE.exec(html)) !== null) {
    const value = m[2];
    if (value.length === 0) continue;
    if (value.startsWith('#')) continue; // same-page anchor
    if (/^(https?:)?\/\//i.test(value)) continue; // external / protocol-relative
    if (/^(mailto|tel|javascript|data):/i.test(value)) continue;
    if (value === 'ui/app.js') continue; // handled separately as the module entry point, not a generic asset
    found.push({ attr: m[1], value, start: m.index, end: m.index + m[0].length });
  }
  return found;
}

const ASSET_MIME_BY_EXT = {
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export async function inlineLocalHtmlAssets(html, projectRoot) {
  const refs = findLocalHtmlAssetReferences(html);
  const rejected = [];
  const inlined = [];
  const replacements = [];
  for (const ref of refs) {
    const resolved = resolveSafeLocalPath(projectRoot, '/' + ref.value.replace(/^\/+/, ''));
    if (!resolved.ok) { rejected.push({ ...ref, reason: resolved.reason }); continue; }
    let data;
    try {
      data = await readFile(resolved.filePath);
    } catch (e) {
      rejected.push({ ...ref, reason: `file read failed: ${(e && e.message) || e}` });
      continue;
    }
    const ext = path.extname(resolved.filePath).toLowerCase();
    const mime = ASSET_MIME_BY_EXT[ext] || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    inlined.push({ ...ref, dataUrl });
    replacements.push({ start: ref.start, end: ref.end, replacement: `${ref.attr}="${dataUrl}"` });
  }
  replacements.sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of replacements) out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  return { html: out, inlined, rejected };
}

// ══════════════════════════════════════════════════════════════════
// PART 2/5/6 — transform the real index.html into the in-memory
// document: strip Google Fonts network dependency, rewrite the two
// existing inline module scripts' specifiers, replace the
// `<script type="module" src="ui/app.js">` tag with an inline import
// of its canonical ID, insert the Import Map, inline any local assets.
// ══════════════════════════════════════════════════════════════════
const GOOGLE_FONTS_LINK_RE = /<link\b[^>]*fonts\.googleapis\.com[^>]*>\s*/gi;
const APP_ENTRY_SCRIPT_RE = /<script\s+type="module"\s+src="ui\/app\.js">\s*<\/script>/i;
const INLINE_MODULE_SCRIPT_RE = /<script\s+type="module">([\s\S]*?)<\/script>/gi;

export async function transformIndexHtml({ projectRoot, indexHtmlSource, moduleGraph, appEntryProjectRelativePath }) {
  let html = indexHtmlSource;

  let removedFontLinkCount = 0;
  html = html.replace(GOOGLE_FONTS_LINK_RE, () => { removedFontLinkCount++; return ''; });

  const canonicalIdFor = (p) => toCanonicalId(p);
  let inlineModuleCount = 0;
  const inlineModuleRejected = [];
  html = html.replace(INLINE_MODULE_SCRIPT_RE, (whole, inner) => {
    inlineModuleCount++;
    const { rewrittenSource, rejected } = rewriteModuleSource(inner, '', canonicalIdFor);
    inlineModuleRejected.push(...rejected);
    return `<script type="module">${rewrittenSource}</script>`;
  });

  if (!APP_ENTRY_SCRIPT_RE.test(html)) {
    throw new Error('expected <script type="module" src="ui/app.js"></script> tag not found in index.html — cannot build the in-memory entry point');
  }
  const appCanonicalId = canonicalIdFor(appEntryProjectRelativePath);
  html = html.replace(APP_ENTRY_SCRIPT_RE, `<script type="module">import "${appCanonicalId}";</script>`);

  const { html: assetInlinedHtml, inlined: localAssets, rejected: assetRejected } = await inlineLocalHtmlAssets(html, projectRoot);
  html = assetInlinedHtml;

  const importMapTag = buildImportMapScriptTag(moduleGraph.moduleMap);
  const firstModuleScriptIdx = html.search(/<script\s+type="module"/i);
  if (firstModuleScriptIdx === -1) {
    throw new Error('no module script found to insert the Import Map before');
  }
  html = html.slice(0, firstModuleScriptIdx) + importMapTag + '\n' + html.slice(firstModuleScriptIdx);

  return {
    html,
    removedFontLinkCount,
    fontFallbackUsed: removedFontLinkCount > 0,
    inlineModuleCount,
    inlineModuleRejected,
    localAssetCount: localAssets.length,
    localAssets,
    assetRejected,
  };
}

// ══════════════════════════════════════════════════════════════════
// Top-level orchestrator used by both the smoke test and the static
// self-test.
// ══════════════════════════════════════════════════════════════════
export async function buildInMemoryApp(projectRoot) {
  const indexHtmlSource = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
  const entryProjectRelativePaths = ['ui/app.js'];

  // The two existing inline module scripts also reference local
  // modules (./core/project-version.js via a literal dynamic import,
  // ./ui/reference-color-match-panel.js via a static import) — those
  // must be included as graph entry points too, or their targets would
  // never be discovered/packaged even though they are rewritten inline.
  const inlineScriptMatches = [...indexHtmlSource.matchAll(INLINE_MODULE_SCRIPT_RE)];
  const inlineEntryRejected = [];
  const inlineEntryEdges = [];
  inlineScriptMatches.forEach((m, scriptIndex) => {
    const { edges, rejected } = rewriteModuleSource(m[1], '', toCanonicalId);
    for (const e of edges) {
      entryProjectRelativePaths.push(e.projectRelativePath);
      inlineEntryEdges.push({ ...e, from: `index.html#inline-module-script-${scriptIndex}` });
    }
    inlineEntryRejected.push(...rejected);
  });

  const moduleGraph = await buildModuleGraph({ projectRoot, entryProjectRelativePaths });
  // The two existing inline <script type="module"> blocks in index.html
  // are themselves import sources (one literal dynamic import, one
  // static import) but are not files in moduleMap, so their edges are
  // merged in here — otherwise Part 10's import-edge/dynamic-import
  // counts would silently omit real edges that DO exist in the graph.
  moduleGraph.edgesAll.push(...inlineEntryEdges);
  const transformed = await transformIndexHtml({
    projectRoot,
    indexHtmlSource,
    moduleGraph,
    appEntryProjectRelativePath: 'ui/app.js',
  });

  return {
    html: transformed.html,
    moduleGraph,
    fontFallbackUsed: transformed.fontFallbackUsed,
    removedFontLinkCount: transformed.removedFontLinkCount,
    inlineModuleCount: transformed.inlineModuleCount,
    localAssetCount: transformed.localAssetCount,
    inlineEntryRejected,
    inlineModuleRejected: transformed.inlineModuleRejected,
    assetRejected: transformed.assetRejected,
  };
}

/** Redacted evidence summary — never includes full source text or data URLs (Part 10 requirement). */
export function toEvidenceSummary(app) {
  const modulePaths = [...app.moduleGraph.moduleMap.keys()].sort();
  return {
    moduleCount: modulePaths.length,
    modulePaths,
    importEdgeCount: app.moduleGraph.edgesAll.filter((e) => e.context !== 'dynamic-import-literal').length,
    dynamicImportLiteralCount: app.moduleGraph.edgesAll.filter((e) => e.context === 'dynamic-import-literal').length,
    inlineModuleCount: app.inlineModuleCount,
    dataModuleCount: modulePaths.length,
    localAssetCount: app.localAssetCount,
    rejectedSpecifiers: [...app.moduleGraph.rejectedAll, ...app.inlineEntryRejected, ...app.inlineModuleRejected, ...app.assetRejected],
    duplicateCanonicalIds: app.moduleGraph.duplicateCanonicalIds,
    fontFallbackUsed: app.fontFallbackUsed,
  };
}
