#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCoreColorMatchAnalysis } from '../core/color-match/core-color-match-analysis.js';
import { buildPhotographicCompensation, COMPENSATION_STATES } from '../core/color-match/photographic-compensation-engine.js';

let pass=0; const test=(n,f)=>{try{f();pass++;console.log(`✓ [PASS] ${n}`)}catch(e){console.error(`✗ [FAIL] ${n}\n${e.stack}`);process.exitCode=1}};
const palette=(neutral=.2,dominant=.38)=>({confidence:.9,colors:[
 {weight:dominant,hsl:{h:30,s:45,l:62}}, {weight:.25,hsl:{h:210,s:30,l:42}},
 {weight:neutral,hsl:{h:0,s:4,l:80}}, {weight:Math.max(.01,1-dominant-.25-neutral),hsl:{h:110,s:35,l:35}},
]});
const tone=({warm=[20,22,21],tint=[2,1,2],lum=0,clip=0}={})=>({
 shadow:{avgColor:{r:40+lum,g:38+lum,b:35+lum},temperatureHint:warm[0],tintHint:tint[0],pixelShare:.3},
 midtone:{avgColor:{r:130+lum,g:125+lum,b:118+lum},temperatureHint:warm[1],tintHint:tint[1],pixelShare:.5},
 highlight:{avgColor:{r:225+lum,g:218+lum,b:206+lum},temperatureHint:warm[2],tintHint:tint[2],pixelShare:.2},
 contrast:50,blackPoint:10,whitePoint:244,clip,
});
function analysis({refTone=tone(),tgtTone=tone({warm:[-15,-14,-16],tint:[0,0,0]}),refPalette=palette(),tgtPalette=palette(),skin=true,clipHi=.1,clipLo=.1}={}){
 return buildCoreColorMatchAnalysis({reference:{palette:refPalette,toneZones:refTone,skinAnalysis:{detected:skin,coveragePct:22,confidence:.85,avgHue:30,avgSat:38,avgLum:62},histogram:{clipHiPct:.1,clipLoPct:.1,drStops:10}},target:{palette:tgtPalette,toneZones:tgtTone,skinAnalysis:{detected:skin,coveragePct:25,confidence:.88,avgHue:31,avgSat:39,avgLum:60},histogram:{clipHiPct:clipHi,clipLoPct:clipLo,drStops:8}},analysisGenerationId:'n2'});
}

test('N2 creates bounded semantic intents without Lightroom/XMP write',()=>{const c=buildPhotographicCompensation({analysis:analysis(),intensity:70});assert.equal(c.stage,'N2_PHOTOGRAPHIC_COMPENSATION');assert.equal(c.production.productionSource,'legacy');assert.equal(c.production.xmpWriteAllowed,false);assert.ok(Math.abs(c.semanticIntents.whiteBalance.warmth)<=45);});
test('Uniform cross-zone cast is treated as illuminant evidence',()=>{const c=buildPhotographicCompensation({analysis:analysis()});assert.ok(c.illuminant.zoneConsistency>.75,c.illuminant.zoneConsistency);assert.ok(c.illuminant.transferStrength>.3,c.illuminant.transferStrength);});
test('Inconsistent zones and dominant colour dampen WB as object bias',()=>{const a=analysis({refTone:tone({warm:[45,-10,35],tint:[25,-18,12]}),refPalette:palette(.02,.72)});const c=buildPhotographicCompensation({analysis:a});assert.ok(c.objectColorBias.score>.45,c.objectColorBias.score);assert.ok(c.illuminant.transferStrength<.45,c.illuminant.transferStrength);});
test('Skin protection dampens red/orange/yellow transfer',()=>{const withSkin=buildPhotographicCompensation({analysis:analysis({skin:true})});const noSkin=buildPhotographicCompensation({analysis:analysis({skin:false})});assert.ok(withSkin.skinProtection.active);assert.ok(Math.abs(withSkin.semanticIntents.hsl.orange.saturation)<=Math.abs(noSkin.semanticIntents.hsl.orange.saturation));});
test('Highlight clipping risk reduces highlight transfer strength',()=>{const safe=buildPhotographicCompensation({analysis:analysis({clipHi:0})});const risky=buildPhotographicCompensation({analysis:analysis({clipHi:4})});assert.ok(risky.dynamicRange.highlightTransferStrength<safe.dynamicRange.highlightTransferStrength);});
test('Low evidence blocks compensation fail-closed',()=>{const a=analysis({refPalette:{confidence:0.01,colors:palette().colors},tgtPalette:{confidence:0.01,colors:palette().colors}});a.referenceSignature.evidence.confidence=.2;a.targetSignature.evidence.confidence=.2;a.delta.evidence.combinedConfidence=.2;const c=buildPhotographicCompensation({analysis:a});assert.equal(c.state,COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE);assert.equal(c.semanticIntents.whiteBalance.warmth,0);});
test('Already-close pair becomes safe identity',()=>{const a=buildCoreColorMatchAnalysis({reference:{palette:palette(),toneZones:tone()},target:{palette:palette(),toneZones:tone()}});const c=buildPhotographicCompensation({analysis:a});assert.equal(c.state,COMPENSATION_STATES.SAFE_IDENTITY);});
console.log(`\n${pass}/7 PASS, ${process.exitCode?1:0} FAIL`); if(process.exitCode)process.exit(process.exitCode);
