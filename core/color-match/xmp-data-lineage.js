/** EPIC 2E-O3 — End-to-end parameter lineage for Candidate XMP. */
const round=(v,d=3)=>{const p=10**d;return Math.round((Number(v)||0)*p)/p;};
const scalarMap=[
  ['Exposure','exp','tone.exposureEv'],['Contrast','con','tone.contrast'],['Highlights','hi','tone.highlights'],
  ['Shadows','sh','tone.shadows'],['Whites','wh','tone.whites'],['Blacks','bl','tone.blacks'],
  ['Clarity','clarity','presence.clarity'],['Dehaze','dehaze','presence.dehaze'],['Texture','texture','presence.texture'],
  ['Vibrance','vib','presence.vibrance'],['Saturation','sat','presence.saturation'],
];
function at(obj,path){return path.split('.').reduce((v,k)=>v?.[k],obj);}
export function buildXmpDataLineage({analysis,compensation,rawPreset,safePreset,codecResult,readback,directionGate,safetyAdjustments=[]}={}){
  const rows=[];
  rows.push({parameter:'Temperature',referenceTargetDelta:analysis?.delta?.whiteBalance?.warmth??0,compensatedIntent:compensation?.semanticIntents?.whiteBalance?.warmth??0,rawCandidate:rawPreset?.temp??0,safeCandidate:safePreset?.temp??0,serializerInput:codecResult?.wb?.finalTemperatureK,readback:readback?.parsed?.temperatureK,status:codecResult?.wb?.mode==='ABSOLUTE_FROM_TARGET_BASE'?'VERIFIED':'BASE_REQUIRED'});
  rows.push({parameter:'Tint',referenceTargetDelta:analysis?.delta?.whiteBalance?.tint??0,compensatedIntent:compensation?.semanticIntents?.whiteBalance?.tint??0,rawCandidate:rawPreset?.tint??0,safeCandidate:safePreset?.tint??0,serializerInput:codecResult?.wb?.finalTint,readback:readback?.parsed?.tint,status:codecResult?.wb?.mode==='ABSOLUTE_FROM_TARGET_BASE'?'VERIFIED':'PRESERVE_AS_SHOT'});
  for(const [parameter,key,intentPath] of scalarMap) rows.push({parameter,referenceTargetDelta:null,compensatedIntent:at(compensation?.semanticIntents,intentPath),rawCandidate:rawPreset?.[key]??0,safeCandidate:safePreset?.[key]??0,serializerInput:safePreset?.[key]??0,readback:readback?.parsed?.[key]??0,status:'VERIFIED'});
  const mismatches=readback?.mismatches||[];
  for(const row of rows){if(mismatches.some(m=>String(m.parameter).toLowerCase()===String(row.parameter).toLowerCase()||m.parameter===row.parameter))row.status='MISMATCH';}
  const activeRows=rows.filter(r=>Math.abs(Number(r.safeCandidate)||0)>=1);
  const decision=readback?.decision==='PASS'&&directionGate?.decision==='PASS'?'PASS':'FAIL';
  const failureCodes=[...(directionGate?.failures||[]),...mismatches.map(m=>`READBACK_${m.parameter}`)];
  return {kind:'LUMIXA_XMP_DATA_LINEAGE',schemaVersion:1,decision,rows,activeParameterCount:directionGate?.activeParameterCount??activeRows.length,effectiveMagnitude:directionGate?.effectiveMagnitude??0,safetyAdjustmentCount:safetyAdjustments.length,failureCodes:[...new Set(failureCodes)],xmpReadbackDecision:readback?.decision??'NOT_RUN',directionDecision:directionGate?.decision??'NOT_RUN',production:{productionSource:'legacy',productionWrite:false,xmpWriteAllowed:false}};
}
