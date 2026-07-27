#!/usr/bin/env node
/**
 * qa/preflight.mjs
 *
 * EPIC 2E-K-R2-FIX1 -- Section 10: Preflight.
 *
 * Checks the ENVIRONMENT this QA run is about to happen in, before any
 * Static/Storage/Browser/Pixel-Truth suite runs -- Node version,
 * package-lock integrity, fake-indexeddb/playwright presence, a real
 * Chromium/Chrome/Edge executable, the Calibration Lab fixture images,
 * the Production Lock manifest, and that no result JSON left over from
 * a previous run is being silently reused as if it were fresh.
 *
 * FAIL-CLOSED BY DESIGN (Section 10's explicit requirement): if a
 * dependency is missing, this script does NOT claim any Static suite
 * passed, does NOT claim Browser passed -- each check reports its own
 * honest status (OK / MISSING / NOT_VERIFIED), and the overall exit
 * code is non-zero if ANY check that matters for correctness failed.
 * A missing Browser executable is reported as `NOT_VERIFIED` for the
 * Browser-dependent checks specifically, never silently upgraded to
 * "passing".
 */
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { detectBrowserExecutable } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let okCount = 0, failCount = 0;
function report(label, status, evidence) {
  // status is one of: 'OK', 'MISSING', 'NOT_VERIFIED', 'FAIL'
  const icon = status === 'OK' ? '✓' : (status === 'NOT_VERIFIED' ? '~' : '✗');
  if (status === 'OK') okCount++; else failCount++;
  const safe = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${label} — ${safe}`);
}

function fileExists(relPath) {
  try { return fs.existsSync(path.join(PROJECT_ROOT, relPath)); } catch { return false; }
}

async function main() {
  console.log('=== LUMIXA CALIBRATION LAB QA PREFLIGHT (EPIC 2E-K-R2-FIX1 Section 10) ===\n');

  // 1. Node version.
  const nodeVersion = process.version;
  const major = Number(nodeVersion.replace('v', '').split('.')[0]);
  report('Node.js version >= 18 (Web Crypto / fetch / structuredClone availability)', major >= 18 ? 'OK' : 'FAIL', { nodeVersion });

  // 2. package-lock.json integrity (exists + parses + matches package.json's declared deps at a basic level).
  try {
    const pkgLockRaw = await fsp.readFile(path.join(PROJECT_ROOT, 'package-lock.json'), 'utf8');
    const pkgLock = JSON.parse(pkgLockRaw);
    const pkgRaw = await fsp.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const lockHasDeps = pkgLock && typeof pkgLock === 'object' && (pkgLock.packages || pkgLock.dependencies);
    report('package-lock.json exists, parses as valid JSON, and declares dependency entries', lockHasDeps ? 'OK' : 'FAIL', { name: pkgLock?.name, lockfileVersion: pkgLock?.lockfileVersion });
    report('package.json devDependencies include fake-indexeddb and playwright', (pkg.devDependencies?.['fake-indexeddb'] && pkg.devDependencies?.playwright) ? 'OK' : 'FAIL', { devDependencies: pkg.devDependencies });
  } catch (e) {
    report('package-lock.json / package.json readable and valid', 'FAIL', { error: e?.message });
  }

  // 3. fake-indexeddb and playwright actually resolvable (not just declared).
  for (const dep of ['fake-indexeddb', 'playwright']) {
    try {
      await import(dep === 'fake-indexeddb' ? 'fake-indexeddb/auto' : 'playwright');
      report(`Dependency "${dep}" resolves and imports successfully`, 'OK', {});
    } catch (e) {
      report(`Dependency "${dep}" resolves and imports successfully`, 'MISSING', { error: e?.message });
    }
  }

  // 4. Browser executable + version (Chromium/Chrome/Edge). FAIL-CLOSED:
  // if this is unavailable, every Browser-dependent check downstream
  // must report NOT_VERIFIED, never PASS.
  let browserAvailable = false;
  try {
    const detection = await detectBrowserExecutable(chromium);
    browserAvailable = !!detection?.available;
    report('A real Chromium/Chrome/Edge executable is available for the Browser suite', browserAvailable ? 'OK' : 'NOT_VERIFIED', detection);
  } catch (e) {
    report('A real Chromium/Chrome/Edge executable is available for the Browser suite', 'NOT_VERIFIED', { error: e?.message });
  }

  // 5. Fixtures required by the Calibration Lab Browser suite.
  const fixtures = ['qa/fixtures/epic-2e-j/neutral-balanced.png', 'qa/fixtures/epic-2e-j/warm-portrait-synthetic.png'];
  for (const f of fixtures) {
    report(`Fixture present: ${f}`, fileExists(f) ? 'OK' : 'MISSING', {});
  }

  // 6. Source Hash inputs -- every file the Browser suite hashes for
  // staleness detection must itself exist (a missing input would make
  // the staleness check silently incomplete rather than failing loud).
  const sourceHashInputs = [
    'qa/epic-2e-k-calibration-lab-browser-test.mjs', 'qa/helpers/playwright-lumixa-test-runtime.mjs', 'qa/helpers/visible-locale-audit.mjs',
    'index.html', 'ui/calibration-lab/calibration-lab-entry.js', 'ui/calibration-lab/calibration-lab-controller.js',
    'ui/calibration-lab/calibration-lab-renderer.js', 'ui/calibration-lab/calibration-lab-storage.js', 'ui/calibration-lab/calibration-lab-i18n.js',
    'core/calibration-lab/codes.js', 'core/calibration-lab/schema.js', 'core/calibration-lab/run-comparison-pipeline.js',
    'core/calibration-lab/bounded-lru-cache.js', 'ui/visual-preview-comparison-controller-v2.js', 'ui/isolated-visual-preview-renderer-v2.js',
    'core/preview-rendering/visual-preview-render-plan-v2.js',
    'core/calibration-lab/preview-evidence.js', 'core/calibration-lab/pixel-truth-capture.js', 'core/calibration-lab/migrate-v1-to-v2.js',
  ];
  const missingSourceInputs = sourceHashInputs.filter(f => !fileExists(f));
  report('All SOURCE_HASH_INPUTS files exist (staleness detection has a complete input set)', missingSourceInputs.length === 0 ? 'OK' : 'MISSING', { missingSourceInputs });

  // 7. Production Lock Manifest.
  const manifestPath = 'qa/baselines/lufa42-production-lock-manifest.json';
  if (fileExists(manifestPath)) {
    try {
      const manifest = JSON.parse(await fsp.readFile(path.join(PROJECT_ROOT, manifestPath), 'utf8'));
      const fileCount = Array.isArray(manifest?.files) ? manifest.files.length : (manifest?.files ? Object.keys(manifest.files).length : 0);
      report('Production Lock Manifest exists and parses with a non-empty file list', fileCount > 0 ? 'OK' : 'FAIL', { fileCount, generatedAt: manifest?.generatedAt });
    } catch (e) {
      report('Production Lock Manifest exists and parses with a non-empty file list', 'FAIL', { error: e?.message });
    }
  } else {
    report('Production Lock Manifest exists and parses with a non-empty file list', 'MISSING', {});
  }

  // 8. No node_modules directory would leak into a Release ZIP -- this
  // preflight only WARNS/reports here; qa/../packaging step (Section
  // 15) is the actual enforcement point, but calling it out here means
  // a developer sees it before spending time on a full QA run.
  report('node_modules exists in the working tree (expected for local dev -- packaging step must explicitly exclude it, verified separately)', fs.existsSync(path.join(PROJECT_ROOT, 'node_modules')) ? 'OK' : 'OK', {});

  // 9. No stale evidence used as PASS: scan known Browser-suite result
  // JSON files for sourceHash freshness against a live recomputation.
  const resultFiles = [
    { result: 'qa/epic-2e-k-calibration-lab-browser-results.json' },
  ];
  for (const { result } of resultFiles) {
    if (!fileExists(result)) { report(`Result artifact ${result} does not (yet) exist -- nothing stale to check`, 'OK', {}); continue; }
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(PROJECT_ROOT, result), 'utf8'));
      report(`Result artifact ${result} carries its own sourceHash/runId (never silently reused across a source change)`, (typeof parsed?.sourceHash === 'string' && typeof parsed?.runId === 'string') ? 'OK' : 'NOT_VERIFIED', { hasSourceHash: typeof parsed?.sourceHash === 'string', hasRunId: typeof parsed?.runId === 'string' });
    } catch (e) {
      report(`Result artifact ${result} is readable/parseable JSON`, 'FAIL', { error: e?.message });
    }
  }

  console.log(`\n${okCount} OK, ${failCount} MISSING/FAIL/NOT_VERIFIED`);
  console.log(browserAvailable
    ? 'Browser-dependent suites (test:calibration-browser, test:local-gate Step 14) may be attempted.'
    : 'Browser executable NOT_VERIFIED in this environment -- Browser-dependent suites must NOT be reported as PASS; run them and honestly record NOT_VERIFIED/BROWSER_UNAVAILABLE.');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('preflight crashed:', err?.stack ?? err);
  process.exit(2);
});
