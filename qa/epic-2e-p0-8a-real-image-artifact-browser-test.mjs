#!/usr/bin/env node
/**
 * qa/epic-2e-p0-8a-real-image-artifact-browser-test.mjs
 *
 * EPIC 2E-P0.8A — Preview Rendering Artifact Repair + Posterization
 * Removal + Candidate-to-Preview Fidelity.
 *
 * Real Chromium test (Playwright) against the running app, using the
 * user's OWN real Reference/Target photographs — the exact pair the
 * posterization/block-artifact defect was reported against (warm/soft
 * Reference, green-background wedding Target). Deliberately refuses to
 * substitute synthetic Canvas images, matching this project's established
 * R6 convention: a procedurally-generated test image is not equivalent
 * proof against a real-photo defect.
 *
 * How to supply the real images (any one of, matching the R6 convention):
 *   1. CLI args:   node qa/epic-2e-p0-8a-real-image-artifact-browser-test.mjs --ref=/path/to/reference.jpg --target=/path/to/target.jpg
 *   2. Env vars:   LUMIXA_P08A_REF_IMAGE=/path/... LUMIXA_P08A_TARGET_IMAGE=/path/... node qa/...
 *   3. Fixtures dir (checked automatically):
 *        qa/fixtures/epic-2e-p0-8a/reference.(jpg|jpeg|png)
 *        qa/fixtures/epic-2e-p0-8a/target.(jpg|jpeg|png)
 *   4. Falls back to the R6 fixtures dir (qa/fixtures/epic-2e-p0-7-r6/)
 *      if present, since it is the same real pair this defect was
 *      originally reported against.
 *
 * What this suite proves, on the real pair, at each of the 6 required
 * Intensity values (0, 25, 50, 60, 75, 100):
 *   1. Loads the real Reference/Target via the actual file inputs.
 *   2. Waits for the Target Matched Preview to render (Fast Preview,
 *      preserving the R6 fix — this suite must NOT regress into the
 *      pre-R6 stall).
 *   3. Sets the Intensity slider to each required value and captures a
 *      PNG screenshot of the rendered Preview canvas — these are the
 *      "Before/After QA images" deliverable, for human visual review
 *      alongside the automated checks below.
 *   4. Computes a quantitative block-artifact proxy DIRECTLY from the
 *      real rendered canvas pixels (via `canvas.getContext('2d').
 *      getImageData()` inside the page): the maximum adjacent-pixel RGB
 *      jump found anywhere in a horizontal AND vertical scan, and the
 *      count of "hard edges" (jumps exceeding a fixed threshold) as a
 *      density. A posterized/block-artifact render produces large,
 *      spatially-extensive hard edges that a smooth photograph's own
 *      natural detail does not; this is the same methodology (proven
 *      against the actual old vs. new renderer) used in the delivered
 *      Node-level posterization root-cause report, now applied to the
 *      real photo's real rendered pixels instead of a synthetic gradient.
 *   5. Confirms Intensity=0 renders visually close to the untouched
 *      Target original (low mean pixel difference).
 *   6. Re-runs the full R6 regression checklist (PSM warnings, counters,
 *      Save After Image, no permanent loading state) against the real
 *      pair, so this suite also serves as the R6 regression closure the
 *      prior round could not complete in this sandbox.
 *
 * Honest environment note: this suite requires BOTH a real Chromium
 * binary AND the two real image files. If either is missing it reports
 * the specific blocking reason and exits 2 (NOT_VERIFIED) — it never
 * fabricates a PASS. In this development sandbox neither is available
 * (see the delivered QA report for the full, doubly-confirmed detail).
 * This script is syntax/import-verified and ready to run as-is on a
 * machine with both a real Chromium binary and the two real photo files.
 */
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-p0-8a-real-image-artifact-browser-results.json');
const SCREENSHOT_DIR = path.join(ROOT, 'qa-screenshots', 'epic-2e-p0-8a');
const SUITE_NAME = 'EPIC 2E-P0.8A — Preview Rendering Artifact Repair Browser Test';
const FIXTURES_DIR = path.join(ROOT, 'qa/fixtures/epic-2e-p0-8a');
const R6_FIXTURES_DIR = path.join(ROOT, 'qa/fixtures/epic-2e-p0-7-r6');
const INTENSITY_VALUES = [0, 25, 50, 60, 75, 100];
const HARD_EDGE_THRESHOLD = 60; // combined |dR|+|dG|+|dB| between adjacent pixels considered a "hard edge" candidate
const MAX_HARD_EDGE_DENSITY_PCT = 2.0; // % of scanned adjacent-pixel pairs allowed to exceed the threshold before flagging block-artifact risk

let pass = 0, fail = 0;
const assertions = [];
function report(label, ok, detail = '') {
  assertions.push({ label, ok, detail: String(detail) });
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label} ${detail}`); }
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function detectSystemChromium() {
  const candidates = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge-stable'];
  for (const bin of candidates) {
    try {
      const p = execFileSync('which', [bin], { encoding: 'utf8' }).trim();
      if (p) return p;
    } catch { /* not found, try next */ }
  }
  return null;
}

function parseCliArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--(ref|target)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function findFixtureImage(dir, baseName) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(dir, `${baseName}.${ext}`);
    if (fsSync.existsSync(p)) return p;
  }
  return null;
}

async function resolveImagePaths() {
  const cli = parseCliArgs(process.argv.slice(2));
  const refPath = cli.ref || process.env.LUMIXA_P08A_REF_IMAGE
    || await findFixtureImage(FIXTURES_DIR, 'reference') || await findFixtureImage(R6_FIXTURES_DIR, 'reference');
  const targetPath = cli.target || process.env.LUMIXA_P08A_TARGET_IMAGE
    || await findFixtureImage(FIXTURES_DIR, 'target') || await findFixtureImage(R6_FIXTURES_DIR, 'target');
  const refOk = refPath && fsSync.existsSync(refPath);
  const targetOk = targetPath && fsSync.existsSync(targetPath);
  return { refPath: refOk ? refPath : null, targetPath: targetOk ? targetPath : null };
}

async function writeUnavailableResult(decision, reason) {
  const output = {
    suite: SUITE_NAME, completed: false, decision, reason,
    pass: 0, fail: 0, total: 0, generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(RESULT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nFinal decision: ${decision} — ${reason}`);
  process.exit(2);
}

async function readTest(page) {
  return page.evaluate(() => {
    try {
      const t = window.__LUMIXA_TEST;
      return {
        psmState: t?.psmState ?? t?.rcm?.runtime?.psm?.state ?? null,
        counters: t?.counters ?? t?.rcm?.runtime?.counters ?? null,
        intensity: t?.rcm?.intensity,
      };
    } catch (e) { return { error: e.message }; }
  });
}

/** Computes the block-artifact proxy directly from the rendered canvas's
 * real pixel data: max adjacent-pixel jump + hard-edge density, scanned
 * both horizontally and vertically. Runs inside the page (no image data
 * needs to cross the Node/browser boundary except the small summary). */
async function measureBlockArtifactProxy(page, canvasSelector) {
  return page.evaluate(({ selector, threshold }) => {
    const canvas = document.querySelector(selector);
    if (!canvas || !canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let maxJump = 0, hardEdges = 0, scanned = 0;
    // Horizontal scan
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) {
        const i = (y * width + x) * 4, p = (y * width + x - 1) * 4;
        const jump = Math.abs(data[i] - data[p]) + Math.abs(data[i + 1] - data[p + 1]) + Math.abs(data[i + 2] - data[p + 2]);
        if (jump > maxJump) maxJump = jump;
        if (jump > threshold) hardEdges++;
        scanned++;
      }
    }
    // Vertical scan
    for (let x = 0; x < width; x++) {
      for (let y = 1; y < height; y++) {
        const i = (y * width + x) * 4, p = ((y - 1) * width + x) * 4;
        const jump = Math.abs(data[i] - data[p]) + Math.abs(data[i + 1] - data[p + 1]) + Math.abs(data[i + 2] - data[p + 2]);
        if (jump > maxJump) maxJump = jump;
        if (jump > threshold) hardEdges++;
        scanned++;
      }
    }
    return { width, height, maxJump, hardEdges, scanned, hardEdgeDensityPct: scanned ? (hardEdges / scanned) * 100 : 0 };
  }, { selector: canvasSelector, threshold: HARD_EDGE_THRESHOLD });
}

async function main() {
  console.log(`=== ${SUITE_NAME} ===\n`);

  const { refPath, targetPath } = await resolveImagePaths();
  if (!refPath || !targetPath) {
    const missing = [!refPath && 'Reference', !targetPath && 'Target'].filter(Boolean).join(' and ');
    return writeUnavailableResult(
      'REAL_IMAGES_UNAVAILABLE',
      `${missing} real photograph file(s) not found. Supply via --ref=/path --target=/path, ` +
      `LUMIXA_P08A_REF_IMAGE/LUMIXA_P08A_TARGET_IMAGE env vars, or place them at ` +
      `${path.relative(ROOT, FIXTURES_DIR)}/reference.(jpg|jpeg|png) and target.(jpg|jpeg|png) ` +
      `(or the R6 fixtures dir, which this suite also checks). This suite refuses to substitute ` +
      `synthetic Canvas images for the real-image acceptance test the release spec requires.`
    );
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    return writeUnavailableResult('BROWSER_BINARY_UNAVAILABLE', `playwright package unavailable: ${e.message}`);
  }
  const systemChromium = detectSystemChromium();
  const bundledPath = (() => { try { return chromium.executablePath(); } catch { return null; } })();
  const bundledExists = bundledPath ? fsSync.existsSync(bundledPath) : false;
  const executablePath = bundledExists ? bundledPath : systemChromium;
  if (!executablePath) {
    return writeUnavailableResult(
      'BROWSER_BINARY_UNAVAILABLE',
      'No real Chromium/Chrome/Edge executable found (bundled Playwright Chromium not downloaded — network-blocked in this environment — and no system browser binary detected).'
    );
  }

  console.log(`Reference image: ${refPath}`);
  console.log(`Target image:    ${targetPath}`);
  console.log(`Chromium:        ${executablePath}\n`);

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const { startLocalStaticServer } = await import('../tools/local-static-server.mjs');
  const server = await startLocalStaticServer({ port: 4178, host: '127.0.0.1', quiet: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const psmWarnings = [];
  const pageErrors = [];
  page.on('console', msg => { const t = msg.text(); if (t.includes('PSM:') && t.includes('invalid transition')) psmWarnings.push(t); });
  page.on('pageerror', err => pageErrors.push(err.message));

  const intensityResults = [];
  try {
    await page.goto('http://127.0.0.1:4178/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });
    report('App loaded', true);

    await page.setInputFiles('#rcmRefFileIn', refPath);
    report('Real Reference photograph loaded via the actual file input', true, refPath);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(1500);
    await page.setInputFiles('#rcmTargetFileIn', targetPath);
    report('Real Target photograph loaded via the actual file input', true, targetPath);

    // R6 regression: Fast Preview must still appear promptly, never stall.
    let fastReady = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const s = await readTest(page);
      if (['FAST_PREVIEW_READY', 'DEEP_ANALYSIS_RUNNING', 'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY'].includes(s.psmState)) { fastReady = true; break; }
      await page.waitForTimeout(150);
    }
    report('R6 regression: Fast Preview still reaches FAST_PREVIEW_READY (or later) promptly — no re-introduced stall', fastReady, '');

    // Let Refined Preview settle before the artifact-quality sweep so
    // screenshots reflect the final, fully-processed candidate.
    await page.waitForTimeout(20000);

    for (const value of INTENSITY_VALUES) {
      await page.evaluate((v) => {
        const el = document.getElementById('rcmIntensitySlider');
        if (!el) return;
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await page.waitForTimeout(400); // > 140ms debounce + render settle

      const shotPath = path.join(SCREENSHOT_DIR, `intensity-${value}.png`);
      const canvasHandle = await page.$('#rcmAfterCanvas');
      if (canvasHandle) await canvasHandle.screenshot({ path: shotPath });
      report(`Intensity=${value}: Preview screenshot captured for before/after QA review`, fsSync.existsSync(shotPath), shotPath);

      const proxy = await measureBlockArtifactProxy(page, '#rcmAfterCanvas');
      if (proxy) {
        report(`Intensity=${value}: hard-edge density stays under ${MAX_HARD_EDGE_DENSITY_PCT}% (block-artifact proxy — old hard-bucket renderer measured density far above this on a comparable synthetic gradient)`, proxy.hardEdgeDensityPct < MAX_HARD_EDGE_DENSITY_PCT, JSON.stringify(proxy));
      } else {
        report(`Intensity=${value}: block-artifact proxy measurable (canvas has rendered pixel data)`, false, 'canvas not ready / zero dimensions');
      }
      intensityResults.push({ value, screenshot: shotPath, proxy });
    }

    // Intensity=0 should look close to the untouched Target original.
    await page.evaluate(() => {
      const el = document.getElementById('rcmIntensitySlider');
      if (el) { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await page.waitForTimeout(400);
    const zeroVsOriginal = await page.evaluate(() => {
      const before = document.getElementById('rcmBeforeCanvas') || document.getElementById('rcmTargetCanvas');
      const after = document.getElementById('rcmAfterCanvas');
      if (!before || !after || !before.width || !after.width) return null;
      const bctx = before.getContext('2d'), actx = after.getContext('2d');
      const w = Math.min(before.width, after.width), h = Math.min(before.height, after.height);
      const bd = bctx.getImageData(0, 0, w, h).data, ad = actx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < bd.length; i += 4) sum += Math.abs(bd[i] - ad[i]) + Math.abs(bd[i + 1] - ad[i + 1]) + Math.abs(bd[i + 2] - ad[i + 2]);
      return { meanAbsDiff: sum / (bd.length / 4) };
    });
    if (zeroVsOriginal) {
      report('Intensity=0 renders visually close to the untouched Target original (low mean pixel difference)', zeroVsOriginal.meanAbsDiff < 15, JSON.stringify(zeroVsOriginal));
    }

    // R6 regression checklist against the real pair.
    report('No "PSM: invalid transition" warnings across the full real-image Intensity sweep', psmWarnings.length === 0, psmWarnings.join('; '));
    report('No unhandled pageerror during the full real-image run', pageErrors.length === 0, pageErrors.join('; '));
    const finalState = await readTest(page);
    const saveDisabled = await page.evaluate(() => document.getElementById('rcmSaveAfterBtn')?.disabled);
    report('Save After Image remains usable after the full Intensity sweep', saveDisabled === false, `disabled=${saveDisabled}`);
    report('Counters object well-formed after the real-image run', !!finalState.counters, JSON.stringify(finalState.counters));

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    fail++;
    assertions.push({ label: 'FATAL', ok: false, detail: err.message });
  } finally {
    const decision = fail > 0 || psmWarnings.length > 0 ? 'FAIL' : 'PASS';
    const result = {
      suite: SUITE_NAME, completed: true, decision, pass, fail, total: pass + fail,
      refImage: refPath, targetImage: targetPath, psmWarnings, pageErrors,
      intensityResults, executablePath, assertions, generatedAt: new Date().toISOString(),
    };
    try {
      const coreFiles = (await fs.readdir(path.join(ROOT, 'core'))).filter(f => f.endsWith('.js'));
      result.sourceHashes = {};
      for (const f of coreFiles) result.sourceHashes[f] = await sha256(path.join(ROOT, 'core', f));
    } catch { /* best-effort */ }
    await fs.writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
    console.log(`Final decision: ${decision}`);
    await browser.close();
    server.server.close();
    process.exit(decision === 'PASS' ? 0 : 1);
  }
}

main();
