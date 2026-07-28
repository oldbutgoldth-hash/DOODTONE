#!/usr/bin/env node
/** EPIC 2E-M -- native Browser guided Cohort intake UX verification. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectBrowserExecutable, detectPlaywrightPackage } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'epic-2e-m-guided-cohort-intake-browser-results.json');
const MIME = new Map([['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8']]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function harnessHtml(moduleBase = '') {
  const base = moduleBase.replace(/\/$/, '');
  return `<!doctype html><html lang="th"><meta charset="utf-8"><title>LUMIXA 2E-M Browser QA</title><body><div id="root"></div>
<script type="module">
import { mountCalibrationLabUI } from '${base}/ui/calibration-lab/calibration-lab-renderer.js';
import { buildCohortSaveReceipt, findNextPendingIndex } from '${base}/core/calibration-lab/cohort-save-feedback.js';
import { computeCandidatePilotReport } from '${base}/core/calibration-lab/candidate-pilot.js';
const A='a'.repeat(64),B='b'.repeat(64);
const evidence={previewTruthCode:'BOTH_RENDERED_DIFFERENT',browserVerified:true,visualDecisionEligible:true,sameSourceGeometry:true,sourceFingerprintMatch:true,legacyPixelHash:A,controlledV2PixelHash:B,legacyNonTransparentPixelCount:480000,controlledV2NonTransparentPixelCount:480000};
let record={imageId:'guided-1',imageFingerprint:'fp-guided-1',analysisGenerationId:'gen-guided-1',imageCategories:['PORTRAIT'],lightingCondition:'DAYLIGHT',containsSkin:true,userDecision:'NOT_REVIEWED',issueCodes:[],notes:'',reviewedAt:null,legacyDecisionPreservedForAudit:false,requiresVisualReReview:false,legacySnapshot:{temperature:5200,tint:2,confidence:.72,safetyScore:.9},controlledV2Snapshot:{temperature:5100,tint:1,confidence:.81,safetyScore:.92},safetySnapshot:{severeIssueDetected:false,v2HardStopCount:0},previewEvidence:evidence};
let records=[record];let locale='th';let mode='REVIEW';let lastActionResult=null;let lastActionError=null;let currentIndex=0;
const session={sessionId:'guided-session',reviewedCount:0,pendingCount:1,imageCount:1};
function state(){return{calibrationMode:mode,sessionState:'ACTIVE',persistenceMode:'INDEXEDDB',session:{...session},records:[...records],currentIndex,currentRecord:records[currentIndex],lastActionError,lastActionResult,locale};}
const controller={
 getState:state,subscribe:()=>()=>{},setMode:m=>{mode=m;},getCandidatePilotReport:()=>computeCandidatePilotReport(records,undefined,{sourceSessionId:session.sessionId}),
 exportCandidatePilotJson:()=>({}),getDashboard:()=>({summary:{totalImages:1,reviewedCount:session.reviewedCount,v2WinRate:null,legacyWinRate:null,tieRate:null,bothUnacceptableRate:null},safetySignals:{safetyWarningCount:0,lowConfidenceCount:0,mixedLightFailureCount:0,skinToneIssueCount:0}}),
 getReadinessReport:()=>({readinessStatus:'INSUFFICIENT_DATA'}),exportJson:()=>({session}),endSession:async()=>{},startNewSession:async()=>{},listAvailableSessions:async()=>[],openSession:async()=>{},addImage:async()=>{},
 goToPrevious:()=>{},goToNext:()=>{},goToNextPending:()=>{const next=findNextPendingIndex(records,currentIndex);if(next>=0)currentIndex=next;},
 saveCurrentDecision:async({userDecision,issueCodes,notes})=>{lastActionError=null;if(userDecision==='NOT_REVIEWED'){lastActionError='DECISION_REQUIRED';return state();}record={...record,userDecision,issueCodes:[...issueCodes],notes,reviewedAt:'2026-07-28T02:00:00.000Z'};records=[record];session.reviewedCount=1;session.pendingCount=0;lastActionResult=buildCohortSaveReceipt(record,records,{savedAt:'2026-07-28T02:00:00.000Z'});return state();},
 clearCurrentAnswer:async()=>{record={...record,userDecision:'NOT_REVIEWED',issueCodes:[],notes:'',reviewedAt:null};records=[record];session.reviewedCount=0;session.pendingCount=1;lastActionResult={code:'CURRENT_ANSWER_CLEARED',imageId:record.imageId};return state();},
 getPixelPreviewInput:()=>({available:false}),
};
const root=document.getElementById('root');const ui=mountCalibrationLabUI(root,controller,{getLocale:()=>locale});ui.open();
const probe=()=>({
 saveBar:Boolean(root.querySelector('[data-cal-role="guided-save-bar"]')),
 saveDisabled:root.querySelector('[data-cal-role="save-decision-button"]')?.disabled===true,
 saveNextDisabled:root.querySelector('[data-cal-role="save-and-next-button"]')?.disabled===true,
 cohortStatus:root.querySelector('[data-cal-role="current-cohort-status"]')?.dataset.status||null,
 cohortResult:root.querySelector('[data-cal-role="cohort-save-result"]')?.dataset.result||null,
 currentInCohort:root.dataset.calCurrentInCohort,
 lastAction:root.dataset.calLastActionResult,
 productionActionCount:[...root.querySelectorAll('button')].filter(b=>/apply controlled|production|export xmp|download xmp/i.test(b.textContent||'')).length,
 horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
 text:root.textContent||'',
});
const before=probe();
root.querySelector('[data-cal-decision-code="V2_BETTER"]')?.click();
const selected=probe();
root.querySelector('[data-cal-role="save-decision-button"]')?.click();
await new Promise(r=>setTimeout(r,20));
const savedThai=probe();
locale='en';ui.render();const savedEnglish=probe();
const decision=before.saveBar&&before.saveDisabled&&before.saveNextDisabled&&before.cohortStatus==='pending'&&!selected.saveDisabled&&!selected.saveNextDisabled&&savedThai.cohortStatus==='saved'&&savedThai.cohortResult==='DECISION_SAVED_TO_COHORT'&&savedThai.currentInCohort==='true'&&savedThai.lastAction==='DECISION_SAVED_TO_COHORT'&&/บันทึกเข้า Cohort แล้ว/.test(savedThai.text)&&/Saved to Cohort/.test(savedEnglish.text)&&savedThai.productionActionCount===0&&savedEnglish.productionActionCount===0&&!savedThai.horizontalOverflow&&!savedEnglish.horizontalOverflow?'PASS':'FAIL';
window.__LUMIXA_2EM_BROWSER__={completed:true,decision,before,selected,savedThai,savedEnglish,productionLocks:{productionSource:'legacy',productionWrite:false,controlledV2Apply:false,previewExport:false}};
</script></body></html>`;
}

async function buildInMemoryHarnessHtml() {
  const modules = new Map();
  const importPattern = /((?:import|export)\s+(?:[^'";]*?\s+from\s+)?)(['"])([^'"]+)\2/g;
  async function visit(rel) {
    const normalized=rel.replace(/\\/g,'/');if(modules.has(normalized))return;
    let source=await fs.readFile(path.join(ROOT,normalized),'utf8');const deps=[];
    source=source.replace(importPattern,(full,prefix,quote,specifier)=>{if(!specifier.startsWith('.'))return full;const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(normalized),specifier));deps.push(resolved);return `${prefix}${quote}lumixa:/${resolved}${quote}`;});
    modules.set(normalized,source);for(const dep of deps)await visit(dep);
  }
  for(const rootModule of ['ui/calibration-lab/calibration-lab-renderer.js','core/calibration-lab/cohort-save-feedback.js','core/calibration-lab/candidate-pilot.js'])await visit(rootModule);
  const imports={};for(const[rel,source]of modules)imports[`lumixa:/${rel}`]=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const importMap=`<script type="importmap">${JSON.stringify({imports})}<\/script>`;
  return harnessHtml('lumixa:').replace('<script type="module">',`${importMap}<script type="module">`);
}
function createStaticServer(){return createServer(async(req,res)=>{try{const url=new URL(req.url||'/','http://127.0.0.1');if(url.pathname==='/__2em__.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(harnessHtml(''));return;}const rel=decodeURIComponent(url.pathname).replace(/^\/+/, '');const fp=path.resolve(ROOT,rel);if(!fp.startsWith(ROOT+path.sep)){res.writeHead(403);res.end('forbidden');return;}const data=await fs.readFile(fp);res.writeHead(200,{'Content-Type':MIME.get(path.extname(fp))||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('not found');}})}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.seq=0;this.pending=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}}async open(){await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j});return this}send(method,params={}){return new Promise((r,j)=>{const id=++this.seq;this.pending.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));})}close(){try{this.ws.close()}catch{}}}
async function waitResult(c){const end=Date.now()+30000;while(Date.now()<end){const x=await c.send('Runtime.evaluate',{expression:'window.__LUMIXA_2EM_BROWSER__ ? JSON.stringify(window.__LUMIXA_2EM_BROWSER__) : null',returnByValue:true});if(x?.result?.value)return JSON.parse(x.result.value);await sleep(100)}throw new Error('timeout')}
async function sourceHash(){const h=createHash('sha256');for(const rel of ['core/calibration-lab/cohort-save-feedback.js','ui/calibration-lab/calibration-lab-controller.js','ui/calibration-lab/calibration-lab-renderer.js','ui/calibration-lab/calibration-lab-i18n.js','qa/epic-2e-m-guided-cohort-intake-browser-test.mjs'])h.update(rel).update(await fs.readFile(path.join(ROOT,rel)));return h.digest('hex')}
async function write(r){await fs.writeFile(RESULT_PATH,JSON.stringify(r,null,2)+'\n')}
async function main(){const runId=randomUUID(),startedAt=new Date().toISOString(),hash=await sourceHash();const pw=await detectPlaywrightPackage();const detection=await detectBrowserExecutable(pw.chromium);if(!detection.available){const r={epic:'2E-M',suite:'GUIDED_COHORT_BROWSER',decision:'NOT_VERIFIED',reason:'BROWSER_BINARY_UNAVAILABLE',completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browser:detection};await write(r);console.log(JSON.stringify(r,null,2));process.exit(2)}const server=createStaticServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});const port=server.address().port;const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lumixa-2em-'));const args=['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--proxy-bypass-list=*','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];if(process.platform!=='win32')args.unshift('--no-sandbox');const browser=spawn(detection.executablePath,args,{stdio:['ignore','ignore','pipe']});let c=null;try{let dp=null;for(let i=0;i<200;i++){try{const raw=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');dp=Number(raw.split(/\r?\n/)[0]);if(dp)break}catch{}await sleep(50)}if(!dp)throw Object.assign(new Error('CDP unavailable'),{code:'CDP_UNAVAILABLE'});const targets=await fetch(`http://127.0.0.1:${dp}/json/list`).then(r=>r.json());const target=targets.find(x=>x.type==='page');c=await new Cdp(target.webSocketDebuggerUrl).open();await c.send('Runtime.enable');await c.send('Page.enable');let strategy='LOCAL_HTTP';let nav=await c.send('Page.navigate',{url:`http://127.0.0.1:${port}/__2em__.html`});if(nav?.errorText==='net::ERR_BLOCKED_BY_ADMINISTRATOR'){strategy='ABOUT_BLANK_IMPORT_MAP';await c.send('Page.navigate',{url:'about:blank'});const inMemory=await buildInMemoryHarnessHtml();await c.send('Runtime.evaluate',{expression:`document.open();document.write(${JSON.stringify(inMemory)});document.close();`,awaitPromise:true});nav={};}if(nav?.errorText)throw Object.assign(new Error(nav.errorText),{code:'NAVIGATION_FAILED'});const result=await waitResult(c);const viewportResults=[];for(const width of [320,360,390,430,768,1024,1440]){await c.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});const probe=await c.send('Runtime.evaluate',{expression:`JSON.stringify({width:${width},horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,saveBar:Boolean(document.querySelector('[data-cal-role="guided-save-bar"]')),productionActionCount:[...document.querySelectorAll('button')].filter(b=>/apply controlled|production|export xmp|download xmp/i.test(b.textContent||'')).length})`,returnByValue:true});viewportResults.push(JSON.parse(probe.result.value));}if(viewportResults.some(v=>v.horizontalOverflow||!v.saveBar||v.productionActionCount>0))result.decision='FAIL';const r={epic:'2E-M',suite:'GUIDED_COHORT_BROWSER',decision:result.decision,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput,runtimeOriginStrategy:strategy,result,viewportResults};await write(r);console.log(JSON.stringify(r,null,2));process.exitCode=result.decision==='PASS'?0:1}catch(e){const decision=e?.code==='CDP_UNAVAILABLE'?'NOT_VERIFIED':'FAIL';const r={epic:'2E-M',suite:'GUIDED_COHORT_BROWSER',decision,reason:e?.code||'BROWSER_TEST_ERROR',error:e?.stack||String(e),completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput};await write(r);console.error(JSON.stringify(r,null,2));process.exitCode=decision==='NOT_VERIFIED'?2:1}finally{c?.close();try{browser.kill('SIGTERM')}catch{}await sleep(200);try{browser.kill('SIGKILL')}catch{}await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{})}}
main();
