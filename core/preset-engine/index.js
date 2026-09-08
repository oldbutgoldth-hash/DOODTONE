/**
 * preset-engine
 * Orchestrates all sub-engines → produces a complete PresetParams object.
 * Also owns XMP serialisation (export engine).
 *
 * Reference Tone Extraction mode: buildPreset() is a legacy single-pass
 * fallback (the live pipeline uses core/decision-engine's buildFinalPreset,
 * which combines all 20+ analysis engines). It has been aligned with the
 * same style-preservation philosophy as core/basic-panel-engine — the
 * source image is treated as an intentional, already-edited look, so
 * Exposure/Highlights/Shadows stay near zero and only move to recover
 * genuine highlight/shadow clipping, never to push toward a "neutral"
 * luminance target.
 */

import { clamp } from '../color-engine/index.js';
import { scenePreset, serializeCurvePoints, defaultCurveSet } from '../curve-engine/index.js';
import { inferWhiteBalance, sliderToKelvin } from '../whitebalance-engine/index.js';
import { HSL_CHANNELS } from '../hsl-engine/index.js';
import { buildStyleFingerprint } from '../style-fingerprint/index.js';
import { mapStyleFingerprintToLightroom } from '../lightroom-mapping-engine/index.js';

/**
 * @typedef {Object} PresetParams
 * @property {string} name        Human-readable preset name
 * @property {number} exp         Exposure ×100  (÷100 for Lightroom)
 * @property {number} con         Contrast
 * @property {number} hi          Highlights
 * @property {number} sh          Shadows
 * @property {number} wh          Whites
 * @property {number} bl          Blacks
 * @property {number} clarity
 * @property {number} dehaze
 * @property {number} texture
 * @property {number} temp        Temperature (LR slider)
 * @property {number} tint
 * @property {number} vib         Vibrance
 * @property {number} sat         Saturation
 * @property {number} sharp       Sharpening
 * @property {number} noise       Luminance noise reduction
 * @property {number} crv_hi      Parametric highlights
 * @property {number} crv_mid     Parametric midtones
 * @property {number} crv_sh      Parametric shadows
 * @property {Record<string, number>} hsl   Flat HSL params
 * @property {Record<string, number>} grade Flat colour-grade params
 * @property {Record<string, number>} cal   Flat calibration params
 */

/**
 * Build a complete preset from histogram stats.
 *
 * @param {import('../histogram-engine/index.js').HistogramStats} stats
 * @returns {PresetParams}
 */
export function buildPreset(stats) {
  // ── Legacy single-pass fallback ──────────────────────────────────────────
  // No per-pixel analysis is available here (only histogram stats), so this
  // path builds the leanest possible Style Fingerprint + Decision and
  // funnels through the SAME core/lightroom-mapping-engine used by the live
  // pipeline (core/decision-engine). This keeps the mapping engine the only
  // place that turns analysis into Lightroom numbers — no parallel/duplicate
  // mapping logic lives here anymore.
  const { temperature, tint } = inferWhiteBalance(stats);
  const syntheticWb = { consensus: { temperature, tint } };

  const fingerprint = buildStyleFingerprint({
    stats, basic: null, wb: syntheticWb, skin: null, hsl: null,
    calibration: null, grading: null, toneCurves: null,
    palette: null, harmony: null, styleRecognition: null,
  });

  const skinPct      = stats.skinPct ?? 0;
  const isPortrait    = stats.category === 'Portrait' || stats.category === 'Wedding';
  const portraitSafe = isPortrait || skinPct > 8;
  const decision = {
    category: stats.category, isPortrait, portraitSafe,
    hasSkin: skinPct > 5, skinPct, skinHue: 30,
    mode: 'single-image-auto', gradeStrength: 0.90,
    skinLockScale: skinPct >= 40 ? 0.30 : skinPct >= 20 ? 0.55 : skinPct >= 10 ? 0.75 : 1.0,
  };

  const mapped = mapStyleFingerprintToLightroom({
    fingerprint, decision, stats,
    basic: null, wb: syntheticWb, hsl: null, calibration: null,
    grading: null, toneCurves: null,
  });

  return {
    ...mapped,
    name:   `${stats.category} Grade — Professional`,
    curves: scenePreset(stats.category),
  };
}

// ─── XMP Export ──────────────────────────────────────────────────────────────

/**
 * Serialise a PresetParams object (with any user overrides already applied)
 * to an Adobe Camera Raw XMP string ready for download.
 *
 * @param {PresetParams} p
 * @returns {string}
 */
export function serializeXMP(p) {
  // Build HSL attribute string
  const hslAttrs = HSL_CHANNELS.map((ch) => {
    const cap = ch.charAt(0).toUpperCase() + ch.slice(1);
    return [
      `crs:HueAdjustment${cap}="${p.hsl[`hsl_h_${ch}`] ?? 0}"`,
      `crs:SaturationAdjustment${cap}="${p.hsl[`hsl_s_${ch}`] ?? 0}"`,
      `crs:LuminanceAdjustment${cap}="${p.hsl[`hsl_l_${ch}`] ?? 0}"`,
    ].join('\n      ');
  }).join('\n      ');

  const g  = p.grade ?? {};
  const ca = p.cal   ?? {};

  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:ProcessVersion="11.0"
      crs:PresetType="Normal"
      crs:SupportsAmount="False"
      crs:SupportsColor="True"
      crs:SupportsMonochrome="False"
      crs:SupportsHighDynamicRange="True"
      crs:SupportsNormalDynamicRange="True"
      crs:SupportsSceneReferred="True"
      crs:SupportsOutputReferred="True"
      crs:CameraModelRestriction=""
      crs:Copyright=""
      crs:Exposure2012="${(p.exp / 100).toFixed(2)}"
      crs:Contrast2012="${p.con}"
      crs:Highlights2012="${p.hi}"
      crs:Shadows2012="${p.sh}"
      crs:Whites2012="${p.wh}"
      crs:Blacks2012="${p.bl}"
      crs:Clarity2012="${p.clarity}"
      crs:Dehaze="${p.dehaze}"
      crs:Texture="${p.texture}"
      crs:ParametricShadows="${p.crv_sh}"
      crs:ParametricMidtones="${p.crv_mid}"
      crs:ParametricHighlights="${p.crv_hi}"
      crs:Sharpness="${p.sharp}"
      crs:LuminanceSmoothing="${p.noise}"
      crs:ColorNoiseReduction="25"
      crs:WhiteBalance="Custom"
      crs:Temperature="${sliderToKelvin(p.temp)}"
      crs:Tint="${p.tint}"
      crs:Vibrance="${p.vib}"
      crs:Saturation="${p.sat}"
      crs:ColorGradeShadowHue="${g.grd_sh_h ?? 0}"
      crs:ColorGradeShadowSat="${g.grd_sh_s ?? 0}"
      crs:ColorGradeShadowLum="${g.grd_sh_l ?? 0}"
      crs:ColorGradeMidtoneHue="${g.grd_mid_h ?? 0}"
      crs:ColorGradeMidtoneSat="${g.grd_mid_s ?? 0}"
      crs:ColorGradeMidtoneLum="${g.grd_mid_l ?? 0}"
      crs:ColorGradeHighlightHue="${g.grd_hi_h ?? 0}"
      crs:ColorGradeHighlightSat="${g.grd_hi_s ?? 0}"
      crs:ColorGradeHighlightLum="${g.grd_hi_l ?? 0}"
      crs:ColorGradeBlending="${g.grd_blend ?? 50}"
      crs:RedHue="${ca.cal_red_h ?? 0}"
      crs:RedSaturation="${ca.cal_red_s ?? 0}"
      crs:GreenHue="${ca.cal_green_h ?? 0}"
      crs:GreenSaturation="${ca.cal_green_s ?? 0}"
      crs:BlueHue="${ca.cal_blue_h ?? 0}"
      crs:BlueSaturation="${ca.cal_blue_s ?? 0}"
      ${hslAttrs}
      crs:ToneCurvePV2012="${_curveStr(p, 'master')}"
      crs:ToneCurvePV2012Red="${_curveStr(p, 'red')}"
      crs:ToneCurvePV2012Green="${_curveStr(p, 'green')}"
      crs:ToneCurvePV2012Blue="${_curveStr(p, 'blue')}"
    />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function _curveStr(p, ch) {
  const curves = p.curves ?? defaultCurveSet();
  const pts    = curves[ch] ?? curves.master;
  return serializeCurvePoints(pts);
}

/**
 * Trigger a browser download of the XMP file.
 *
 * @param {string}  xmpString
 * @param {string}  fileName   Without extension
 */
export function downloadXMP(xmpString, fileName) {
  const safe = fileName.replace(/[^\w\u0E00-\u0E7F\s\-_]/g, '_');
  const blob = new Blob([xmpString], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `${safe}.xmp`,
  });
  a.click();
  URL.revokeObjectURL(url);
}
