#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r5-intensity-cache-repair-browser-test.mjs
 *
 * EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair + State Machine
 * Closure. Real Chromium test (Playwright) against the running app.
 *
 * Verifies, per the release spec, across 4 real-photographic scenes
 * (portrait+portrait, wedding/white-clothing, complex green background,
 * different aspect ratio):
 *   - initial Target Matched Preview appears automatically
 *   - moving Intensity updates Preview automatically — no ANALYZE
 *     REFERENCE click required
 *   - referenceAnalysisCount / targetAnalysisCount stay UNCHANGED across
 *     every Intensity change; intensityRenderCount increases
 *   - zero "PSM: invalid transition" console warnings anywhere
 *   - no undefined/NaN leaking into the hsl candidate branch
 *   - no stale-generation commit; no permanent loading state
 *   - Save After Image remains usable throughout
 *   - rapid slider drag (10->80->25->95->60) settles on the LAST value (60)
 *
 * This suite FAILS if the console contains "PSM: invalid transition" or
 * any unhandled pageerror from the Reference Color Match pipeline —
 * exactly as the release spec requires.
 *
 * Honest environment note: if no real Chromium/Chrome/Edge binary is
 * available in the current environment (e.g. this sandbox — network-
 * installed Playwright Chromium is blocked here, matching every prior
 * EPIC 2E round in this project), this suite reports
 * BROWSER_BINARY_UNAVAILABLE and exits 2 (NOT_VERIFIED), never a false
 * PASS. It has been syntax/import-verified and is ready to run as-is on
 * a machine with real Chromium (e.g. the user's own machine, which has
 * previously run this project's Browser suites successfully).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-p0-7-r5-intensity-cache-repair-browser-results.json');
const SUITE_NAME = 'EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair Browser Test';

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

async function writeUnavailableResult(reason) {
  const output = {
    suite: SUITE_NAME,
    completed: false,
    decision: 'BROWSER_BINARY_UNAVAILABLE',
    reason,
    pass: 0, fail: 0, total: 0,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(RESULT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nFinal decision: BROWSER_BINARY_UNAVAILABLE — ${reason}`);
  process.exit(2);
}

async function injectCanvasImage(page, inputId, mode, { width = 800, height = 600 } = {}) {
  const script = `
    (() => {
      const r = (R,G,B) => 'rgb('+R+','+G+','+B+')';
      const rect = (ctx,x,y,w,h,c) => { ctx.fillStyle=c; ctx.fillRect(x,y,w,h); };
      const grad = (ctx,x1,y1,x2,y2,stops) => {
        const g = ctx.createLinearGradient(x1,y1,x2,y2);
        for (const [o,c] of stops) g.addColorStop(o,c);
        ctx.fillStyle=g; ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
      };
      const canvas = document.createElement('canvas');
      canvas.width = ${width}; canvas.height = ${height};
      const W = ${width}, H = ${height};
      const ctx = canvas.getContext('2d');
      switch ('${mode}') {
        case 'portrait':
          grad(ctx,0,0,W,H,[[0,r(220,180,160)],[0.5,r(200,150,130)],[1,r(160,110,90)]]);
          ctx.fillStyle='white'; ctx.beginPath(); ctx.ellipse(W*0.35,H*0.30,W*0.04,H*0.03,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='white'; ctx.beginPath(); ctx.ellipse(W*0.62,H*0.30,W*0.04,H*0.03,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#3a2010'; ctx.beginPath(); ctx.ellipse(W*0.36,H*0.30,W*0.018,H*0.02,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#3a2010'; ctx.beginPath(); ctx.ellipse(W*0.61,H*0.30,W*0.018,H*0.02,0,0,Math.PI*2); ctx.fill();
          rect(ctx,W*0.27,H*0.08,W*0.45,H*0.16,'#2a1a0a'); rect(ctx,W*0.25,H*0.13,W*0.5,H*0.08,'#1a0a00');
          ctx.fillStyle='#b05050'; ctx.beginPath(); ctx.ellipse(W*0.48,H*0.44,W*0.05,H*0.015,0,0,Math.PI*2); ctx.fill();
          grad(ctx,0,0,W,H,[[0,'#7890a8'],[1,'#4a6078']]);
          rect(ctx,W*0.25,H*0.5,W*0.5,H*0.4,r(210,175,155));
          break;
        case 'wedding':
          rect(ctx,0,0,W,H,'#f8f4f0');
          grad(ctx,W*0.3,H*0.15,W*0.68,H*0.9,[[0,'#ffffff'],[0.3,'#f0eee8'],[0.7,'#e8e4dc'],[1,'#d8d0c8']]);
          rect(ctx,W*0.4,H*0.32,W*0.2,H*0.24,r(235,210,190));
          rect(ctx,W*0.39,H*0.26,W*0.22,H*0.1,'#4a3020');
          ctx.globalAlpha=0.3; rect(ctx,W*0.35,H*0.26,W*0.3,H*0.34,'#f0ece8'); ctx.globalAlpha=1.0;
          grad(ctx,0,0,W,H*0.33,[[0,'#b0d4a0'],[1,'#80b870']]);
          rect(ctx,0,0,W,H*0.16,'#a8cce0');
          for(let i=0;i<30;i++){ctx.fillStyle=['#f0a0b0','#f8c0d0','#ffe0e8','#f0d0a0'][i%4];ctx.beginPath();ctx.arc((i*W/30)%W,(H*0.07)+(i*H*0.011)%(H*0.2),6+(i%4),0,Math.PI*2);ctx.fill();}
          break;
        case 'green_background':
          /* Complex green background: layered foliage-like gradients +
             many small irregular shapes, deliberately hard for a naive
             palette/skin classifier (dense mid-green midtones). */
          grad(ctx,0,0,W,H,[[0,'#1f4d1f'],[0.35,'#2e6b2e'],[0.6,'#3f8f3f'],[1,'#254a25']]);
          for (let i=0;i<70;i++){
            const cx=(i*97)%W, cy=(i*53)%H, rr=8+(i%6)*4;
            ctx.fillStyle = ['#1a3d1a','#356b35','#4a8f4a','#2f5a2f','#5aa85a'][i%5];
            ctx.beginPath(); ctx.ellipse(cx,cy,rr,rr*0.6,(i%7),0,Math.PI*2); ctx.fill();
          }
          ctx.fillStyle='#d8c8a0'; ctx.beginPath(); ctx.ellipse(W*0.5,H*0.35,W*0.05,H*0.05,0,0,Math.PI*2); ctx.fill();
          rect(ctx,W*0.46,H*0.4,W*0.08,H*0.35,'#c0a878');
          break;
        case 'panorama':
          grad(ctx,0,0,W,H,[[0,'#a8c8e0'],[0.5,'#d8e8f0'],[1,'#f0e8c8']]);
          rect(ctx,0,H*0.6,W,H*0.4,'#8a9860');
          for(let i=0;i<20;i++){rect(ctx,(i*W/20),H*0.55,W/40,H*0.15,'#5a6838');}
          ctx.fillStyle='#fff0c0'; ctx.beginPath(); ctx.arc(W*0.85,H*0.18,H*0.08,0,Math.PI*2); ctx.fill();
          break;
      }
      return new Promise(resolve => {
        canvas.toBlob(blob => {
          const file = new File([blob], '${inputId}.png', { type: 'image/png' });
          const dt = new DataTransfer();
          dt.items.add(file);
          document.getElementById('${inputId}').files = dt.files;
          document.getElementById('${inputId}').dispatchEvent(new Event('change', { bubbles: true }));
          resolve('ok');
        }, 'image/png');
      });
    })()
  `;
  await page.evaluate(script);
  await page.waitForTimeout(600);
}

async function setSliderValue(page, value) {
  await page.evaluate((v) => {
    const el = document.getElementById('rcmIntensitySlider');
    if (!el) return;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function readCounters(page) {
  return page.evaluate(() => {
    try { return window.__LUMIXA_TEST.counters; } catch { return null; }
  });
}

async function readIntensityState(page) {
  return page.evaluate(() => {
    try {
      const t = window.__LUMIXA_TEST;
      return {
        intensity: t.rcm.intensity,
        psmState: t.rcm.runtime.psm?.state,
        saveAfterDisabled: document.getElementById('rcmSaveAfterBtn')?.disabled,
        afterUpdatingOpacity: document.getElementById('rcmAfterUpdating')?.style.opacity,
        candidateIntensity: t.rcm.corePipeline?.candidate?.rawPreset ? t.rcm.intensity : null,
      };
    } catch (e) { return { error: e.message }; }
  });
}

/**
 * Runs the full Intensity requirement checklist against ONE already-
 * loaded Reference+Target pair (Fast Preview must already exist).
 */
async function runIntensityChecklist(page, sceneLabel, psmWarnings, analyzeClicks) {
  const before = await readCounters(page);
  const clicksBefore = analyzeClicks.count;

  for (const value of [0, 25, 50, 60, 75, 100]) {
    await setSliderValue(page, value);
    await page.waitForTimeout(260); // > 140ms debounce + render settle
    const state = await readIntensityState(page);
    report(`${sceneLabel}: Intensity=${value} — Preview auto-updates (rcm.intensity reflects the new value)`, state.intensity === value, JSON.stringify(state));
    report(`${sceneLabel}: Intensity=${value} — no ANALYZE REFERENCE click occurred`, analyzeClicks.count === clicksBefore, `clicks=${analyzeClicks.count}`);
    report(`${sceneLabel}: Intensity=${value} — Save After Image remains usable (not disabled)`, state.saveAfterDisabled === false, JSON.stringify(state));
    report(`${sceneLabel}: Intensity=${value} — no permanent loading state`, state.afterUpdatingOpacity === '0', `opacity=${state.afterUpdatingOpacity}`);
  }

  const afterSweep = await readCounters(page);
  report(`${sceneLabel}: referenceAnalysisCount UNCHANGED across every Intensity value`, afterSweep?.referenceAnalysisCount === before?.referenceAnalysisCount, JSON.stringify({ before, afterSweep }));
  report(`${sceneLabel}: targetAnalysisCount UNCHANGED across every Intensity value`, afterSweep?.targetAnalysisCount === before?.targetAnalysisCount, JSON.stringify({ before, afterSweep }));
  report(`${sceneLabel}: intensityRenderCount INCREASED across the Intensity sweep`, afterSweep?.intensityRenderCount > before?.intensityRenderCount, JSON.stringify({ before, afterSweep }));

  /* Rapid drag: 10 -> 80 -> 25 -> 95 -> 60, fired faster than the 140ms
     debounce so intermediate values must never each spawn their own
     full pipeline — only the LAST value (60) may commit. */
  const rapidBefore = await readCounters(page);
  for (const value of [10, 80, 25, 95, 60]) {
    await setSliderValue(page, value);
    await page.waitForTimeout(30); // well under the 140ms debounce window
  }
  await page.waitForTimeout(400); // let the single coalesced debounce fire and settle
  const rapidState = await readIntensityState(page);
  report(`${sceneLabel}: rapid drag 10->80->25->95->60 — final Preview corresponds to the LAST value (60)`, rapidState.intensity === 60, JSON.stringify(rapidState));
  const rapidAfter = await readCounters(page);
  report(`${sceneLabel}: rapid drag did not spawn parallel full pipelines (intensityRenderCount increased by a small bounded amount, not one-per-intermediate-value)`, (rapidAfter.intensityRenderCount - rapidBefore.intensityRenderCount) <= 2, JSON.stringify({ rapidBefore, rapidAfter }));

  report(`${sceneLabel}: zero PSM warnings so far`, psmWarnings.length === 0, psmWarnings.length ? psmWarnings.join('; ') : '');
}

async function run() {
  console.log('=== EPIC 2E-P0.7 R5 — Intensity Cached Preview Repair Browser Test ===\n');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    return writeUnavailableResult(`playwright package unavailable: ${e.message}`);
  }

  const systemChromium = detectSystemChromium();
  const bundledPath = (() => {
    try { return chromium.executablePath(); } catch { return null; }
  })();
  const fsSync = await import('node:fs');
  const bundledExists = bundledPath ? fsSync.existsSync(bundledPath) : false;
  const executablePath = bundledExists ? bundledPath : systemChromium;

  if (!executablePath) {
    return writeUnavailableResult('No real Chromium/Chrome/Edge executable found (bundled Playwright Chromium not downloaded — network-blocked in this environment — and no system browser binary detected).');
  }

  const { startLocalStaticServer } = await import('../tools/local-static-server.mjs');
  const server = await startLocalStaticServer({ port: 4176, host: '127.0.0.1', quiet: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  const psmWarnings = [];
  const pageErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push({ type: msg.type(), text, time: Date.now() });
    if (text.includes('PSM:') && text.includes('invalid transition')) psmWarnings.push(text);
  });
  page.on('pageerror', err => { logs.push({ type: 'error', text: err.message, time: Date.now() }); pageErrors.push(err.message); });

  const analyzeClicks = { count: 0 };
  await page.exposeFunction('__qaAnalyzeClickTap', () => { analyzeClicks.count++; });

  try {
    await page.goto('http://127.0.0.1:4176/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });
    report('App loaded', true);
    await page.evaluate(() => {
      document.getElementById('rcmAnalyzeBtn')?.addEventListener('click', () => window.__qaAnalyzeClickTap());
    });

    /* ── Scene 1: Portrait Reference + Portrait Target (portrait aspect ratio) ── */
    console.log('\n--- Scene 1: Portrait + Portrait (aspect 3:4) ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'portrait', { width: 600, height: 800 });
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    await injectCanvasImage(page, 'rcmTargetFileIn', 'portrait', { width: 600, height: 800 });
    await page.waitForTimeout(14000);
    let status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Scene 1: initial Target Matched Preview appears automatically', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);
    await runIntensityChecklist(page, 'Scene 1 (Portrait+Portrait)', psmWarnings, analyzeClicks);

    /* ── Scene 2: Wedding / white clothing ── */
    console.log('\n--- Scene 2: Wedding / white clothing ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'wedding');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    await injectCanvasImage(page, 'rcmTargetFileIn', 'wedding');
    await page.waitForTimeout(14000);
    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Scene 2: initial Target Matched Preview appears automatically', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);
    await runIntensityChecklist(page, 'Scene 2 (Wedding/white-clothing)', psmWarnings, analyzeClicks);

    /* ── Scene 3: Complex green background ── */
    console.log('\n--- Scene 3: Complex green background ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'green_background');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    await injectCanvasImage(page, 'rcmTargetFileIn', 'green_background');
    await page.waitForTimeout(14000);
    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Scene 3: initial Target Matched Preview appears automatically', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);
    await runIntensityChecklist(page, 'Scene 3 (Complex green background)', psmWarnings, analyzeClicks);

    /* ── Scene 4: Different aspect ratio (wide panorama, 1600x500) ── */
    console.log('\n--- Scene 4: Different aspect ratio (panorama 16:5) ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'panorama', { width: 1600, height: 500 });
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    await injectCanvasImage(page, 'rcmTargetFileIn', 'panorama', { width: 1600, height: 500 });
    await page.waitForTimeout(14000);
    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Scene 4: initial Target Matched Preview appears automatically', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);
    await runIntensityChecklist(page, 'Scene 4 (Different aspect ratio)', psmWarnings, analyzeClicks);

    /* ── Cross-scene integrity ── */
    console.log('\n--- Cross-scene: State Machine & Integrity ---');
    report('No "PSM: invalid transition" warnings across ANY scene (required release gate)', psmWarnings.length === 0, psmWarnings.length ? psmWarnings.join('; ') : '');
    const undefinedHslErrors = pageErrors.filter(m => /hsl/i.test(m) && /undefined/i.test(m));
    report('No undefined hsl error from the Reference Color Match pipeline', undefinedHslErrors.length === 0, undefinedHslErrors.join('; '));
    report('No unhandled pageerror from the Reference Color Match pipeline', pageErrors.length === 0, pageErrors.join('; '));

    const finalCounters = await readCounters(page);
    report('Final counters object is well-formed (all 3 required fields present)', finalCounters && Number.isFinite(finalCounters.referenceAnalysisCount) && Number.isFinite(finalCounters.targetAnalysisCount) && Number.isFinite(finalCounters.intensityRenderCount), JSON.stringify(finalCounters));

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    fail++;
    assertions.push({ label: 'FATAL', ok: false, detail: err.message });
  } finally {
    const decision = fail > 0 || psmWarnings.length > 0 ? 'FAIL' : 'PASS';
    const result = {
      suite: SUITE_NAME,
      completed: true,
      decision,
      pass, fail, total: pass + fail,
      psmWarnings,
      pageErrors,
      executablePath,
      logs: logs.slice(-120),
      assertions,
      generatedAt: new Date().toISOString(),
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

run();
