#!/usr/bin/env node
/** EPIC 2E-N1 — native Browser ESM/runtime proof for signature/delta engine. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectBrowserExecutable, detectPlaywrightPackage } from './helpers/playwright-lumixa-test-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-n1-core-color-match-browser-results.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function buildImportMap() {
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
  await visit('core/color-match/core-color-match-analysis.js');
  const imports = {};
  for (const [rel, source] of modules) imports[`lumixa:/${rel}`] = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return imports;
}

function harness(imports) {
  const tone = (warmth, offset, contrast) => ({
    shadow:{avgColor:{r:40+offset,g:38+offset,b:35+offset},temperatureHint:warmth-4,tintHint:0,pixelShare:.3},
    midtone:{avgColor:{r:130+offset,g:125+offset,b:116+offset},temperatureHint:warmth,tintHint:1,pixelShare:.5},
    highlight:{avgColor:{r:224+offset,g:218+offset,b:205+offset},temperatureHint:warmth+5,tintHint:0,pixelShare:.2},
    contrast,blackPoint:10,whitePoint:244,
  });
  const palette = hue => ({confidence:.9,colors:[
    {weight:.45,hsl:{h:hue,s:50,l:62}}, {weight:.3,hsl:{h:210,s:30,l:43}},
    {weight:.2,hsl:{h:0,s:5,l:82}}, {weight:.05,hsl:{h:110,s:35,l:35}},
  ]});
  return `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({imports})}<\/script><script type="module">
import { buildCoreColorMatchAnalysis } from 'lumixa:/core/color-match/core-color-match-analysis.js';
const tone=${tone.toString()}; const palette=${palette.toString()};
const result=buildCoreColorMatchAnalysis({reference:{palette:palette(30),toneZones:tone(25,8,62)},target:{palette:palette(22),toneZones:tone(-12,-6,42)},analysisGenerationId:'browser-n1'});
window.__LUMIXA_2EN1__={completed:true,decision:result.delta.whiteBalance.warmth>25&&result.delta.matchNeedScore>5&&result.production.productionSource==='legacy'&&result.production.productionWrite===false&&result.production.xmpWriteAllowed===false&&!JSON.stringify(result).includes('<x:xmpmeta')?'PASS':'FAIL',matchState:result.delta.matchState,matchNeedScore:result.delta.matchNeedScore,warmthDelta:result.delta.whiteBalance.warmth,production:result.production};
<\/script>`;
}

class Cdp {
  constructor(url){this.ws=new WebSocket(url);this.seq=0;this.pending=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}}
  async open(){await new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j});return this;}
  send(method,params={}){return new Promise((r,j)=>{const id=++this.seq;this.pending.set(id,{resolve:r,reject:j});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){try{this.ws.close()}catch{}}
}
async function sourceHash(){const h=createHash('sha256');for(const rel of ['core/color-match/signature-schema.js','core/color-match/reference-target-signature-engine.js','core/color-match/signature-delta-engine.js','core/color-match/core-color-match-analysis.js'])h.update(rel).update(await fs.readFile(path.join(ROOT,rel)));return h.digest('hex');}
async function write(result){await fs.writeFile(RESULT_PATH,JSON.stringify(result,null,2)+'\n');}

const runId=randomUUID(), startedAt=new Date().toISOString(), hash=await sourceHash();
const pw=await detectPlaywrightPackage(); const detection=await detectBrowserExecutable(pw.chromium);
if(!detection.available){const out={epic:'2E-N1',suite:'CORE_COLOR_MATCH_BROWSER',decision:'NOT_VERIFIED',reason:'BROWSER_BINARY_UNAVAILABLE',completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browser:detection};await write(out);console.log(JSON.stringify(out,null,2));process.exit(2);}
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'lumixa-2en1-'));
const args=['--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-proxy-server','--proxy-bypass-list=*','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];if(process.platform!=='win32')args.unshift('--no-sandbox');
const browser=spawn(detection.executablePath,args,{stdio:['ignore','ignore','pipe']}); let c=null;
try{
  let port=null; for(let i=0;i<200;i++){try{const raw=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');port=Number(raw.split(/\r?\n/)[0]);if(port)break;}catch{} await sleep(50);}
  if(!port) throw new Error('CDP_UNAVAILABLE');
  const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json()); const target=targets.find(x=>x.type==='page');
  c=await new Cdp(target.webSocketDebuggerUrl).open(); await c.send('Runtime.enable');
  const html=harness(await buildImportMap()); await c.send('Runtime.evaluate',{expression:`document.open();document.write(${JSON.stringify(html)});document.close();`,awaitPromise:true});
  let result=null; const end=Date.now()+30000; while(Date.now()<end){const probe=await c.send('Runtime.evaluate',{expression:'window.__LUMIXA_2EN1__ ? JSON.stringify(window.__LUMIXA_2EN1__) : null',returnByValue:true});if(probe?.result?.value){result=JSON.parse(probe.result.value);break;}await sleep(100);} if(!result) throw new Error('RUNTIME_TIMEOUT');
  const out={epic:'2E-N1',suite:'CORE_COLOR_MATCH_BROWSER',decision:result.decision,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput,result};await write(out);console.log(JSON.stringify(out,null,2));process.exitCode=result.decision==='PASS'?0:1;
}catch(error){const out={epic:'2E-N1',suite:'CORE_COLOR_MATCH_BROWSER',decision:'FAIL',reason:error.message,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:hash,browserExecutable:detection.executablePath,browserVersion:detection.versionOutput};await write(out);console.error(JSON.stringify(out,null,2));process.exitCode=1;}
finally{c?.close();try{browser.kill('SIGTERM')}catch{}await sleep(200);try{browser.kill('SIGKILL')}catch{}await fs.rm(profile,{recursive:true,force:true}).catch(()=>{});}
