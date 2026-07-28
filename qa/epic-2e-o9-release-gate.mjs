#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const startedAt=new Date().toISOString();
const runId=randomUUID();
const steps=[];
function run(label,rel,timeout=300000){const r=spawnSync(process.execPath,[path.join(ROOT,rel)],{cwd:ROOT,encoding:'utf8',timeout});const code=Number.isInteger(r.status)?r.status:1;const status=code===0?'PASS':code===2?'NOT_VERIFIED':'FAIL';steps.push({label,rel,exitCode:code,status,stdoutTail:(r.stdout||'').slice(-6000),stderrTail:(r.stderr||'').slice(-3000)});console.log(`${label}: ${status}`);return status;}
run('ESM Syntax','tools/esm-syntax-gate.mjs');
run('Full Static Suites','qa/run-static-suites.mjs');
run('O9 Unified Core Fusion','qa/epic-2e-o9-unified-core-fusion-static-test.mjs');
run('O8/O9 Chromium Runtime','qa/epic-2e-o8-best-of-both-browser-test.mjs',420000);
const locks={productionSource:'legacy',productionWrite:false,controlledV2Apply:false,xmpWriteAllowed:false,productionActivationAllowed:false};
const productionFiles=['core/lightroom-mapping-engine/index.js','core/preset-engine/index.js','core/xmp-validator/index.js'];
const productionHashes={};for(const rel of productionFiles)productionHashes[rel]=createHash('sha256').update(await fs.readFile(path.join(ROOT,rel))).digest('hex');
const decision=steps.some(x=>x.status==='FAIL')?'FAIL':steps.some(x=>x.status==='NOT_VERIFIED')?'NOT_VERIFIED':'FINAL_PASS';
const out={epic:'2E-O9',suite:'UNIFIED_CORE_FUSION_RELEASE_GATE',decision,completed:true,runId,startedAt,completedAt:new Date().toISOString(),steps,productionLocks:locks,productionHashes,boundary:{unifiedCoreFusion:true,contributionLedger:true,moduleUtilizationGate:true,referenceTargetFullCoreAnalysis:true,productionActivated:false,realLightroomPhotographicVerificationRequired:true}};
await fs.writeFile(path.join(ROOT,'qa/epic-2e-o9-release-gate-results.json'),JSON.stringify(out,null,2)+'\n');
console.log(`EPIC 2E-O9 RELEASE DECISION: ${decision}`);process.exit(decision==='FINAL_PASS'?0:decision==='NOT_VERIFIED'?2:1);
