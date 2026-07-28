/**
 * EPIC 2E-O3/O4 — Candidate-only XMP codec and structural readback.
 *
 * This codec is deliberately separate from the Legacy Production serializer.
 * It accepts pairwise Color Match candidate data, preserves the Target camera
 * profile by omission, and refuses to invent an absolute RAW white balance.
 */
import { serializeCurvePoints, parseCurvePoints, defaultCurveSet } from '../curve-engine/index.js';

export const CANDIDATE_XMP_CODEC_KIND = 'LUMIXA_CANDIDATE_XMP_CODEC';
export const CANDIDATE_XMP_CODEC_VERSION = 1;
export const HSL_CHANNELS = Object.freeze(['red','orange','yellow','green','aqua','blue','purple','magenta']);
const clamp = (v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
const round = (v,d=0)=>{const p=10**d;return Math.round((Number(v)||0)*p)/p;};
const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function validKelvin(value){ const n=Number(value); return Number.isFinite(n) && n>=2000 && n<=50000; }
function validTint(value){ const n=Number(value); return Number.isFinite(n) && n>=-150 && n<=150; }

/** Convert LUMIXA semantic warmth units into a conservative Kelvin delta. */
export function semanticWarmthToKelvinDelta(warmth, { kelvinPerUnit = 42, maxAbsKelvin = 1800 } = {}) {
  return round(clamp((Number(warmth)||0) * kelvinPerUnit, -maxAbsKelvin, maxAbsKelvin));
}

export function buildCandidateWhiteBalanceContext({ preset, targetMediaContext = {} } = {}) {
  targetMediaContext = targetMediaContext || {};
  const mediaType = String(targetMediaContext.mediaType || '').toUpperCase();
  const fileName = String(targetMediaContext.fileName || '');
  const rawByName = /\.(cr2|cr3|nef|arw|orf|rw2|raf|dng|pef)$/i.test(fileName);
  const isRaw = mediaType === 'RAW' || rawByName;
  const baseTemperatureK = Number(targetMediaContext.baseTemperatureK);
  const baseTint = Number(targetMediaContext.baseTint);
  const deltaTemperatureK = semanticWarmthToKelvinDelta(preset?.temp);
  const deltaTint = round(Number(preset?.tint)||0);
  const hasBase = validKelvin(baseTemperatureK) && validTint(baseTint);
  const needsWbMove = Math.abs(deltaTemperatureK) >= 40 || Math.abs(deltaTint) >= 1;

  if (hasBase) {
    return {
      mode: 'ABSOLUTE_FROM_TARGET_BASE',
      isRaw,
      baseTemperatureK: round(baseTemperatureK),
      baseTint: round(baseTint),
      deltaTemperatureK,
      deltaTint,
      finalTemperatureK: round(clamp(baseTemperatureK + deltaTemperatureK, 2000, 50000)),
      finalTint: round(clamp(baseTint + deltaTint, -150, 150)),
      exportReady: true,
      blockerCode: null,
    };
  }
  return {
    mode: 'PRESERVE_TARGET_AS_SHOT',
    isRaw,
    baseTemperatureK: null,
    baseTint: null,
    deltaTemperatureK,
    deltaTint,
    finalTemperatureK: null,
    finalTint: null,
    exportReady: !isRaw || !needsWbMove,
    blockerCode: isRaw && needsWbMove ? 'TARGET_RAW_WB_BASE_REQUIRED' : null,
  };
}

function attr(name,value){ return `      crs:${name}="${esc(value)}"`; }
function numberAttr(name,value,digits=null){
  const n=Number(value)||0;
  return attr(name,digits==null?String(round(n)):n.toFixed(digits));
}
function curveStr(p,ch){ const curves=p.curves||defaultCurveSet(); return serializeCurvePoints(curves[ch]||curves.master); }

export function serializeCandidateXMP({ preset, targetMediaContext = {}, candidateName = 'LUMIXA-Core-Color-Match-Candidate' } = {}) {
  if (!preset || typeof preset !== 'object') throw new TypeError('Candidate XMP requires a preset object.');
  const wb = buildCandidateWhiteBalanceContext({ preset, targetMediaContext });
  const hslAttrs=[];
  for (const ch of HSL_CHANNELS) {
    const cap=ch.charAt(0).toUpperCase()+ch.slice(1);
    hslAttrs.push(numberAttr(`HueAdjustment${cap}`,preset.hsl?.[`hsl_h_${ch}`]));
    hslAttrs.push(numberAttr(`SaturationAdjustment${cap}`,preset.hsl?.[`hsl_s_${ch}`]));
    hslAttrs.push(numberAttr(`LuminanceAdjustment${cap}`,preset.hsl?.[`hsl_l_${ch}`]));
  }
  const g=preset.grade||{}, ca=preset.cal||{};
  const wbAttrs = wb.mode === 'ABSOLUTE_FROM_TARGET_BASE'
    ? [attr('WhiteBalance','Custom'),numberAttr('Temperature',wb.finalTemperatureK),numberAttr('Tint',wb.finalTint)]
    : [attr('WhiteBalance','As Shot')];
  const attrs=[
    attr('ProcessVersion','11.0'), attr('PresetType','Normal'), attr('Name',candidateName),
    attr('SupportsAmount','False'), attr('SupportsColor','True'), attr('SupportsMonochrome','False'),
    attr('SupportsHighDynamicRange','True'), attr('SupportsNormalDynamicRange','True'),
    // Camera profile is intentionally omitted: Lightroom retains the Target profile.
    numberAttr('Exposure2012',(preset.exp||0)/100,2), numberAttr('Contrast2012',preset.con),
    numberAttr('Highlights2012',preset.hi), numberAttr('Shadows2012',preset.sh),
    numberAttr('Whites2012',preset.wh), numberAttr('Blacks2012',preset.bl),
    numberAttr('Clarity2012',preset.clarity), numberAttr('Dehaze',preset.dehaze), numberAttr('Texture',preset.texture),
    numberAttr('Vibrance',preset.vib), numberAttr('Saturation',preset.sat),
    ...wbAttrs,
    numberAttr('ColorGradeShadowHue',g.grd_sh_h), numberAttr('ColorGradeShadowSat',g.grd_sh_s), numberAttr('ColorGradeShadowLum',g.grd_sh_l),
    numberAttr('ColorGradeMidtoneHue',g.grd_mid_h), numberAttr('ColorGradeMidtoneSat',g.grd_mid_s), numberAttr('ColorGradeMidtoneLum',g.grd_mid_l),
    numberAttr('ColorGradeHighlightHue',g.grd_hi_h), numberAttr('ColorGradeHighlightSat',g.grd_hi_s), numberAttr('ColorGradeHighlightLum',g.grd_hi_l),
    numberAttr('ColorGradeBlending',g.grd_blend??50),
    numberAttr('RedHue',ca.cal_red_h), numberAttr('RedSaturation',ca.cal_red_s),
    numberAttr('GreenHue',ca.cal_green_h), numberAttr('GreenSaturation',ca.cal_green_s),
    numberAttr('BlueHue',ca.cal_blue_h), numberAttr('BlueSaturation',ca.cal_blue_s),
    ...hslAttrs,
    attr('ToneCurveName2012','Custom'),
    attr('ToneCurvePV2012',curveStr(preset,'master')),
    attr('ToneCurvePV2012Red',curveStr(preset,'red')),
    attr('ToneCurvePV2012Green',curveStr(preset,'green')),
    attr('ToneCurvePV2012Blue',curveStr(preset,'blue')),
  ];
  const xmp=`<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n    <rdf:Description rdf:about=""\n      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"\n${attrs.join('\n')}\n    />\n  </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;
  return {
    kind:CANDIDATE_XMP_CODEC_KIND, schemaVersion:CANDIDATE_XMP_CODEC_VERSION,
    xmp, wb, profilePolicy:'PRESERVE_TARGET_PROFILE_BY_OMISSION',
  };
}

function getAttr(xmp,name){ const m=String(xmp).match(new RegExp(`\\bcrs:${name}="([^"]*)"`)); return m?m[1]:null; }
function num(xmp,name){ const v=getAttr(xmp,name); return v==null?null:Number(v); }
export function parseCandidateXMP(xmp){
  const hsl={};
  for(const ch of HSL_CHANNELS){const cap=ch.charAt(0).toUpperCase()+ch.slice(1);hsl[`hsl_h_${ch}`]=num(xmp,`HueAdjustment${cap}`)??0;hsl[`hsl_s_${ch}`]=num(xmp,`SaturationAdjustment${cap}`)??0;hsl[`hsl_l_${ch}`]=num(xmp,`LuminanceAdjustment${cap}`)??0;}
  return {
    whiteBalance:getAttr(xmp,'WhiteBalance'), temperatureK:num(xmp,'Temperature'), tint:num(xmp,'Tint'),
    exp:round((num(xmp,'Exposure2012')??0)*100), con:num(xmp,'Contrast2012')??0, hi:num(xmp,'Highlights2012')??0,
    sh:num(xmp,'Shadows2012')??0, wh:num(xmp,'Whites2012')??0, bl:num(xmp,'Blacks2012')??0,
    clarity:num(xmp,'Clarity2012')??0, dehaze:num(xmp,'Dehaze')??0, texture:num(xmp,'Texture')??0,
    vib:num(xmp,'Vibrance')??0, sat:num(xmp,'Saturation')??0, hsl,
    grade:{grd_sh_h:num(xmp,'ColorGradeShadowHue')??0,grd_sh_s:num(xmp,'ColorGradeShadowSat')??0,grd_sh_l:num(xmp,'ColorGradeShadowLum')??0,grd_mid_h:num(xmp,'ColorGradeMidtoneHue')??0,grd_mid_s:num(xmp,'ColorGradeMidtoneSat')??0,grd_mid_l:num(xmp,'ColorGradeMidtoneLum')??0,grd_hi_h:num(xmp,'ColorGradeHighlightHue')??0,grd_hi_s:num(xmp,'ColorGradeHighlightSat')??0,grd_hi_l:num(xmp,'ColorGradeHighlightLum')??0,grd_blend:num(xmp,'ColorGradeBlending')??50},
    cal:{cal_red_h:num(xmp,'RedHue')??0,cal_red_s:num(xmp,'RedSaturation')??0,cal_green_h:num(xmp,'GreenHue')??0,cal_green_s:num(xmp,'GreenSaturation')??0,cal_blue_h:num(xmp,'BlueHue')??0,cal_blue_s:num(xmp,'BlueSaturation')??0},
    curves:{master:parseCurvePoints(getAttr(xmp,'ToneCurvePV2012')||'0,0,255,255'),red:parseCurvePoints(getAttr(xmp,'ToneCurvePV2012Red')||'0,0,255,255'),green:parseCurvePoints(getAttr(xmp,'ToneCurvePV2012Green')||'0,0,255,255'),blue:parseCurvePoints(getAttr(xmp,'ToneCurvePV2012Blue')||'0,0,255,255')},
    cameraProfile:getAttr(xmp,'CameraProfile')||getAttr(xmp,'Look'),
  };
}

function sameNumber(a,b,tolerance=.001){return Math.abs((Number(a)||0)-(Number(b)||0))<=tolerance;}
function sameCurve(a,b){return JSON.stringify(a||[])===JSON.stringify(b||[]);}
export function verifyCandidateXmpReadback({ preset, codecResult } = {}){
  const parsed=parseCandidateXMP(codecResult?.xmp||''); const mismatches=[];
  const fields=[['exp','exp'],['con','con'],['hi','hi'],['sh','sh'],['wh','wh'],['bl','bl'],['clarity','clarity'],['dehaze','dehaze'],['texture','texture'],['vib','vib'],['sat','sat']];
  for(const [pKey,rKey] of fields) if(!sameNumber(preset?.[pKey],parsed[rKey],pKey==='exp'?1:.001)) mismatches.push({parameter:pKey,expected:preset?.[pKey],actual:parsed[rKey]});
  for(const ch of HSL_CHANNELS) for(const axis of ['h','s','l']){const key=`hsl_${axis}_${ch}`;if(!sameNumber(preset?.hsl?.[key],parsed.hsl[key]))mismatches.push({parameter:key,expected:preset?.hsl?.[key],actual:parsed.hsl[key]});}
  for(const ch of ['master','red','green','blue']) if(!sameCurve(preset?.curves?.[ch],parsed.curves[ch]))mismatches.push({parameter:`curve.${ch}`,expected:preset?.curves?.[ch],actual:parsed.curves[ch]});
  if(parsed.cameraProfile) mismatches.push({parameter:'cameraProfile',expected:null,actual:parsed.cameraProfile});
  const wb=codecResult?.wb;
  if(wb?.mode==='ABSOLUTE_FROM_TARGET_BASE'){
    if(!sameNumber(wb.finalTemperatureK,parsed.temperatureK))mismatches.push({parameter:'temperatureK',expected:wb.finalTemperatureK,actual:parsed.temperatureK});
    if(!sameNumber(wb.finalTint,parsed.tint))mismatches.push({parameter:'tint',expected:wb.finalTint,actual:parsed.tint});
  } else if(parsed.whiteBalance!=='As Shot') mismatches.push({parameter:'whiteBalance',expected:'As Shot',actual:parsed.whiteBalance});
  return { decision:mismatches.length?'FAIL':'PASS', mismatches, parsed };
}
