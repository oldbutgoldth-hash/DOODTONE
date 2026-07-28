#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCoreColorMatchAnalysis } from '../core/color-match/core-color-match-analysis.js';
import { buildPhotographicCompensation } from '../core/color-match/photographic-compensation-engine.js';
import { mapCompensationToLightroomCandidate } from '../core/color-match/lightroom-candidate-mapper.js';
import { buildColorMatchSignature } from '../core/color-match/reference-target-signature-engine.js';
import { evaluateLightroomRoundTrip } from '../core/color-match/lightroom-roundtrip-fidelity-engine.js';

let pass=0; const test=(name,fn)=>{try{fn();pass++;console.log(`✓ [PASS] ${name}`)}catch(error){console.error(`✗ [FAIL] ${name}\n${error.stack}`);process.exitCode=1}};
const palette=(colors,confidence=.92)=>({confidence,colors});
const refPalette=palette([
  {weight:.42,hsl:{h:110,s:44,l:28}}, {weight:.28,hsl:{h:28,s:46,l:66}},
  {weight:.18,hsl:{h:0,s:5,l:78}}, {weight:.12,hsl:{h:210,s:24,l:42}},
]);
const weddingPalette=palette([
  {weight:.48,hsl:{h:0,s:4,l:94}}, {weight:.18,hsl:{h:335,s:34,l:72}},
  {weight:.14,hsl:{h:215,s:36,l:68}}, {weight:.11,hsl:{h:30,s:42,l:62}},
  {weight:.09,hsl:{h:108,s:32,l:54}},
]);
const tone=(cfg={})=>({
 shadow:{avgColor:cfg.shadowRgb||{r:42,g:39,b:35},temperatureHint:cfg.shadowWarm??20,tintHint:cfg.shadowTint??0,pixelShare:cfg.shadowShare??.3},
 midtone:{avgColor:cfg.midRgb||{r:132,g:125,b:116},temperatureHint:cfg.midWarm??22,tintHint:cfg.midTint??0,pixelShare:cfg.midShare??.5},
 highlight:{avgColor:cfg.hiRgb||{r:226,g:218,b:205},temperatureHint:cfg.hiWarm??24,tintHint:cfg.hiTint??0,pixelShare:cfg.hiShare??.2},
 contrast:cfg.contrast??52,blackPoint:cfg.blackPoint??10,whitePoint:cfg.whitePoint??244,
});
const reference={
 palette:refPalette,
 toneZones:tone({shadowShare:.48,midShare:.43,hiShare:.09,shadowWarm:28,midWarm:30,hiWarm:26,contrast:58,whitePoint:238}),
 skinAnalysis:{detected:true,coveragePct:22,confidence:.9,avgHue:29,avgSat:38,avgLum:63},
 histogram:{clipHiPct:.1,clipLoPct:.1,drStops:10},
};
const target={
 palette:weddingPalette,
 toneZones:tone({shadowRgb:{r:178,g:172,b:169},midRgb:{r:225,g:221,b:219},hiRgb:{r:249,g:246,b:244},shadowShare:.08,midShare:.34,hiShare:.58,shadowWarm:7,midWarm:8,hiWarm:5,contrast:28,blackPoint:38,whitePoint:252}),
 skinAnalysis:{detected:true,coveragePct:14,confidence:.9,avgHue:31,avgSat:52,avgLum:69},
 histogram:{clipHiPct:1.2,clipLoPct:0,drStops:7.3},
};
function pipelineParts(){
 const analysis=buildCoreColorMatchAnalysis({reference,target,analysisGenerationId:'2e-o'});
 const compensation=buildPhotographicCompensation({analysis,intensity:72,protectionOptions:{preserveSkinTone:true,protectHighlights:true,protectShadows:true}});
 const candidate=mapCompensationToLightroomCandidate({compensation,targetMediaContext:{fileName:'981A8131.CR2',mediaType:'RAW'}});
 return {analysis,compensation,candidate};
}

test('High-key wedding target activates neutral-white protection',()=>{const {compensation}=pipelineParts();assert.ok(compensation.targetProtection.neutralWhite.active);assert.ok(compensation.targetProtection.neutralWhite.targetHighKeyScore>.55,compensation.targetProtection.neutralWhite);assert.ok(compensation.targetProtection.neutralWhite.positiveExposureScale<.5);});
test('Already-warm skin dampens global warmth and warm-channel saturation',()=>{const {compensation}=pipelineParts();assert.equal(compensation.targetProtection.skin.targetAlreadyWarm,true);assert.ok(compensation.targetProtection.skin.globalWarmthScale<.8);assert.ok(compensation.targetProtection.skin.warmSaturationScale<.7);});
test('Scene-specific colour populations are not copied as style',()=>{const {compensation}=pipelineParts();const green=compensation.targetProtection.sceneColor.channels.green;assert.ok(green.transferStrength<.7,green);assert.ok(compensation.targetProtection.sceneColor.dampenedCount>0);});
test('Candidate keeps positive highlight/exposure and skin warming bounded',()=>{const {candidate}=pipelineParts();assert.ok(candidate.safePreset.exp<=5,candidate.safePreset);assert.ok(candidate.safePreset.hi<=3,candidate.safePreset);assert.ok(candidate.safePreset.wh<=2,candidate.safePreset);assert.ok(candidate.safePreset.temp<=10,candidate.safePreset);assert.ok(candidate.safePreset.hsl.hsl_s_orange<=5,candidate.safePreset.hsl);});
test('RAW compatibility profile records Adobe round-trip requirement',()=>{const {candidate}=pipelineParts();assert.equal(candidate.compatibilityProfile.sourceClass,'RAW');assert.equal(candidate.compatibilityProfile.roundTripRequired,true);assert.equal(candidate.fidelityContract.browserPreviewIsAdobeRawRender,false);});

const sig=(role,warm,mid,hue=30)=>buildColorMatchSignature({role,palette:palette([{weight:.5,hsl:{h:hue,s:40,l:60}},{weight:.3,hsl:{h:210,s:30,l:42}},{weight:.2,hsl:{h:0,s:5,l:82}}]),toneZones:tone({shadowWarm:warm-2,midWarm:warm,hiWarm:warm+2,midRgb:{r:mid,g:mid-4,b:mid-8}}),skinAnalysis:{detected:true,coveragePct:18,confidence:.9,avgHue:30,avgSat:40,avgLum:62}});
const refSig=sig('REFERENCE',22,145,30), targetSig=sig('TARGET',-8,120,210), previewSig=sig('TARGET',20,142,32), lrGood=sig('TARGET',19,140,33), lrBad=sig('TARGET',-28,95,220);
const candidateContract={fidelityContract:{previewUsesSafePreset:true,xmpUsesSafePreset:true,presetAndXmpSingleSourceOfTruth:true}};
test('Round-trip marks close Preview/Lightroom rendering strong or acceptable',()=>{const r=evaluateLightroomRoundTrip({referenceSignature:refSig,targetSignature:targetSig,previewSignature:previewSig,lightroomSignature:lrGood,candidate:candidateContract});assert.ok(['ROUND_TRIP_STRONG','ROUND_TRIP_ACCEPTABLE'].includes(r.status),r);assert.ok(r.fidelityScore>=62);});
test('Round-trip fails closed when Lightroom walks away from Reference',()=>{const r=evaluateLightroomRoundTrip({referenceSignature:refSig,targetSignature:targetSig,previewSignature:previewSig,lightroomSignature:lrBad,candidate:candidateContract});assert.equal(r.status,'ROUND_TRIP_REGRESSION');assert.equal(r.production.productionWrite,false);});

const uiSource=readFileSync(new URL('../ui/reference-color-match-panel.js',import.meta.url),'utf8');
const pipelineSource=readFileSync(new URL('../core/color-match/core-color-match-pipeline.js',import.meta.url),'utf8');
test('Reference Color Match UI wires a real Lightroom-return import and evaluator',()=>{assert.ok(uiSource.includes('rcmLightroomResultFileIn'));assert.ok(uiSource.includes('evaluateLightroomRoundTrip'));assert.ok(uiSource.includes('roundTripFidelity'));});
test('Core pipeline forwards target media context and target-aware protection without Production write',()=>{assert.ok(pipelineSource.includes('targetMediaContext'));assert.ok(pipelineSource.includes('protectionOptions'));assert.ok(pipelineSource.includes("productionSource: 'legacy'"));assert.ok(pipelineSource.includes('productionWrite: false'));});
test('Round-trip UI contains no automatic Production activation path',()=>{assert.equal(/productionActivationAllowed\s*:\s*true/.test(uiSource),false);assert.equal(/productionWrite\s*:\s*true/.test(uiSource),false);assert.equal(/xmpWriteAllowed\s*:\s*true/.test(uiSource),false);});

console.log(`\n${pass}/10 PASS, ${process.exitCode?1:0} FAIL`); if(process.exitCode)process.exit(process.exitCode);
