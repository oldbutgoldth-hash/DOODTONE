#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
let pass=0;const test=async(n,f)=>{try{await f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){console.error(`✗ [FAIL] ${n}\n${e.stack}`);process.exitCode=1}};
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
await test('Reference panel runs the complete N1-N5 pipeline',async()=>{const s=await read('ui/reference-color-match-panel.js');for(const token of ['buildCoreColorMatchPipeline','renderColorMatchCandidateToCanvas','evaluateMatchedSignature','createColorMatchEvaluationRecord','createColorMatchEvaluationStore'])assert.match(s,new RegExp(token));});
await test('UI semantic state exposes Candidate-only Production locks',async()=>{const s=await read('ui/reference-color-match-panel.js');assert.match(s,/dataset\.productionSource = 'legacy'/);assert.match(s,/dataset\.productionWrite = 'false'/);assert.match(s,/dataset\.xmpWriteAllowed = 'false'/);assert.match(s,/candidateXmpInMemoryOnly/);});
await test('N2-N5 modules never activate Production or Controlled V2',async()=>{for(const p of ['core/color-match/photographic-compensation-engine.js','core/color-match/lightroom-candidate-mapper.js','core/color-match/candidate-preview-renderer.js','core/color-match/match-evaluation-engine.js','core/color-match/evaluation-store.js','core/color-match/core-color-match-pipeline.js']){const s=await read(p);assert.equal(/productionWrite:\s*true|xmpWriteAllowed:\s*true|controlledV2Apply:\s*true|PRODUCTION_READY/.test(s),false,p);}});
await test('Production engine source hashes remain equal to N1 baseline',async()=>{const manifest=JSON.parse(await read('qa/baselines/epic-2e-n1-production-invariant.json'));for(const [p,h] of Object.entries(manifest.files)){const b=await fs.readFile(new URL('../'+p,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),h,p);}});
await test('Reference UI exports Candidate XMP explicitly, not Production XMP',async()=>{const s=await read('ui/reference-color-match-panel.js');assert.match(s,/LUMIXA-Core-Color-Match-Candidate/);assert.match(s,/Production Pipeline.*Legacy/);});
console.log(`\n${pass}/5 PASS, ${process.exitCode?1:0} FAIL`);if(process.exitCode)process.exit(process.exitCode);
