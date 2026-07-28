import assert from 'node:assert/strict';
import { buildUnifiedCoreMatrix } from '../core/color-match/unified-core-output-contract.js';
import { buildUnifiedCoreFusion, applyUnifiedFusionToPreset } from '../core/color-match/unified-core-fusion-orchestrator.js';

let pass=0;
const test=(name,fn)=>{try{fn();pass++;console.log(`✓ [PASS] ${name}`)}catch(e){console.error(`✗ [FAIL] ${name}: ${e.message}`);process.exitCode=1}};
const output=(adjustments,confidence=.9)=>({confidence,recommendedAdjustments:adjustments});
const reference={coreOutputs:{
  whiteBalancePro:output({temperature:6400,tint:8}),
  lightroomBasicPanel:output({exposure:20,contrast:12,highlights:-8,shadows:15,whites:-5,blacks:-8,vibrance:18}),
  toneCurveAI:output({curves:{master:[{x:0,y:0},{x:128,y:140},{x:255,y:255}],red:[{x:0,y:0},{x:255,y:255}],green:[{x:0,y:0},{x:255,y:255}],blue:[{x:0,y:0},{x:255,y:255}]}}),
  hslAnalyzerPro:output({channels:{orange:{hue:-4,saturation:8,luminance:6}}}),
  colorGradingAI:output({shadows:{hue:215,saturation:4,luminance:0},midtones:{hue:42,saturation:8,luminance:0},highlights:{hue:48,saturation:10,luminance:0},blending:55}),
  calibrationEngine:output({red:{hue:-5,saturation:3},green:{hue:1,saturation:0},blue:{hue:-2,saturation:2}}),
  colourPaletteKMeans:output({paletteDistance:12},.8), histogramMetrics:output({contrast:55},.8),
  skinToneDetectionPro:{confidence:.9,constraints:{warmthScale:.7}}, featureFusionEngine:output({},.8), decisionEngine:output({},.8),
}};
const target={coreOutputs:{
  whiteBalancePro:output({temperature:5500,tint:2}),
  lightroomBasicPanel:output({exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,vibrance:0}),
  toneCurveAI:output({curves:{master:[{x:0,y:0},{x:128,y:128},{x:255,y:255}],red:[{x:0,y:0},{x:255,y:255}],green:[{x:0,y:0},{x:255,y:255}],blue:[{x:0,y:0},{x:255,y:255}]}}),
  hslAnalyzerPro:output({channels:{orange:{hue:0,saturation:0,luminance:0}}}),
  colorGradingAI:output({shadows:{hue:215,saturation:0,luminance:0},midtones:{hue:42,saturation:0,luminance:0},highlights:{hue:48,saturation:0,luminance:0},blending:50}),
  calibrationEngine:output({red:{hue:0,saturation:0},green:{hue:0,saturation:0},blue:{hue:0,saturation:0}}),
  colourPaletteKMeans:output({paletteDistance:0},.8), histogramMetrics:output({contrast:40},.8),
  skinToneDetectionPro:{confidence:.9,constraints:{warmthScale:.7}}, featureFusionEngine:output({},.8), decisionEngine:output({},.8),
}};
const matrix=buildUnifiedCoreMatrix({reference,target,generationId:'g1'});
const fusion=buildUnifiedCoreFusion({matrix,compensation:{}});

test('matrix contains primary and evidence cores',()=>assert.ok(matrix.modules.length>=20));
test('white balance output is consumed',()=>assert.equal(fusion.utilization.find(x=>x.moduleId==='whiteBalancePro').consumed,true));
test('temperature contribution exists',()=>assert.ok(fusion.ledger.temp?.length));
test('basic panel contributes multiple parameters',()=>assert.ok(Object.keys(fusion.ledger).includes('con')&&Object.keys(fusion.ledger).includes('vib')));
test('HSL analyzer contributes orange channel',()=>assert.ok(fusion.ledger.hsl_h_orange));
test('color grading contributes midtone saturation',()=>assert.ok(fusion.ledger.grd_mid_s));
test('calibration contributes red primary',()=>assert.ok(fusion.ledger.cal_red_h));
test('tone curve output is consumed as curve source',()=>assert.equal(fusion.curves.master[1].y,140));
test('required available core outputs are not dropped',()=>assert.equal(fusion.gate.decision,'PASS'));
const preset={temp:0,tint:0,exp:0,con:0,hi:0,sh:0,wh:0,bl:0,clarity:0,dehaze:0,texture:0,vib:0,sat:0,hsl:{},grade:{},cal:{},curves:{master:[{x:0,y:0},{x:255,y:255}],red:[{x:0,y:0},{x:255,y:255}],green:[{x:0,y:0},{x:255,y:255}],blue:[{x:0,y:0},{x:255,y:255}]}};
const fused=applyUnifiedFusionToPreset(preset,fusion);
test('fusion changes preset values',()=>assert.notEqual(fused.temp,0));
test('fusion uses tone curve source',()=>assert.equal(fused.curves.master[1].y,140));
test('fusion attaches contribution metadata',()=>assert.equal(fused.unifiedCoreFusion.gate.decision,'PASS'));
console.log(`\n${pass}/12 PASS`);
