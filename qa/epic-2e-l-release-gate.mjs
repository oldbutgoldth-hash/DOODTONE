#!/usr/bin/env node
/** EPIC 2E-L fail-closed release gate. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const RESULT_PATH=path.join(__dirname,'epic-2e-l-release-gate-results.json');
const startedAt=new Date().toISOString(),runId=randomUUID();
function run(label,rel){const r=spawnSync(process.execPath,[path.join(ROOT,rel)],{cwd:ROOT,encoding:'utf8'});const exitCode=r.status??1;const status=exitCode===0?'PASS':exitCode===2?'NOT_VERIFIED':'FAIL';console.log(`\n=== ${label}: ${status} (exit ${exitCode}) ===`);if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);return{label,rel,exitCode,status,stdoutTail:(r.stdout||'').slice(-6000),stderrTail:(r.stderr||'').slice(-3000)}}
async function hashFile(rel){return createHash('sha256').update(await fs.readFile(path.join(ROOT,rel))).digest('hex')}
async function verifyProduction(){const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'qa/baselines/epic-2e-l-production-invariant.json'),'utf8'));const mismatches=[];for(const [rel,expected] of Object.entries(manifest.files)){const actual=await hashFile(rel);if(actual!==expected)mismatches.push({rel,expected,actual})}return{status:mismatches.length?'FAIL':'PASS',mismatches,productionLocks:manifest.productionLocks}}
async function sourceHash(){const h=createHash('sha256');for(const rel of ['core/calibration-lab/candidate-pilot.js','core/calibration-lab/export-candidate-pilot.js','ui/calibration-lab/calibration-lab-controller.js','ui/calibration-lab/calibration-lab-renderer.js','ui/calibration-lab/calibration-lab-i18n.js','qa/epic-2e-l-candidate-pilot-static-test.mjs','qa/epic-2e-l-candidate-pilot-integration-static-test.mjs','qa/epic-2e-l-candidate-pilot-browser-test.mjs'])h.update(rel).update(await fs.readFile(path.join(ROOT,rel)));return h.digest('hex')}
const steps=[run('ESM Syntax','tools/esm-syntax-gate.mjs'),run('Full Static Suites','qa/run-static-suites.mjs'),run('Candidate Pilot Browser','qa/epic-2e-l-candidate-pilot-browser-test.mjs')];
const productionInvariant=await verifyProduction();
steps.push({label:'Production/XMP Source Invariant',rel:'qa/baselines/epic-2e-l-production-invariant.json',exitCode:productionInvariant.status==='PASS'?0:1,status:productionInvariant.status,stdoutTail:JSON.stringify(productionInvariant),stderrTail:''});
let decision='FINAL_PASS';if(steps.some(s=>s.status==='FAIL'))decision='FAIL';else if(steps.some(s=>s.status==='NOT_VERIFIED'))decision='NOT_VERIFIED';
const result={epic:'2E-L',suite:'CANDIDATE_PILOT_RELEASE_GATE',decision,completed:true,runId,startedAt,completedAt:new Date().toISOString(),sourceHash:await sourceHash(),steps,productionInvariant,boundary:'Candidate Pilot only. Controlled V2 remains non-Production; Production Mapping and XMP remain Legacy.'};
await fs.writeFile(RESULT_PATH,JSON.stringify(result,null,2)+'\n');
console.log(`\nEPIC 2E-L RELEASE DECISION: ${decision}`);console.log(`Evidence: qa/epic-2e-l-release-gate-results.json`);process.exit(decision==='FINAL_PASS'?0:decision==='NOT_VERIFIED'?2:1);
