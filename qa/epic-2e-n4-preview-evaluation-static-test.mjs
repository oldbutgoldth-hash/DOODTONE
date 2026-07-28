#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyColorMatchCandidateToImageData } from '../core/color-match/candidate-preview-renderer.js';
import { buildColorMatchSignature } from '../core/color-match/reference-target-signature-engine.js';
import { evaluateMatchedSignature } from '../core/color-match/match-evaluation-engine.js';
globalThis.ImageData ??= class ImageData { constructor(data,width,height){this.data=data;this.width=width;this.height=height;} };
let pass=0;const test=(n,f)=>{try{f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){console.error(`✗ [FAIL] ${n}\n${e.stack}`);process.exitCode=1}};
const neutralPreset={exp:0,con:0,hi:0,sh:0,wh:0,bl:0,temp:0,tint:0,vib:0,sat:0,hsl:{},grade:{}};
const activePreset={...neutralPreset,exp:30,con:10,temp:15,tint:4,vib:12,hsl:{hsl_h_orange:2,hsl_s_orange:5,hsl_l_orange:1},grade:{grd_sh_h:215,grd_sh_s:4,grd_mid_h:35,grd_mid_s:3,grd_hi_h:42,grd_hi_s:5}};
const image=()=>new ImageData(new Uint8ClampedArray([100,90,80,255,180,170,150,255,40,50,70,255,230,220,210,255]),2,2);
test('Identity preset leaves all pixels unchanged',()=>{const r=applyColorMatchCandidateToImageData(image(),neutralPreset);assert.equal(r.metrics.identity,true);assert.equal(r.metrics.changedPixels,0);});
test('Active safe preset changes real pixels and reports metrics',()=>{const r=applyColorMatchCandidateToImageData(image(),activePreset);assert.equal(r.metrics.identity,false);assert.ok(r.metrics.changedPixels>0);assert.ok(r.metrics.meanAbsoluteChannelDifference>0);});

test('Kelvin-calibrated preview moves positive Temperature warmer and negative Temperature cooler',()=>{const neutral=()=>new ImageData(new Uint8ClampedArray([120,120,120,255]),1,1);const warm=applyColorMatchCandidateToImageData(neutral(),{...neutralPreset,temp:7}).imageData.data;const cool=applyColorMatchCandidateToImageData(neutral(),{...neutralPreset,temp:-7}).imageData.data;assert.ok(warm[0]>warm[2],`warm R=${warm[0]} B=${warm[2]}`);assert.ok(cool[2]>cool[0],`cool R=${cool[0]} B=${cool[2]}`);});
const palette=(h=30,s=40)=>({confidence:.9,colors:[{weight:.5,hsl:{h,s,l:60}},{weight:.3,hsl:{h:210,s:30,l:40}},{weight:.2,hsl:{h:0,s:5,l:80}}]});
const tone=(warm=10,off=0)=>({shadow:{avgColor:{r:40+off,g:38+off,b:35+off},temperatureHint:warm,tintHint:0,pixelShare:.3},midtone:{avgColor:{r:130+off,g:125+off,b:118+off},temperatureHint:warm,tintHint:0,pixelShare:.5},highlight:{avgColor:{r:225+off,g:218+off,b:205+off},temperatureHint:warm,tintHint:0,pixelShare:.2},contrast:50,blackPoint:10,whitePoint:244});
const sig=(role,p,t)=>buildColorMatchSignature({role,palette:p,toneZones:t,hslAnalysis:{confidence:.8,channels:{}}});
test('Evaluation scores a matched signature closer than target as improved',()=>{const ref=sig('REFERENCE',palette(30,40),tone(20,10));const target=sig('TARGET',palette(210,25),tone(-15,-15));const matched=sig('TARGET',palette(32,39),tone(18,8));const e=evaluateMatchedSignature({referenceSignature:ref,targetSignature:target,matchedSignature:matched,previewMetrics:{clippedHighlightPct:0,clippedShadowPct:0},candidate:{fidelityContract:{previewUsesSafePreset:true,xmpUsesSafePreset:true,presetAndXmpSingleSourceOfTruth:true},candidateXmpLength:100}});assert.ok(e.after.matchNeedScore<e.before.matchNeedScore);assert.ok(e.improvement.fidelityScore>45);assert.notEqual(e.status,'MATCH_CANDIDATE_REGRESSION');});
test('Evaluation flags a worse matched signature as regression',()=>{const ref=sig('REFERENCE',palette(30),tone(15));const target=sig('TARGET',palette(35),tone(10));const matched=sig('TARGET',palette(220),tone(-35,-30));const e=evaluateMatchedSignature({referenceSignature:ref,targetSignature:target,matchedSignature:matched});assert.equal(e.status,'MATCH_CANDIDATE_REGRESSION');});
console.log(`\n${pass}/5 PASS, ${process.exitCode?1:0} FAIL`);if(process.exitCode)process.exit(process.exitCode);
