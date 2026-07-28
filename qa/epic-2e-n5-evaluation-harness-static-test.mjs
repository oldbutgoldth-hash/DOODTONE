#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createColorMatchEvaluationRecord } from '../core/color-match/match-evaluation-engine.js';
import { createColorMatchEvaluationStore } from '../core/color-match/evaluation-store.js';
let pass=0;const test=async(n,f)=>{try{await f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){console.error(`✗ [FAIL] ${n}\n${e.stack}`);process.exitCode=1}};
const record=()=>createColorMatchEvaluationRecord({analysis:{referenceSignature:{analysisGenerationId:'n5'},targetSignature:{},delta:{}},compensation:{kind:'c'},candidate:{kind:'x',schemaVersion:1,candidateState:'MAPPED_CANDIDATE',safePreset:{temp:5},safetyAdjustments:[],reasonTrace:[],candidateXmpLength:123},evaluation:{status:'MATCH_CANDIDATE_IMPROVED'},reviewerDecision:'MATCH_ACCEPTED',issueCodes:['WB_MISMATCH','WB_MISMATCH'],notes:'checked'});
await test('Evaluation record stores stable review data and deduplicates issues',async()=>{const r=record();assert.deepEqual(r.issueCodes,['WB_MISMATCH']);assert.equal(r.production.productionWrite,false);assert.equal(r.lightroomCandidate.candidateXmpLength,123);});
await test('Evaluation record excludes XMP body and image/private path data',async()=>{const t=JSON.stringify(record());for(const bad of ['<x:xmpmeta','data:image','blob:','C:\\','/Users/','/home/','fileName','pixelBuffer'])assert.equal(t.includes(bad),false,bad);});
await test('Memory fallback saves, lists and clears records',async()=>{const store=await createColorMatchEvaluationStore({indexedDBFactory:null});assert.equal(store.mode,'IN_MEMORY_FALLBACK');await store.save(record());assert.equal((await store.list()).length,1);await store.clear();assert.equal((await store.list()).length,0);});
await test('Unsupported reviewer decision fails closed',async()=>{assert.throws(()=>createColorMatchEvaluationRecord({reviewerDecision:'PRODUCTION_READY'}));});
console.log(`\n${pass}/4 PASS, ${process.exitCode?1:0} FAIL`);if(process.exitCode)process.exit(process.exitCode);
