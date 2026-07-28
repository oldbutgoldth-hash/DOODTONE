#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deltaE2000, gaussianHueWeight, circularHueDelta, rgbToLab } from '../core/color-match/perceptual-color-science.js';
import { deriveGaussianHslTransfer } from '../core/color-match/gaussian-hsl-transfer-engine.js';
import { buildCoreColorMatchPipeline } from '../core/color-match/core-color-match-pipeline.js';
import { applyColorMatchCandidateToImageData } from '../core/color-match/candidate-preview-renderer.js';

let pass=0,fail=0;const test=(n,f)=>{try{f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){fail++;console.error(`✗ [FAIL] ${n}\n${e.stack}`)}};
const approx=(a,b,t=.01)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);

test('CIEDE2000 matches published Sharma reference pair',()=>{approx(deltaE2000({L:50,a:2.6772,b:-79.7751},{L:50,a:0,b:-82.7485}),2.0425,.0002)});
test('sRGB Lab conversion maps white close to D65 L*=100',()=>{const lab=rgbToLab({r:255,g:255,b:255});approx(lab.L,100,.01);approx(lab.a,0,.03);approx(lab.b,0,.03)});
test('Gaussian hue kernel is continuous across 0/360',()=>{assert.ok(gaussianHueWeight(359,0,25)>.99);assert.equal(circularHueDelta(359,1),2)});

const palette=(h,s=55,l=50)=>({confidence:.95,colors:[{weight:.75,rgb:{r:190,g:90,b:55},hsl:{h,s,l}},{weight:.25,rgb:{r:128,g:128,b:128},hsl:{h:0,s:0,l:50}}]});
test('Production Gaussian HSL engine handles red wraparound without 358-degree jump',()=>{const r=deriveGaussianHslTransfer({referencePalette:palette(1),targetPalette:palette(359),intensity:100,sigma:25});assert.ok(Math.abs(r.channels.red.hue)<3,r.channels.red);assert.ok(r.channels.red.confidence>.2)});

const tone=(warm=0)=>({shadow:{avgColor:{r:40,g:40,b:40},temperatureHint:warm,tintHint:0,pixelShare:.3},midtone:{avgColor:{r:128,g:128,b:128},temperatureHint:warm,tintHint:0,pixelShare:.5},highlight:{avgColor:{r:230,g:230,b:230},temperatureHint:warm,tintHint:0,pixelShare:.2},contrast:50,blackPoint:5,whitePoint:245});
const reference={palette:palette(20,65,45),toneZones:tone(20),skinAnalysis:{detected:true,confidence:.9,coveragePct:20,avgHue:30,avgSat:45,avgLum:60},histogram:{clipHiPct:.1,clipLoPct:.1,drStops:9}};
const target={palette:palette(350,35,55),toneZones:tone(-8),skinAnalysis:{detected:true,confidence:.85,coveragePct:15,avgHue:32,avgSat:32,avgLum:58},histogram:{clipHiPct:.2,clipLoPct:.1,drStops:8.5}};
const pixelTransfer={kind:'LUMIXA_PERCEPTUAL_PIXEL_TRANSFER',state:'PIXEL_TRANSFER_READY',curveMagnitude:42,curves:{master:[{x:0,y:2},{x:64,y:58},{x:128,y:138},{x:192,y:202},{x:255,y:252}],red:[{x:0,y:1},{x:128,y:134},{x:255,y:255}],green:[{x:0,y:0},{x:128,y:128},{x:255,y:254}],blue:[{x:0,y:0},{x:128,y:122},{x:255,y:248}]}};
const pipeline=buildCoreColorMatchPipeline({reference,target,pixelTransfer,intensity:70,analysisGenerationId:'o8',targetMediaContext:{fileName:'target.CR3',mediaType:'RAW',baseTemperatureK:5000,baseTint:2}});
test('O8 candidate uses perceptual pixel curves as XMP source of truth',()=>{assert.equal(pipeline.candidate.rawPreset.transferDiagnostics.curveSource,'PERCEPTUAL_CDF_TONE_MERGE');assert.ok(pipeline.candidate.safePreset.curves.master.length>=5);assert.deepEqual(pipeline.candidate.xmpReadback.parsed.curves.master,pipeline.candidate.safePreset.curves.master)});
test('O8 candidate carries Gaussian HSL evidence from production engine',()=>{assert.ok(pipeline.transferEvidence.gaussianHsl.supportedChannelCount>=1);assert.ok(pipeline.candidate.transferEvidence.gaussianHsl);assert.equal(pipeline.candidate.xmpReadback.decision,'PASS')});

test('Candidate preview applies the exact point curves instead of ignoring them',()=>{
  globalThis.ImageData=class ImageData{constructor(data,width,height){this.data=data;this.width=width;this.height=height}};
  const source={data:new Uint8ClampedArray([64,64,64,255]),width:1,height:1};
  const preset={exp:0,con:0,hi:0,sh:0,wh:0,bl:0,temp:0,tint:0,vib:0,sat:0,hsl:{},grade:{},curves:{master:[{x:0,y:0},{x:64,y:100},{x:255,y:255}],red:[{x:0,y:0},{x:255,y:255}],green:[{x:0,y:0},{x:255,y:255}],blue:[{x:0,y:0},{x:255,y:255}]}};
  const out=applyColorMatchCandidateToImageData(source,preset);assert.ok(out.imageData.data[0]>70,out.imageData.data);assert.equal(out.metrics.pointCurvesApplied,true);
});
test('O8 remains candidate-only and cannot change Production/XMP source',()=>{assert.equal(pipeline.production.productionSource,'legacy');assert.equal(pipeline.production.productionWrite,false);assert.equal(pipeline.candidate.production.xmpWriteAllowed,false)});

console.log(`\n${pass}/${pass+fail} PASS, ${fail} FAIL`);if(fail)process.exit(1);
