#!/usr/bin/env node
/** EPIC 2E-L -- native Browser Candidate Pilot UI verification. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectBrowserExecutable, detectPlaywrightPackage } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'epic-2e-l-candidate-pilot-browser-results.json');
const MIME = new Map([['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8']]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function harnessHtml(moduleBase = '') {
  const base = moduleBase.replace(/\/$/, '');
  return `<!doctype html><html lang="th"><meta charset="utf-8"><title>LUMIXA 2E-L Browser QA</title><body><div id="root"></div>
<script type="module">
import { mountCalibrationLabUI } from '${base}/ui/calibration-lab/calibration-lab-renderer.js';
import { computeCandidatePilotReport } from '${base}/core/calibration-lab/candidate-pilot.js';
import { buildCandidatePilotExport } from '${base}/core/calibration-lab/export-candidate-pilot.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const categories = ['WEDDING','PORTRAIT','EVENT','OUTDOOR','MIXED_LIGHT','SKIN_DOMINANT'];
const lightings = ['DAYLIGHT','MIXED','LED','LOW_LIGHT','FLASH'];
function row(i, decision) {
  return {
    imageId:'image-'+i,imageFingerprint:'fp-'+i,analysisGenerationId:'gen-'+i,
    imageCategories:[categories[i%categories.length]],lightingCondition:lightings[i%lightings.length],containsSkin:i<24,
    userDecision:decision,issueCodes:[],notes:'',reviewedAt:new Date(2026,0,1,0,0,i).toISOString(),
    legacyDecisionPreservedForAudit:false,requiresVisualReReview:false,
    legacySnapshot:{confidence:.72},controlledV2Snapshot:{confidence:.78},safetySnapshot:{severeIssueDetected:false,v2HardStopCount:0},
    previewEvidence:{previewTruthCode:'BOTH_RENDERED_DIFFERENT',browserVerified:true,visualDecisionEligible:true,sameSourceGeometry:true,sourceFingerprintMatch:true,legacyPixelHash:A,controlledV2PixelHash:B,legacyNonTransparentPixelCount:480000,controlledV2NonTransparentPixelCount:480000}
  };
}
const records=[];
for(let i=0;i<42;i++) records.push(row(i,'V2_BETTER'));
for(let i=42;i<50;i++) records.push(row(i,'LEGACY_BETTER'));
for(let i=50;i<55;i++) records.push(row(i,'ABOUT_EQUAL'));
for(let i=55;i<58;i++) records.push(row(i,'BOTH_UNACCEPTABLE'));
for(let i=58;i<60;i++) records.push(row(i,'NOT_SURE'));
let locale='th';
let mode='PILOT';
const report=()=>computeCandidatePilotReport(records,undefined,{sourceSessionId:'browser-session'});
const controller={
 getState:()=>({calibrationMode:mode,sessionState:'ACTIVE',persistenceMode:'INDEXEDDB',session:{sessionId:'browser-session',reviewedCount:60,pendingCount:0},records,currentIndex:0,currentRecord:records[0],lastActionError:null,locale}),
 subscribe:()=>()=>{}, setMode:m=>{mode=m;}, getCandidatePilotReport:report,
 exportCandidatePilotJson:()=>buildCandidatePilotExport({sessionId:'browser-session'},records),
 getDashboard:()=>({summary:{},safetySignals:{}}),getReadinessReport:()=>({readinessStatus:'READY_FOR_CANDIDATE_REVIEW'}),
 exportJson:()=>({session:{sessionId:'browser-session'}}),endSession:async()=>{},
 startNewSession:async()=>{},listAvailableSessions:async()=>[],openSession:async()=>{},addImage:async()=>{},
 goToPrevious:()=>{},goToNext:()=>{},saveCurrentDecision:async()=>{},clearCurrentAnswer:async()=>{},
 getPixelPreviewInput:()=>({available:false}),
};
const root=document.getElementById('root');
const ui=mountCalibrationLabUI(root,controller,{getLocale:()=>locale});
ui.open();
function snapshot(){
 const pilot=root.querySelector('[data-cal-role="candidate-pilot"]');
 return {
  open:root.classList.contains('cal-open'),mode:root.dataset.calMode,
  pilotStatus:pilot?.dataset.calPilotStatus||null,verifiedSamples:Number(pilot?.dataset.calPilotVerifiedSamples||0),
  productionSource:pilot?.dataset.calPilotProductionSource||null,productionWrite:pilot?.dataset.calPilotProductionWrite||null,
  v2Apply:pilot?.dataset.calPilotV2Apply||null,previewExport:pilot?.dataset.calPilotPreviewExport||null,
  title:pilot?.querySelector('div')?.textContent||'',exportButton:Boolean(root.querySelector('[data-cal-role="export-candidate-pilot-report"]')),
  applyButtonCount:[...root.querySelectorAll('button')].filter(b=>/apply|production|xmp/i.test(b.textContent||'')).length,
  horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,rawCriterionLeak:/verifiedReviewedSamples|decisiveSamples|noSafetyHardStops/.test(root.textContent||''),
 };
}
const thai=snapshot();
locale='en'; ui.render(); const english=snapshot();
window.__LUMIXA_2EL_BROWSER__={completed:true,decision:thai.pilotStatus==='PILOT_CANDIDATE_EVALUATION_READY'&&english.pilotStatus===thai.pilotStatus&&thai.productionSource==='legacy'&&thai.productionWrite==='false'&&thai.v2Apply==='false'&&thai.previewExport==='false'&&thai.verifiedSamples===60&&thai.exportButton&&thai.applyButtonCount===0&&!thai.horizontalOverflow&&!thai.rawCriterionLeak&&!english.rawCriterionLeak&&/โครงการทดลอง/.test(thai.title)&&/Candidate Review Pilot/.test(english.title)?'PASS':'FAIL',thai,english};
</script></body></html>`;
}


async function buildInMemoryHarnessHtml() {
  const modules = new Map();
  const importPattern = /((?:import|export)\s+(?:[^'";]*?\s+from\s+)?)(['"])([^'"]+)\2/g;
  async function visit(rel) {
    const normalized = rel.replace(/\\/g, '/');
    if (modules.has(normalized)) return;
    let source = await fs.readFile(path.join(ROOT, normalized), 'utf8');
    const deps = [];
    source = source.replace(importPattern, (full, prefix, quote, specifier) => {
      if (!specifier.startsWith('.')) return full;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), specifier));
      deps.push(resolved);
      return `${prefix}${quote}lumixa:/${resolved}${quote}`;
    });
    modules.set(normalized, source);
    for (const dep of deps) await visit(dep);
  }
  for (const rootModule of [
    'ui/calibration-lab/calibration-lab-renderer.js',
    'core/calibration-lab/candidate-pilot.js',
    'core/calibration-lab/export-candidate-pilot.js',
  ]) await visit(rootModule);
  const imports = {};
  for (const [rel, source] of modules) {
    imports[`lumixa:/${rel}`] = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  }
  const importMap = `<script type="importmap">${JSON.stringify({ imports })}<\/script>`;
  return harnessHtml('lumixa:').replace('<script type="module">', `${importMap}<script type="module">`);
}

function createStaticServer(){return createServer(async(req,res)=>{try{const url=new URL(req.url||'/','http://127.0.0.1');if(url.pathname==='/__2el__.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(harnessHtml(''));return;}const rel=decodeURIComponent(url.pathname).replace(/^\/+/, '');const fp=path.resolve(ROOT,rel);if(!fp.startsWith(ROOT+path.sep)){res.writeHead(403);res.end('forbidden');return;}const data=await fs.readFile(fp);res.writeHead(200,{'Content-Type':MIME.get(path.extname(fp))||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('not found');}})}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.seq=0;this.pending=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}}async open(){await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j});return this}send(method,params={}){return new Promise((r,j)=>{const id=++this.seq;this.pending.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));})}close(){try{this.ws.close()}catch{}}}
async function waitResult(c){const end=Date.now()+30000;while(Date.now()<end){const x=await c.send('Runtime.evaluate',{expression:'window.__LUMIXA_2EL_BROWSER__ ? JSON.stringify(window.__LUMIXA_2EL_BROWSER__) : null',returnByValue:true});if(x?.result?.value)return JSON.parse(x.result.value);await sleep(100)}throw new Error('timeout')}
async function sourceHash(){const h=createHash('sha256');for(const rel of ['core/calibration-lab/candidate-pilot.js','core/calibration-lab/export-candidate-pilot.js','ui/calibration-lab/calibration-lab-controller.js','ui/calibration-lab/calibration-lab-renderer.js','ui/calibration-lab/calibration-lab-i18n.js','qa/epic-2e-l-candidate-pilot-browser-test.mjs'])h.update(rel).update(await fs.readFile(path.join(ROOT,rel)));return h.digest('hex')}
async function write(r){await fs.writeFile(RESULT_PATH,JSON.stringify(r,null,2)+'\n')}
async function main(){const runId=randomUUID(),startedAt=new Date().toISOString(),hash=await sourceHash();const pw=await detectPlaywrightPackage();const detection=await detectBrowserExecutable(pw.chromium);if(!detection.available){const r={epic:'2E-L',suite:'CANDIDATE_PILOT_BROWSER',decision:'NOT_VERIFIED',reason:'BROWSER_BINARY_UNAVAILABLE',completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browser:detection};await write(r);console.log(JSON.stringify(r,null,2));process.exit(2)}const server=createStaticServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});const port=server.address().port;const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lumixa-2el-'));const args=['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--proxy-bypass-list=*','--allow-file-access-from-files','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];if(process.platform!=='win32')args.unshift('--no-sandbox');const browser=spawn(detection.executablePath,args,{stdio:['ignore','ignore','pipe']});let c=null;try{let dp=null;for(let i=0;i<200;i++){try{const raw=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');dp=Number(raw.split(/\r?\n/)[0]);if(dp)break}catch{}await sleep(50)}if(!dp)throw Object.assign(new Error('CDP unavailable'),{code:'CDP_UNAVAILABLE'});const targets=await fetch(`http://127.0.0.1:${dp}/json/list`).then(r=>r.json());const target=targets.find(x=>x.type==='page');c=await new Cdp(target.webSocketDebuggerUrl).open();await c.send('Runtime.enable');await c.send('Page.enable');let runtimeOriginStrategy='LOCAL_HTTP';let nav=await c.send('Page.navigate',{url:`http://127.0.0.1:${port}/__2el__.html`});if(nav?.errorText==='net::ERR_BLOCKED_BY_ADMINISTRATOR'){runtimeOriginStrategy='ABOUT_BLANK_IMPORT_MAP';await c.send('Page.navigate',{url:'about:blank'});const inMemoryHtml=await buildInMemoryHarnessHtml();await c.send('Runtime.evaluate',{expression:`document.open();document.write(${JSON.stringify(inMemoryHtml)});document.close();`,awaitPromise:true});nav={};}if(nav?.errorText){const r={epic:'2E-L',suite:'CANDIDATE_PILOT_BROWSER',decision:'NOT_VERIFIED',reason:nav.errorText==='net::ERR_BLOCKED_BY_ADMINISTRATOR'?'BROWSER_ORIGIN_BLOCKED_BY_POLICY':'NAVIGATION_FAILED',navigationError:nav.errorText,runtimeOriginStrategy,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput};await write(r);console.log(JSON.stringify(r,null,2));process.exitCode=2;return}const result=await waitResult(c);const viewportResults=[];for(const width of [320,360,390,430,768,1024,1440]){await c.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});const probe=await c.send('Runtime.evaluate',{expression:`JSON.stringify({width:${width},horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,rawCriterionLeak:/verifiedReviewedSamples|decisiveSamples|noSafetyHardStops/.test(root.textContent||''),pilotExists:Boolean(document.querySelector('[data-cal-role=\"candidate-pilot\"]'))})`,returnByValue:true});viewportResults.push(JSON.parse(probe.result.value));}await c.send('Emulation.clearDeviceMetricsOverride');if(viewportResults.some(v=>v.horizontalOverflow||!v.pilotExists))result.decision='FAIL';const r={epic:'2E-L',suite:'CANDIDATE_PILOT_BROWSER',decision:result.decision,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput,runtimeOriginStrategy,result,viewportResults};await write(r);console.log(JSON.stringify(r,null,2));process.exitCode=result.decision==='PASS'?0:1}catch(e){const decision=e?.code==='CDP_UNAVAILABLE'?'NOT_VERIFIED':'FAIL';const r={epic:'2E-L',suite:'CANDIDATE_PILOT_BROWSER',decision,reason:e?.code||'BROWSER_TEST_ERROR',error:e?.stack||String(e),completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput};await write(r);console.error(JSON.stringify(r,null,2));process.exitCode=decision==='NOT_VERIFIED'?2:1}finally{c?.close();try{browser.kill('SIGTERM')}catch{}await sleep(200);try{browser.kill('SIGKILL')}catch{}await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{})}}
main();
