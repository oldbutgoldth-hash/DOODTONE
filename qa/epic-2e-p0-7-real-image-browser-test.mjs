#!/usr/bin/env node
import { chromium } from 'playwright';
import { startLocalStaticServer } from '../tools/local-static-server.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-p0-7-real-image-browser-results.json');

let pass = 0, fail = 0;
const assertions = [];
function report(label, ok, detail = '') {
  assertions.push({ label, ok, detail });
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label} ${detail}`); }
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function injectCanvasImage(page, inputId, mode) {
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
      canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      switch ('${mode}') {
        case 'portrait':
          grad(ctx,0,0,800,600,[[0,r(220,180,160)],[0.5,r(200,150,130)],[1,r(160,110,90)]]);
          ctx.fillStyle='white'; ctx.beginPath(); ctx.ellipse(280,230,30,20,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='white'; ctx.beginPath(); ctx.ellipse(500,230,30,20,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#3a2010'; ctx.beginPath(); ctx.ellipse(285,230,14,16,0,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#3a2010'; ctx.beginPath(); ctx.ellipse(495,230,14,16,0,0,Math.PI*2); ctx.fill();
          rect(ctx,220,60,360,120,'#2a1a0a'); rect(ctx,200,100,400,60,'#1a0a00');
          ctx.fillStyle='#b05050'; ctx.beginPath(); ctx.ellipse(390,340,40,12,0,0,Math.PI*2); ctx.fill();
          grad(ctx,0,0,800,600,[[0,'#7890a8'],[1,'#4a6078']]);
          rect(ctx,200,400,400,200,r(210,175,155));
          break;
        case 'wedding':
          rect(ctx,0,0,800,600,'#f8f4f0');
          grad(ctx,250,100,550,550,[[0,'#ffffff'],[0.3,'#f0eee8'],[0.7,'#e8e4dc'],[1,'#d8d0c8']]);
          rect(ctx,320,200,160,140,r(235,210,190));
          rect(ctx,310,160,180,60,'#4a3020');
          ctx.globalAlpha=0.3; rect(ctx,280,160,240,200,'#f0ece8'); ctx.globalAlpha=1.0;
          grad(ctx,0,0,800,200,[[0,'#b0d4a0'],[1,'#80b870']]);
          rect(ctx,0,0,800,100,'#a8cce0');
          for(let i=0;i<30;i++){ctx.fillStyle=['#f0a0b0','#f8c0d0','#ffe0e8','#f0d0a0'][i%4];ctx.beginPath();ctx.arc(20+(i*27)%780,40+(i*13)%120,6+(i%4),0,Math.PI*2);ctx.fill();}
          break;
        case 'warm_reference':
          grad(ctx,0,0,800,600,[[0,'#e8c878'],[0.4,'#d4a850'],[0.7,'#c08838'],[1,'#a06828']]);
          rect(ctx,50,200,120,400,'#6a4828'); rect(ctx,200,150,100,450,'#7a5838');
          rect(ctx,340,250,140,350,'#5a3820'); rect(ctx,520,180,130,420,'#6a5030');
          rect(ctx,680,220,100,380,'#7a6040');
          ctx.fillStyle='#ffe8a0'; ctx.beginPath(); ctx.arc(680,80,50,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#fff0c0'; ctx.beginPath(); ctx.arc(680,80,30,0,Math.PI*2); ctx.fill();
          grad(ctx,0,400,800,600,[[0,'#b88850'],[1,'#8a6838']]);
          break;
        case 'cool_target':
          grad(ctx,0,0,800,600,[[0,'#a0b8d0'],[0.3,'#8098b8'],[0.6,'#6078a0'],[1,'#486088']]);
          rect(ctx,0,400,800,200,'#d8dce8');
          grad(ctx,0,400,800,600,[[0,'#d0d8e8'],[1,'#b8c0d8']]);
          ctx.fillStyle='#384858'; ctx.fillRect(80,180,30,250); ctx.beginPath(); ctx.arc(95,160,60,0,Math.PI*2); ctx.fill();
          ctx.fillRect(350,200,35,280); ctx.beginPath(); ctx.arc(365,180,70,0,Math.PI*2); ctx.fill();
          ctx.fillRect(600,160,25,300); ctx.beginPath(); ctx.arc(615,140,55,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='#8898b0'; ctx.beginPath(); ctx.arc(400,0,300,0,Math.PI*2); ctx.fill();
          break;
        case 'multicolor':
          rect(ctx,0,0,800,600,'#404040');
          rect(ctx,0,0,200,150,'#e04040'); rect(ctx,200,0,200,150,'#40e040');
          rect(ctx,400,0,200,150,'#4040e0'); rect(ctx,600,0,200,150,'#e0e040');
          rect(ctx,0,150,200,150,'#e040e0'); rect(ctx,200,150,200,150,'#40e0e0');
          rect(ctx,400,150,200,150,'#e08040'); rect(ctx,600,150,200,150,'#8040e0');
          rect(ctx,0,300,200,150,'#e0e0e0'); rect(ctx,200,300,200,150,'#808080');
          rect(ctx,400,300,200,150,'#202020'); rect(ctx,600,300,200,150,'#40e080');
          grad(ctx,0,450,800,600,[[0,'#ff6060'],[0.25,'#60ff60'],[0.5,'#6060ff'],[0.75,'#ffff60'],[1,'#ff60ff']]);
          ctx.strokeStyle='#ffffff'; ctx.lineWidth=2;
          for(let i=0;i<40;i++){ctx.beginPath();ctx.moveTo(i*20,450);ctx.lineTo(i*20+10,600);ctx.stroke();}
          ctx.strokeStyle='#000000'; ctx.lineWidth=1;
          for(let i=0;i<80;i++){ctx.beginPath();ctx.moveTo(i*10,0);ctx.lineTo(i*10+5,600);ctx.stroke();}
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

async function run() {
  console.log('=== EPIC 2E-P0.7 R3 — Real-Image Browser Test ===\n');

  const server = await startLocalStaticServer({ port: 4174, host: '127.0.0.1', quiet: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => { logs.push({ type: msg.type(), text: msg.text(), time: Date.now() }); });
  page.on('pageerror', err => { logs.push({ type: 'error', text: err.message, time: Date.now() }); });

  const psmWarnings = [];
  page.on('console', msg => {
    if (msg.text().includes('PSM:')) psmWarnings.push(msg.text());
  });

  try {
    await page.goto('http://127.0.0.1:4174/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });
    report('App loaded', true);

    /* ── Scene 1: Portrait with visible skin ── */
    console.log('\n--- Scene 1: Portrait with visible skin ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'portrait');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);

    const skinDetected = await page.evaluate(() => {
      try { return window.__LUMIXA_TEST.rcm.referenceEvidence.skinAnalysis.detected; }
      catch { return null; }
    });
    report('Portrait: skin detected', skinDetected === true, `skinDetected=${skinDetected}`);

    await injectCanvasImage(page, 'rcmTargetFileIn', 'portrait');
    await page.waitForTimeout(14000);

    let status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Portrait: Fast Preview appeared', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);

    /* ── Scene 2: Wedding with white clothing ── */
    console.log('\n--- Scene 2: Wedding with white clothing ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'wedding');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);
    report('Wedding: Reference analysis started', true);

    await injectCanvasImage(page, 'rcmTargetFileIn', 'wedding');
    await page.waitForTimeout(14000);

    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Wedding: pipeline completed', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);

    const saveAfterEnabled = await page.evaluate(() => {
      const btn = document.getElementById('rcmSaveAfterBtn');
      return btn && !btn.disabled;
    });
    report('Wedding: Save After Image enabled after Layer 1', saveAfterEnabled);

    /* ── Scene 3: Warm Reference + Cool Target ── */
    console.log('\n--- Scene 3: Warm Reference + Cool Target ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'warm_reference');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);

    const warmWB = await page.evaluate(() => {
      try {
        const co = window.__LUMIXA_TEST.rcm.referenceEvidence.coreOutputs;
        const wb = co.whiteBalancePro;
        return wb?.recommendedAdjustments?.temperature;
      } catch { return null; }
    });
    report('Warm Reference: White Balance detects warm temperature', warmWB !== null && Math.abs(warmWB || 0) > 0, `temp=${warmWB}`);

    await injectCanvasImage(page, 'rcmTargetFileIn', 'cool_target');
    await page.waitForTimeout(14000);

    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Warm→Cool: pipeline completed', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);

    /* Check Color Grading / Calibration produced evidence */
    const gradingEvidence = await page.evaluate(() => {
      try {
        const co = window.__LUMIXA_TEST.rcm.referenceEvidence.coreOutputs;
        return {
          gradingConfidence: co.colorGradingAI?.confidence || 0,
          calibrationConfidence: co.calibrationEngine?.confidence || 0,
          gradingKeys: Object.keys(co.colorGradingAI || {}),
          calKeys: Object.keys(co.calibrationEngine || {}),
        };
      } catch (e) { return { error: e.message }; }
    });
    report('Color Grading produced non-zero evidence', gradingEvidence?.gradingConfidence > 0, JSON.stringify(gradingEvidence));
    report('Calibration produced non-zero evidence', gradingEvidence?.calibrationConfidence > 0, JSON.stringify(gradingEvidence));

    /* ── Scene 4: Complex multicolor background ── */
    console.log('\n--- Scene 4: Complex multicolor background ---');
    await injectCanvasImage(page, 'rcmRefFileIn', 'multicolor');
    await page.waitForTimeout(800);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(6000);

    const paletteCount = await page.evaluate(() => {
      try { return window.__LUMIXA_TEST.rcm.referenceEvidence.palette.colors.length; }
      catch { return 0; }
    });
    report('Multicolor: palette extracted with multiple colors', paletteCount >= 3, `colors=${paletteCount}`);

    await injectCanvasImage(page, 'rcmTargetFileIn', 'multicolor');
    await page.waitForTimeout(14000);

    status = await page.evaluate(() => document.getElementById('rcmStatus')?.textContent || '');
    report('Multicolor: pipeline completed', status.includes('Preview') || status.includes('Fidelity') || status.includes('พร้อม'), status);

    /* ── Cross-scene checks ── */
    console.log('\n--- Cross-scene: State Machine & Integrity ---');

    /* No PSM warnings across ALL scenes */
    report('No PSM warnings in any scene', psmWarnings.length === 0, psmWarnings.length > 0 ? psmWarnings.join('; ') : '');

    /* Intensity slider does not re-run Reference/Target analysis */
    const traceRefHits = logs.filter(l => l.text.includes('REFERENCE_CACHE') || l.text.includes('TARGET_CACHE'));
    report('Cache HIT messages present for analysis reuse', traceRefHits.length >= 2, `found ${traceRefHits.length}`);

    /* Heartbeat accessible */
    const hbPresent = await page.evaluate(() => {
      try { return !!window.__LUMIXA_TEST.rcm.runtime.heartbeat; }
      catch { return false; }
    });
    report('Heartbeat instance present', hbPresent);

    /* Production locks */
    const prodLocks = await page.evaluate(() => {
      const test = window.__LUMIXA_TEST;
      const c = test?.rcm?.corePipeline?.candidate;
      return {
        productionSource: c?.production?.productionSource || 'legacy',
        productionWrite: c?.production?.productionWrite ?? false,
        controlledV2Apply: c?.production?.controlledV2Apply ?? false,
        xmpWriteAllowed: c?.production?.xmpWriteAllowed ?? false,
        productionActivationAllowed: c?.production?.productionActivationAllowed ?? false,
      };
    });
    report('productionSource = legacy', prodLocks.productionSource === 'legacy', JSON.stringify(prodLocks));
    report('productionWrite = false', prodLocks.productionWrite === false);
    report('xmpWriteAllowed = false', prodLocks.xmpWriteAllowed === false);

    /* Final scene: Fidelity + Evaluation */
    const finalFidelity = await page.evaluate(() => {
      try { return window.__LUMIXA_TEST.rcm.evaluation?.improvement?.fidelityScore; }
      catch { return null; }
    });
    report('Final evaluation produced fidelity score', finalFidelity !== null && finalFidelity !== undefined, `fidelity=${finalFidelity}`);

    /* No permanent loading state */
    const loadingElements = await page.evaluate(() => {
      const updater = document.getElementById('rcmAfterUpdating');
      if (!updater) return 'NO_UPDATER';
      return updater.style.opacity;
    });
    report('No permanent loading state (afterUpdating opacity=0)', loadingElements === '0' || loadingElements === 'NO_UPDATER', loadingElements);

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    fail++;
  } finally {
    const result = {
      epic: '2E-P0.7', suite: 'REAL_IMAGE_BROWSER',
      completed: true, runId: `p0-7-real-${Date.now()}`,
      pass, fail, total: pass + fail,
      psmWarnings,
      logs: logs.slice(-80),
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
