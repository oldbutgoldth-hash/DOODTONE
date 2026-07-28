/** EPIC 2E-O5 — Pairwise photographic direction and non-degeneracy gate. */
const sign=(v,eps=0)=>Math.abs(Number(v)||0)<=eps?0:Math.sign(Number(v));
const abs=v=>Math.abs(Number(v)||0);
const round=(v,d=3)=>{const p=10**d;return Math.round((Number(v)||0)*p)/p;};

function curveMagnitude(curves={}){
  let mag=0;
  for(const ch of ['master','red','green','blue']) for(const p of curves[ch]||[]) mag+=Math.abs((p.y||0)-(p.x||0));
  return mag;
}
function countActive(preset={}){
  const scalar=['exp','con','hi','sh','wh','bl','clarity','dehaze','texture','temp','tint','vib','sat'];
  let count=scalar.filter(k=>abs(preset[k])>=1).length;
  for(const value of Object.values(preset.hsl||{})) if(abs(value)>=1) count++;
  for(const [key,value] of Object.entries(preset.grade||{})) if(key!=='grd_blend'&&abs(value)>=1) count++;
  for(const value of Object.values(preset.cal||{})) if(abs(value)>=1) count++;
  if(curveMagnitude(preset.curves)>=4) count++;
  return count;
}
export function evaluateColorMatchDirection({ analysis, compensation, preset, wbContext }={}){
  const delta=analysis?.delta; const checks=[]; const failures=[]; const warnings=[];
  if(!delta||!preset) return {decision:'FAIL',code:'DIRECTION_EVIDENCE_MISSING',checks,failures:['DIRECTION_EVIDENCE_MISSING'],warnings,activeParameterCount:0,effectiveMagnitude:0};
  const protection=compensation?.targetProtection;
  const protectedNeutral=Boolean(protection?.neutralWhite?.active);
  const test=(name,expected,actual,{threshold=2,allowNeutral=false}={})=>{
    const e=sign(expected,threshold),a=sign(actual,threshold);
    const pass=e===0||a===e||(allowNeutral&&a===0);
    checks.push({name,expected:round(expected),actual:round(actual),pass});
    if(!pass)failures.push(name);
  };
  test('WB_WARMTH_DIRECTION',delta.whiteBalance.warmth,wbContext?.deltaTemperatureK||0,{threshold:2,allowNeutral:false});
  // Mapper inverts N1 tint semantics to Lightroom tint direction.
  test('WB_TINT_DIRECTION',-delta.whiteBalance.tint,wbContext?.deltaTint||0,{threshold:2,allowNeutral:true});
  test('MIDTONE_DIRECTION',delta.tone.midtoneLuma,preset.exp,{threshold:4,allowNeutral:protectedNeutral});
  test('CONTRAST_DIRECTION',delta.tone.contrast,preset.con,{threshold:4,allowNeutral:true});
  test('SATURATION_DIRECTION',delta.color.weightedSaturation,(preset.vib||0)+(preset.sat||0),{threshold:4,allowNeutral:true});

  const activeParameterCount=countActive(preset);
  const effectiveMagnitude=round(
    abs(wbContext?.deltaTemperatureK)/100 + abs(wbContext?.deltaTint) +
    ['exp','con','hi','sh','wh','bl','clarity','dehaze','vib','sat'].reduce((s,k)=>s+abs(preset[k]),0)/4 +
    Object.values(preset.hsl||{}).reduce((s,v)=>s+abs(v),0)/12 + curveMagnitude(preset.curves)/10,
  2);
  const matchNeed=Number(delta.matchNeedScore)||0;
  if(matchNeed>=10 && activeParameterCount<4){failures.push('DEGENERATE_ACTIVE_PARAMETER_COUNT');}
  if(matchNeed>=18 && effectiveMagnitude<6){failures.push('DEGENERATE_EFFECTIVE_MAGNITUDE');}
  if(abs(delta.whiteBalance.warmth)>=8 && abs(wbContext?.deltaTemperatureK)<80){failures.push('WB_STYLE_COLLAPSED');}
  if(wbContext?.blockerCode) failures.push(wbContext.blockerCode);
  if(protectedNeutral && sign(delta.tone.midtoneLuma,4)!==0 && sign(preset.exp,2)===0) warnings.push('TONE_MOVE_NEUTRALIZED_BY_PROTECTION');

  let code='MATCH_DIRECTION_VALID';
  if(failures.includes('TARGET_RAW_WB_BASE_REQUIRED')) code='TARGET_RAW_WB_BASE_REQUIRED';
  else if(failures.some(x=>x.includes('DIRECTION'))) code='MATCH_DIRECTION_REGRESSION';
  else if(failures.some(x=>x.includes('DEGENERATE')||x.includes('COLLAPSED'))) code='MATCH_STYLE_COLLAPSED';
  return {decision:failures.length?'FAIL':'PASS',code,checks,failures:[...new Set(failures)],warnings,activeParameterCount,effectiveMagnitude,matchNeed};
}
