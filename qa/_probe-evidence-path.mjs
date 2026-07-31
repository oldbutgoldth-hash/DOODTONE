import { chromium } from 'playwright';
import { startLocalStaticServer } from '../tools/local-static-server.mjs';

const server = await startLocalStaticServer({ port: 4176, host: '127.0.0.1', quiet: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4176/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });

await page.evaluate(`(() => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8c878'; ctx.fillRect(0,0,800,600);
  ctx.fillStyle = '#6a4828'; ctx.fillRect(50,200,120,400);
  return new Promise(r => c.toBlob(blob => {
    const f = new File([blob], 'ref.png', {type:'image/png'});
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById('rcmRefFileIn').files = dt.files;
    document.getElementById('rcmRefFileIn').dispatchEvent(new Event('change',{bubbles:true}));
    r('ok');
  },'image/png'));
})()`);
await page.waitForTimeout(1000);
await page.click('#rcmAnalyzeBtn');
await page.waitForTimeout(10000);

const result = await page.evaluate(() => {
  const t = window.__LUMIXA_TEST;
  const r = t.rcm;
  const info = {};
  if (r.referenceEvidence && r.referenceEvidence.coreOutputs) {
    info.coKeys = Object.keys(r.referenceEvidence.coreOutputs);
    info.coGrading = r.referenceEvidence.coreOutputs.colorGradingAI?.confidence;
    info.coCal = r.referenceEvidence.coreOutputs.calibrationEngine?.confidence;
  }
  if (r.corePipeline && r.corePipeline.analysis) {
    info.analysisKeys = Object.keys(r.corePipeline.analysis);
  }
  if (r.corePipeline && r.corePipeline.candidate && r.corePipeline.candidate.safePreset) {
    info.spKeys = Object.keys(r.corePipeline.candidate.safePreset);
  }
  return JSON.stringify(info);
});
console.log(result);
await browser.close();
server.server.close();
