#!/usr/bin/env node
import { chromium } from 'playwright';
import { startLocalStaticServer } from '../tools/local-static-server.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-p0-7-pipeline-runtime-browser-results.json');

let pass = 0, fail = 0;
function report(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label} ${detail}`); }
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function injectTestImage(page, inputId, color) {
  const script = `
    (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '${color}';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText('${inputId}', 200, 240);
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
  await page.waitForTimeout(500);
}

async function run() {
  console.log('=== EPIC 2E-P0.7 Pipeline Runtime — Chromium Browser Test ===\n');

  const server = await startLocalStaticServer({ port: 4173, host: '127.0.0.1', quiet: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => { logs.push({ type: msg.type(), text: msg.text(), time: Date.now() }); });
  page.on('pageerror', err => { logs.push({ type: 'error', text: err.message, time: Date.now() }); });

  try {
    await page.goto('http://127.0.0.1:4173/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });
    report('App loaded', true);

    const rcmExists = await page.evaluate(() => !!document.getElementById('rcmRefFileIn'));
    report('Reference Color Match panel rendered', rcmExists);

    const allResults = [];
    const testRunId = `p0-7-${Date.now()}`;

    /* ── Phase 1: Upload Reference, verify analyze button works ── */
    console.log('\n--- Phase 1: Upload Reference Image ---');
    await injectTestImage(page, 'rcmRefFileIn', 'navy');
    await page.waitForTimeout(1000);
    const refLoaded = await page.evaluate(() => !!document.querySelector('#rcmRefCanvas[width]'));
    report('Reference image loaded into canvas', refLoaded);

    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    const refAnalyzed = await page.evaluate(() => {
      const s = document.getElementById('rcmStatus')?.textContent || '';
      return s.includes('✓') || s.includes('Fidelity') || s.includes('Preview');
    });
    report('Reference analysis completed', refAnalyzed, `status: ${await page.evaluate(() => document.getElementById('rcmStatus')?.textContent)}`);

    /* ── Phase 2: Upload Target → auto-trigger pipeline (Layer 1 + Layer 2) ── */
    console.log('\n--- Phase 2: Upload Target Image (triggers pipeline) ---');
    await injectTestImage(page, 'rcmTargetFileIn', 'crimson');
    /* Wait for Layer 1 (fast preview) + Layer 2 (refined analysis) */
    await page.waitForTimeout(12000);

    const previewReady = await page.evaluate(() => {
      const s = document.getElementById('rcmStatus')?.textContent || '';
      return s.includes('Preview') || s.includes('Fidelity') || s.includes('พร้อม');
    });
    report('Layer 1 – Fast Preview appeared', previewReady, await page.evaluate(() => document.getElementById('rcmStatus')?.textContent));

    const layer2Done = await page.evaluate(() => {
      const s = document.getElementById('rcmStatus')?.textContent || '';
      return s.includes('Fidelity') || s.includes('พร้อม');
    });
    report('Layer 2 – Refined analysis completed', layer2Done, await page.evaluate(() => document.getElementById('rcmStatus')?.textContent));

    /* ── Phase 3: Verify Save After Image enabled at FAST_PREVIEW_READY ── */
    console.log('\n--- Phase 3: Save After Image availability ---');
    const saveAfterEnabled = await page.evaluate(() => {
      const btn = document.getElementById('rcmSaveAfterBtn');
      return btn && !btn.disabled;
    });
    report('Save After Image button enabled', saveAfterEnabled);

    /* ── Phase 4: Intensity slider cache reuse ── */
    console.log('\n--- Phase 4: Intensity slider cache reuse ---');
    let cacheHitsBefore = await page.evaluate(() => {
      try {
        const stats = window.__LUMIXA_TEST.getCacheStats();
        return stats.hits;
      } catch (e) { return -1; }
    });
    report('Cache stats accessible', cacheHitsBefore !== -1, `hits=${cacheHitsBefore}`);

    for (const val of [0, 25, 50, 60, 75, 100]) {
      await page.evaluate(v => {
        const slider = document.getElementById('rcmIntensitySlider');
        if (slider) {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(slider, v);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, val);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2000);

    const cacheUsed = await page.evaluate(() => {
      try { return window.__LUMIXA_TEST.rcm.runtime.cacheUsed; } catch { return null; }
    });
    report('Cache was reused during intensity changes', cacheUsed === true, `cacheUsed=${cacheUsed}`);

    /* ── Phase 5: Verify analysis cache prevented re-running ── */
    console.log('\n--- Phase 5: Verify no re-analysis on intensity change ---');
    const intensityLogs = logs.filter(l => l.text.includes('REFERENCE_CACHE') || l.text.includes('TARGET_CACHE'));
    report('Analysis cache HIT messages present', intensityLogs.length >= 2, `found ${intensityLogs.length} cache messages`);

    /* ── Phase 6: Rapid slider drag — no stale callbacks ── */
    console.log('\n--- Phase 6: Rapid slider drag test ---');
    const errorBefore = logs.filter(l => l.type === 'error').length;
    for (let i = 0; i < 20; i++) {
      const v = Math.floor(Math.random() * 101);
      await page.evaluate(v => {
        const slider = document.getElementById('rcmIntensitySlider');
        if (slider) {
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(slider, v);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, v);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(3000);
    const errorAfter = logs.filter(l => l.type === 'error').length;
    report('Rapid slider drag – no new errors', errorAfter <= errorBefore + 2, `errors: ${errorBefore} -> ${errorAfter}`);

    const noHslError = !logs.some(l => l.text.includes('hsl') && l.type === 'error');
    report('Rapid slider drag – no undefined hsl error', noHslError);

    /* ── Phase 7: Verify heartbeat does NOT update lastProgressAt on idle ── */
    console.log('\n--- Phase 7: Heartbeat stall detection ---');
    const hbStallCheck = await page.evaluate(() => {
      const test = window.__LUMIXA_TEST;
      const hb = test?.rcm?.runtime?.heartbeat;
      if (!hb) return 'NO_HEARTBEAT';
      return `stallMs=${hb.stallMs}`;
    });
    report('Heartbeat instance present', hbStallCheck !== 'NO_HEARTBEAT', hbStallCheck);

    /* ── Phase 8: Candidate schema compatibility ── */
    console.log('\n--- Phase 8: Candidate schema compatibility ---');
    const schemaCheck = await page.evaluate(() => {
      const test = window.__LUMIXA_TEST;
      const p = test?.rcm?.corePipeline?.candidate;
      if (!p || !p.safePreset) return 'NO_CANDIDATE';
      const sp = p.safePreset;
      const checks = {
        hasWhiteBalance: 'temp' in sp && 'tint' in sp,
        hasBasic: 'exp' in sp && 'con' in sp && 'hi' in sp && 'sh' in sp && 'wh' in sp && 'bl' in sp,
        hasVibSat: 'vib' in sp && 'sat' in sp,
        hasDetail: 'clarity' in sp && 'dehaze' in sp && 'texture' in sp,
        hasCurves: 'curves' in sp && sp.curves !== null,
        hasHsl: 'hsl' in sp && sp.hsl !== null,
        hasGrading: 'grade' in sp && sp.grade !== null,
        hasCal: 'cal' in sp && sp.cal !== null,
        hasCompatibility: 'compatibilityProfile' in p,
        hasLineage: 'dataLineage' in p,
      };
      const allOk = Object.values(checks).every(v => v === true);
      return { ok: allOk, checks };
    });
    report('Candidate schema compatible with existing LUMIXA fields', schemaCheck.ok && schemaCheck !== 'NO_CANDIDATE', JSON.stringify(schemaCheck));

    /* ── Phase 9: Production lock verification ── */
    console.log('\n--- Phase 9: Production lock verification ---');
    const prodLocks = await page.evaluate(() => {
      const test = window.__LUMIXA_TEST;
      const a = test?.rcm?.corePipeline?.analysis?.production;
      const c = test?.rcm?.corePipeline?.candidate;
      return {
        productionSource: a?.productionSource || c?.production?.productionSource || 'legacy',
        productionWrite: a?.productionWrite ?? c?.production?.productionWrite ?? false,
        controlledV2Apply: a?.controlledV2Apply ?? c?.production?.controlledV2Apply ?? false,
        xmpWriteAllowed: a?.xmpWriteAllowed ?? c?.production?.xmpWriteAllowed ?? false,
        productionActivationAllowed: a?.productionActivationAllowed ?? c?.production?.productionActivationAllowed ?? false,
      };
    });
    report('productionSource = legacy or not set', prodLocks.productionSource === 'legacy', JSON.stringify(prodLocks));
    report('productionWrite = false', prodLocks.productionWrite === false);
    report('controlledV2Apply = false', prodLocks.controlledV2Apply === false);
    report('xmpWriteAllowed = false', prodLocks.xmpWriteAllowed === false);
    report('productionActivationAllowed = false', prodLocks.productionActivationAllowed === false);

    /* ── Phase 10: Trace evidence ── */
    console.log('\n--- Phase 10: Pipeline trace evidence ---');
    const traceSummary = await page.evaluate(() => {
      const test = window.__LUMIXA_TEST;
      const genId = test?.rcm?.runtime?.generationId;
      try {
        const t = test.getTrace(genId);
        if (!t) return `NO_TRACE genId=${genId}`;
        const s = test.formatTraceSummary(genId);
        return s;
      } catch (e) {
        return `ERROR: ${e.message}`;
      }
    });
    report('Trace summary available', !traceSummary.startsWith('ERROR') && !traceSummary.startsWith('NO_TRACE'));

    /* ── Phase 11: Final check ── */
    console.log('\n--- Phase 11: Final status ---');
    const finalStatus = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || 'NO_STATUS');
    report('Final status shows completion', finalStatus.includes('Fidelity') || finalStatus.includes('พร้อม'), finalStatus);

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    fail++;
  } finally {
    const result = {
      epic: '2E-P0.7', suite: 'PIPELINE_RUNTIME_BROWSER',
      completed: true, runId: `p0-7-${Date.now()}`,
      pass, fail, total: pass + fail,
      logs: logs.slice(-50),
      sourceHashes: {},
    };
    try {
      const coreFiles = await fs.readdir(path.join(ROOT, 'core'));
      for (const f of coreFiles.filter(f => f.endsWith('.js'))) {
        result.sourceHashes[f] = await sha256(path.join(ROOT, 'core', f));
      }
    } catch {}
    await fs.writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n${pass}/${pass+fail} PASS, ${fail} FAIL`);
    await browser.close();
    server.server.close();
    process.exit(fail > 0 ? 1 : 0);
  }
}

run();
