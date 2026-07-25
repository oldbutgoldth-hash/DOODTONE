/**
 * qa/epic-2e-j-esm-syntax-gate-static-test.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase A2.
 *
 * Regression test for the exact defect class that slipped through every
 * prior round's syntax sweep: a duplicate lexical declaration
 * (const/let/class) in the same scope of a file that is actually consumed
 * as an ES module. Exercises tools/esm-syntax-gate.mjs (Phase A3) against:
 *
 *   1. A synthetic fixture with a genuine duplicate `const` in one
 *      function scope -> the gate MUST fail it.
 *   2. A synthetic fixture that reuses an identifier across two
 *      genuinely DIFFERENT block scopes (not a real conflict) -> the
 *      gate MUST NOT flag it (proves the gate isn't over-broad).
 *   3. A clean, valid ES module -> the gate MUST pass it.
 *   4. A frozen, byte-for-byte historical snapshot of the REAL buggy
 *      ui/app.js (pre-fix, from Round 2) -> the gate MUST fail it. This
 *      is the direct historical-regression guard: if this exact defect
 *      class is ever reintroduced into a file shaped like the real app,
 *      the gate must still catch it.
 *   5. The CURRENT (fixed) ui/app.js in this project tree -> the gate
 *      MUST pass it. This is the direct forward guard: the fix must not
 *      regress, and the gate must not falsely flag legitimate real code.
 *
 * This test does NOT assert any particular behavior for `node --check`
 * on these fixtures. `node --check`'s blind spot on the real ui/app.js
 * was independently, empirically reproduced and is documented in
 * tools/esm-syntax-gate.mjs's header comment and in the R3 final report
 * -- but relying on `node --check` producing a specific false result on
 * a synthetic fixture would overfit to undocumented V8 lazy-parsing
 * internals that are not part of any spec guarantee. The one invariant
 * this test enforces is the one that actually matters: the ESM gate
 * itself must be correct.
 *
 * Fail-closed: ALLOWED_STATUSES pattern, non-zero exit on any FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAsEsModule } from '../tools/esm-syntax-gate.mjs';
import { ensureVmModulesFlag } from './helpers/ensure-vm-modules-flag.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'esm-syntax-gate');

const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);

function recordStatus(rows, name, status, detail) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`Invalid status "${status}" for case "${name}" -- refusing to record.`);
  }
  rows.push({ name, status, detail: detail ?? null });
}

function readFixture(fileName) {
  return fs.readFileSync(path.join(FIXTURES_DIR, fileName), 'utf8');
}

export function evaluateCases() {
  const rows = [];

  // Case 1: genuine duplicate const in one function scope -> must FAIL.
  {
    const src = readFixture('duplicate-const-same-scope.mjs');
    let parsed;
    try {
      parsed = parseAsEsModule(src, 'duplicate-const-same-scope.mjs');
    } catch (e) {
      recordStatus(rows, 'duplicate_const_same_scope_detected', 'FAIL', `gate threw unexpectedly: ${e.message}`);
      parsed = null;
    }
    if (parsed) {
      const ok = parsed.ok === false && parsed.errorName === 'SyntaxError' && /already been declared/.test(parsed.errorMessage || '');
      recordStatus(rows, 'duplicate_const_same_scope_detected', ok ? 'PASS' : 'FAIL', JSON.stringify(parsed));
    }
  }

  // Case 2: same identifier, genuinely different block scopes -> must NOT be flagged.
  {
    const src = readFixture('duplicate-let-different-block.mjs');
    let parsed;
    try {
      parsed = parseAsEsModule(src, 'duplicate-let-different-block.mjs');
    } catch (e) {
      recordStatus(rows, 'different_block_scope_not_flagged', 'FAIL', `gate threw unexpectedly: ${e.message}`);
      parsed = null;
    }
    if (parsed) {
      recordStatus(rows, 'different_block_scope_not_flagged', parsed.ok === true ? 'PASS' : 'FAIL', JSON.stringify(parsed));
    }
  }

  // Case 3: clean, valid module -> must PASS.
  {
    const src = readFixture('clean-module.mjs');
    let parsed;
    try {
      parsed = parseAsEsModule(src, 'clean-module.mjs');
    } catch (e) {
      recordStatus(rows, 'clean_module_passes', 'FAIL', `gate threw unexpectedly: ${e.message}`);
      parsed = null;
    }
    if (parsed) {
      recordStatus(rows, 'clean_module_passes', parsed.ok === true ? 'PASS' : 'FAIL', JSON.stringify(parsed));
    }
  }

  // Case 4: frozen historical snapshot of the REAL buggy ui/app.js -> must FAIL.
  {
    const src = readFixture('known-bad-app-js-snapshot.js.txt');
    let parsed;
    try {
      parsed = parseAsEsModule(src, 'known-bad-app-js-snapshot.js.txt');
    } catch (e) {
      recordStatus(rows, 'historical_real_bug_snapshot_detected', 'FAIL', `gate threw unexpectedly: ${e.message}`);
      parsed = null;
    }
    if (parsed) {
      const ok = parsed.ok === false && parsed.errorName === 'SyntaxError' && /rawAlignment.*already been declared/.test(parsed.errorMessage || '');
      recordStatus(rows, 'historical_real_bug_snapshot_detected', ok ? 'PASS' : 'FAIL', JSON.stringify(parsed));
    }
  }

  // Case 5: CURRENT (fixed) ui/app.js in this project tree -> must PASS.
  {
    const appJsPath = path.join(PROJECT_ROOT, 'ui', 'app.js');
    let src = null;
    let readError = null;
    try {
      src = fs.readFileSync(appJsPath, 'utf8');
    } catch (e) {
      readError = e;
    }
    if (readError) {
      recordStatus(rows, 'current_fixed_app_js_passes', 'FAIL', `could not read ui/app.js: ${readError.message}`);
    } else {
      const dupCount = (src.match(/const rawAlignment\s*=/g) || []).length;
      let parsed;
      try {
        parsed = parseAsEsModule(src, 'ui/app.js');
      } catch (e) {
        recordStatus(rows, 'current_fixed_app_js_passes', 'FAIL', `gate threw unexpectedly: ${e.message}`);
        parsed = null;
      }
      if (parsed) {
        const ok = parsed.ok === true && dupCount === 1;
        recordStatus(rows, 'current_fixed_app_js_passes', ok ? 'PASS' : 'FAIL', `rawAlignment declarations found=${dupCount}; parse=${JSON.stringify(parsed)}`);
      }
    }
  }

  return rows;
}

export function computeDecision(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'FAIL_ESM_SYNTAX_GATE_SELFTEST';
  const allPass = rows.every((r) => r.status === 'PASS');
  return allPass ? 'PASS_ESM_SYNTAX_GATE_SELFTEST' : 'FAIL_ESM_SYNTAX_GATE_SELFTEST';
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  ensureVmModulesFlag();
  const rows = evaluateCases();
  const decision = computeDecision(rows);
  for (const r of rows) {
    console.log(`  [${r.status}] ${r.name}${r.status === 'FAIL' ? ' -- ' + r.detail : ''}`);
  }
  console.log(`ESM syntax gate self-test decision: ${decision}`);
  process.exit(decision === 'PASS_ESM_SYNTAX_GATE_SELFTEST' ? 0 : 1);
}
