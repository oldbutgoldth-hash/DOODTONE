#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCoreColorMatchAnalysis } from '../core/color-match/core-color-match-analysis.js';
import { buildPhotographicCompensation } from '../core/color-match/photographic-compensation-engine.js';
import { mapCompensationToLightroomCandidate } from '../core/color-match/lightroom-candidate-mapper.js';
let pass=0;const test=(n,f)=>{try{f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){console.error(`✗ [FAIL] ${n}\n${e.stack}`);process.exitCode=1}};
const palette=(h=25)=>({confidence:.9,colors:[{weight:.4,hsl:{h,s:50,l:60}},{weight:.3,hsl:{h:210,s:30,l:40}},{weight:.3,hsl:{h:0,s:5,l:80}}]});
const tone=(warm=10,off=0)=>({shadow:{avgColor:{r:40+off,g:38+off,b:34+off},temperatureHint:warm-2,tintHint:1,pixelShare:.3},midtone:{avgColor:{r:130+off,g:125+off,b:115+off},temperatureHint:warm,tintHint:1,pixelShare:.5},highlight:{avgColor:{r:225+off,g:218+off,b:205+off},temperatureHint:warm+2,tintHint:1,pixelShare:.2},contrast:52,blackPoint:10,whitePoint:244});
function candidate(){const a=buildCoreColorMatchAnalysis({reference:{palette:palette(30),toneZones:tone(25,10),skinAnalysis:{detected:true,coveragePct:20,confidence:.8},histogram:{clipHiPct:.2,clipLoPct:.1,drStops:10}},target:{palette:palette(210),toneZones:tone(-15,-12),skinAnalysis:{detected:true,coveragePct:22,confidence:.8},histogram:{clipHiPct:.1,clipLoPct:.1,drStops:9}},analysisGenerationId:'n3'});return mapCompensationToLightroomCandidate({compensation:buildPhotographicCompensation({analysis:a,intensity:72})});}

test('N3 maps semantic intent to complete bounded Lightroom preset',()=>{const c=candidate();for(const key of ['exp','con','hi','sh','wh','bl','temp','tint','vib','sat','hsl','grade','cal'])assert.ok(key in c.safePreset,key);assert.ok(Math.abs(c.safePreset.temp)<=68);assert.ok(Math.abs(c.safePreset.tint)<=40);});
test('Candidate XMP is serialized from the exact safe preset source',()=>{const c=candidate();assert.match(c.candidateXmp,/crs:Exposure2012=/);assert.match(c.candidateXmp,new RegExp(`crs:Contrast2012="${c.safePreset.con}"`));assert.equal(c.fidelityContract.presetAndXmpSingleSourceOfTruth,true);});
test('N3 remains candidate-only and cannot write Production',()=>{const c=candidate();assert.equal(c.production.productionSource,'legacy');assert.equal(c.production.productionWrite,false);assert.equal(c.production.xmpWriteAllowed,false);assert.equal(c.production.candidateXmpInMemoryOnly,true);});
test('Reason trace covers WB, tone and HSL groups',()=>{const c=candidate();const names=c.reasonTrace.map(x=>x.parameter);assert.ok(names.includes('Temperature'));assert.ok(names.includes('Exposure'));assert.ok(names.includes('HSL.orange'));});
test('Candidate contains no image, Base64 or local path data',()=>{const t=JSON.stringify(candidate());for(const bad of ['data:image','blob:','C:\\','/Users/','/home/','pixelBuffer'])assert.equal(t.includes(bad),false,bad);});
console.log(`\n${pass}/5 PASS, ${process.exitCode?1:0} FAIL`);if(process.exitCode)process.exit(process.exitCode);
