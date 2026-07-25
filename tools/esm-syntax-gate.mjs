#!/usr/bin/env node
// -----------------------------------------------------------------------
// tools/esm-syntax-gate.mjs
//
// LOCAL-FIRST GEOMETRY R3 -- Phase A3.
//
// WHY THIS FILE EXISTS
// ---------------------
// Every prior QA round in this project trusted `node --check somefile.js`
// as its "syntax sweep." That check is BLIND to a real defect class: a
// duplicate lexical declaration (`const`/`let`/`class`) in the same scope
// of a file that is actually consumed as an ES module (`<script
// type="module">` in the browser). Proven directly on this codebase:
//
//   node --check ui/app.js
//     -> exit 0  (WRONG -- reports success)
//
//   node --input-type=module -e "import('./ui/app.js')..."
//     -> SyntaxError: Identifier 'rawAlignment' has already been declared
//
// Root cause: without `"type": "module"` in package.json, `node --check`
// parses a `.js` file under the SCRIPT goal, not the MODULE goal, even
// though the browser always loads it as a module. Some duplicate-lexical
// conflicts that are errors under the module goal are silently accepted
// under the (looser, in this respect) script goal.
//
// This gate closes that gap using `vm.SourceTextModule`, which performs a
// REAL ECMAScript Module parse. Critically, constructing a
// SourceTextModule only PARSES the source -- it does not link or evaluate
// it -- so files that reference browser-only globals (`document`,
// `window`, `localStorage`, canvas APIs, etc.) do not throw at this
// stage. Only genuine parse-time errors (including duplicate lexical
// declarations) are caught here. This is deliberately narrower than
// "does this file run correctly" (that is what the real-Browser suites
// prove) and deliberately broader than `node --check` was for this
// defect class.
//
// FAIL-CLOSED BEHAVIOR
// ---------------------
// - If `vm.SourceTextModule` is unavailable (this process was not
//   launched with --experimental-vm-modules), this script exits 2
//   immediately rather than silently falling back to `node --check` --
//   a silent fallback would quietly reintroduce the exact blind spot
//   this gate exists to close.
// - If the file-discovery step finds zero files, this script exits 2
//   rather than reporting a vacuous "0 checked, 0 failed" pass.
// - Any file that fails to parse is a hard FAIL for the whole gate.
// -----------------------------------------------------------------------

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureVmModulesFlag } from '../qa/helpers/ensure-vm-modules-flag.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Every file group below is loaded as a genuine ES module in the real
// app (core/*.js and ui/*.js are `import`ed by ui/app.js, which is
// itself loaded via <script type="module">; every qa/*.mjs file is a
// module by extension). See the discovery comment in each helper for
// how each directory is verified to belong here.
const SCAN_ROOTS = [
  { dir: 'core', extensions: ['.js'] },
  { dir: 'ui', extensions: ['.js'] },
  { dir: 'qa', extensions: ['.mjs'] },
  { dir: 'tools', extensions: ['.mjs'] },
];

// "fixtures" is excluded deliberately: qa/fixtures/esm-syntax-gate/
// intentionally contains a broken fixture (duplicate-const-same-scope.mjs)
// used by this gate's own regression test (qa/epic-2e-j-esm-syntax-gate-
// static-test.mjs). That file must never be swept as if it were real
// project source, or the gate would permanently and correctly report
// FAIL against its own deliberately-broken test data.
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'fixtures']);

function walk(absDir, extensions, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    return; // Missing directory is not itself a gate failure.
  }
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, extensions, out);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      out.push(abs);
    }
  }
}

export function discoverFiles(projectRoot = PROJECT_ROOT) {
  const files = [];
  for (const { dir, extensions } of SCAN_ROOTS) {
    walk(path.join(projectRoot, dir), extensions, files);
  }
  files.sort();
  return files;
}

/**
 * Parses `source` under a genuine ES-module parse goal. Returns
 * { ok: true } or { ok: false, errorName, errorMessage }. Never throws --
 * callers get a structured result either way. Does NOT execute the
 * module (no link/evaluate step), so browser-global references never
 * cause a false failure here.
 */
export function parseAsEsModule(source, identifier) {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error(
      'vm.SourceTextModule is unavailable. This process must be launched ' +
      'with --experimental-vm-modules (see package.json "test:syntax" ' +
      'script). Refusing to silently fall back to a weaker check.'
    );
  }
  try {
    // eslint-disable-next-line no-new
    new vm.SourceTextModule(source, { identifier });
    return { ok: true };
  } catch (e) {
    return { ok: false, errorName: e.constructor.name, errorMessage: e.message };
  }
}

export async function runGate({ projectRoot = PROJECT_ROOT, files = null } = {}) {
  if (typeof vm.SourceTextModule !== 'function') {
    return {
      status: 'GATE_UNAVAILABLE',
      reason: 'vm.SourceTextModule unavailable -- rerun with --experimental-vm-modules.',
      results: [],
    };
  }

  const target = files ?? discoverFiles(projectRoot);
  if (!Array.isArray(target) || target.length === 0) {
    return {
      status: 'NO_FILES_DISCOVERED',
      reason: 'File discovery returned zero files -- treated as a failure, not a vacuous pass.',
      results: [],
    };
  }

  const results = [];
  for (const abs of target) {
    const rel = path.relative(projectRoot, abs);
    let source;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      results.push({ file: rel, ok: false, errorName: 'ReadError', errorMessage: e.message });
      continue;
    }
    const parsed = parseAsEsModule(source, rel);
    if (parsed.ok) {
      results.push({ file: rel, ok: true });
    } else {
      results.push({ file: rel, ok: false, errorName: parsed.errorName, errorMessage: parsed.errorMessage });
    }
  }

  const failed = results.filter((r) => !r.ok);
  return {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failures: failed,
    results,
  };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  ensureVmModulesFlag();
  runGate().then((outcome) => {
    if (outcome.status === 'GATE_UNAVAILABLE') {
      console.error('[esm-syntax-gate] FAIL (gate unavailable):', outcome.reason);
      process.exit(2);
    }
    if (outcome.status === 'NO_FILES_DISCOVERED') {
      console.error('[esm-syntax-gate] FAIL (no files discovered):', outcome.reason);
      process.exit(2);
    }
    console.log(`[esm-syntax-gate] ${outcome.status} -- ${outcome.passed}/${outcome.total} files parsed cleanly as ES modules.`);
    if (outcome.status === 'FAIL') {
      for (const f of outcome.failures) {
        console.error(`  FAIL ${f.file}: ${f.errorName}: ${f.errorMessage}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }).catch((e) => {
    console.error('[esm-syntax-gate] FAIL (unexpected error):', e.message);
    process.exit(2);
  });
}
