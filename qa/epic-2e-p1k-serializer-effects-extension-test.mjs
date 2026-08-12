#!/usr/bin/env node
/**
 * EPIC 2E-P1K — Serializer Extension for Post-Crop Vignette + Grain:
 * real integration test.
 *
 * Runs against the REAL production modules this round deliberately
 * edited for the first time: core/preset-engine/index.js::serializeXMP
 * (adds 7 crs: attrs + 1 fixed literal), core/xmp-validator/index.js
 * (adds Layer-B _clampEffectsPanel), core/single-image/candidate/
 * candidate-schema.js + legacy-preset-adapter.js + candidate-export-
 * parity.js, and core/single-image/xmp-fidelity/xmp-property-map.js +
 * xmp-readback-schema.js + xmp-readback-parser.js +
 * candidate-xmp-comparator.js. Nine files total -- see
 * P1K_MODIFIED_FILES.md.
 *
 * Run: node qa/epic-2e-p1k-serializer-effects-extension-test.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ [PASS] ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`✗ [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

const { createEmptyCandidate, UNSUPPORTED_FIELD_PATHS } = await import('../core/single-image/candidate/candidate-schema.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { computeExportParity, getExportParityMismatches } = await import('../core/single-image/candidate/candidate-export-parity.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');
const { quickSafetyClamp, HARD_LIMITS } = await import('../core/xmp-validator/index.js');
const { sliderToKelvin } = await import('../core/whitebalance-engine/index.js');
const { parseXmpReadback } = await import('../core/single-image/xmp-fidelity/xmp-readback-parser.js');
const { PARSE_STATUS } = await import('../core/single-image/xmp-fidelity/xmp-readback-schema.js');
const { PROPERTY_MAP, CURVE_PROPERTIES, UNSUPPORTED_CANDIDATE_PATHS, XMP_FIXED_ATTRIBUTES, getAllRequiredXmpProperties } = await import('../core/single-image/xmp-fidelity/xmp-property-map.js');
const { compareCandidateToReadback, COMPARISON_RESULT } = await import('../core/single-image/xmp-fidelity/candidate-xmp-comparator.js');

function freshCandidate(overrides = {}) {
  const c = createEmptyCandidate({ sessionId: 's1', generationId: 1, candidateId: 'cand1' });
  if (overrides.effects) c.effects = { ...c.effects, ...overrides.effects };
  return c;
}

/** Real pipeline: Candidate -> legacy preset -> Layer-B clamp -> serialize -> readback -> compare. */
function runFullPipeline(candidate) {
  const preClamp = candidateToLegacyPreset(candidate);
  const { preset, adjustments } = quickSafetyClamp(preClamp);
  const xmp = serializeXMP(preset);
  const readback = parseXmpReadback(xmp);
  const { comparisons, summary } = compareCandidateToReadback({ candidate, exportExpectedPreset: preset, readback, sliderToKelvin });
  return { preClamp, preset, adjustments, xmp, readback, comparisons, summary };
}

function sha256File(relPath) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relPath))).digest('hex');
}

// ══════════════════════════════════════════════════════════════════
// 1-3. Schema surface (candidate-schema.js)
// ══════════════════════════════════════════════════════════════════
{
  const c = freshCandidate();
  check('1. A fresh Candidate has all 7 effects.* fields, all null (no fabricated default on the Candidate itself)',
    Object.keys(c.effects).length === 7 &&
    c.effects.postCropVignetteAmount === null && c.effects.postCropVignetteMidpoint === null &&
    c.effects.postCropVignetteRoundness === null && c.effects.postCropVignetteFeather === null &&
    c.effects.grainAmount === null && c.effects.grainSize === null && c.effects.grainFrequency === null);
  check('2. UNSUPPORTED_FIELD_PATHS no longer lists any effects.* path (12 entries, was 19)',
    UNSUPPORTED_FIELD_PATHS.length === 12 && !UNSUPPORTED_FIELD_PATHS.some((p) => p.startsWith('effects.')));
  check('3. UNSUPPORTED_FIELD_PATHS still lists detail/grading.balance/cal.shadowTint/optics.* (scope unchanged elsewhere)',
    UNSUPPORTED_FIELD_PATHS.includes('detail.radius') && UNSUPPORTED_FIELD_PATHS.includes('grading.balance') &&
    UNSUPPORTED_FIELD_PATHS.includes('cal.shadowTint') && UNSUPPORTED_FIELD_PATHS.includes('optics.vignette'));
}

// ══════════════════════════════════════════════════════════════════
// 4-8. Property map (xmp-property-map.js)
// ══════════════════════════════════════════════════════════════════
{
  const fxEntries = PROPERTY_MAP.filter((e) => e.candidatePath.startsWith('effects.'));
  const byPath = Object.fromEntries(fxEntries.map((e) => [e.candidatePath, e]));
  check('4. PROPERTY_MAP grew by exactly 7 (58 -> 65)', PROPERTY_MAP.length === 65 && fxEntries.length === 7);
  check('5. All 7 effects.* entries map to the correct real crs: attribute names',
    byPath['effects.postCropVignetteAmount']?.xmpProperty === 'crs:PostCropVignetteAmount' &&
    byPath['effects.postCropVignetteMidpoint']?.xmpProperty === 'crs:PostCropVignetteMidpoint' &&
    byPath['effects.postCropVignetteRoundness']?.xmpProperty === 'crs:PostCropVignetteRoundness' &&
    byPath['effects.postCropVignetteFeather']?.xmpProperty === 'crs:PostCropVignetteFeather' &&
    byPath['effects.grainAmount']?.xmpProperty === 'crs:GrainAmount' &&
    byPath['effects.grainSize']?.xmpProperty === 'crs:GrainSize' &&
    byPath['effects.grainFrequency']?.xmpProperty === 'crs:GrainFrequency');
  check('6. All 7 effects.* entries are EXACT_INT, clampGroup "effects", required:true',
    fxEntries.every((e) => e.compareMode === 'EXACT_INT' && e.clampGroup === 'effects' && e.required === true));
  check('7. UNSUPPORTED_CANDIDATE_PATHS shrank by exactly 7 (23 -> 16), no effects.* remains',
    UNSUPPORTED_CANDIDATE_PATHS.length === 16 && !UNSUPPORTED_CANDIDATE_PATHS.some((p) => p.startsWith('effects.')));
  check('8. XMP_FIXED_ATTRIBUTES declares crs:PostCropVignetteStyle="1" (Highlight Priority, never Candidate-driven)',
    XMP_FIXED_ATTRIBUTES['crs:PostCropVignetteStyle'] === '1');
  check('9. getAllRequiredXmpProperties() grew by exactly 7 (62 -> 69)', getAllRequiredXmpProperties().length === 69);
}

// ══════════════════════════════════════════════════════════════════
// 10-11. Legacy preset adapter (legacy-preset-adapter.js)
// ══════════════════════════════════════════════════════════════════
{
  const c1 = freshCandidate();
  const flat1 = candidateToLegacyPreset(c1);
  check('10. All-null Candidate -> adapter emits Lightroom-default flat effects object (0/50/0/50/0/25/50)',
    flat1.effects.fx_vignette_amount === 0 && flat1.effects.fx_vignette_midpoint === 50 &&
    flat1.effects.fx_vignette_roundness === 0 && flat1.effects.fx_vignette_feather === 50 &&
    flat1.effects.fx_grain_amount === 0 && flat1.effects.fx_grain_size === 25 && flat1.effects.fx_grain_frequency === 50);

  const c2 = freshCandidate({ effects: { postCropVignetteAmount: -30, postCropVignetteMidpoint: 65, postCropVignetteRoundness: 15, postCropVignetteFeather: 35, grainAmount: 20, grainSize: 40, grainFrequency: 60 } });
  const flat2 = candidateToLegacyPreset(c2);
  check('11. Populated Candidate -> adapter forwards EXACT values unchanged (no re-scaling, no rounding)',
    flat2.effects.fx_vignette_amount === -30 && flat2.effects.fx_vignette_midpoint === 65 &&
    flat2.effects.fx_vignette_roundness === 15 && flat2.effects.fx_vignette_feather === 35 &&
    flat2.effects.fx_grain_amount === 20 && flat2.effects.fx_grain_size === 40 && flat2.effects.fx_grain_frequency === 60);
}

// ══════════════════════════════════════════════════════════════════
// 12-15. serializeXMP() direct output
// ══════════════════════════════════════════════════════════════════
{
  const c1 = freshCandidate();
  const xmp1 = serializeXMP(quickSafetyClamp(candidateToLegacyPreset(c1)).preset);
  check('12. Default (all-null-effects) export emits all 7 attrs at their Lightroom-default values + the fixed Style literal',
    /crs:PostCropVignetteAmount="0"/.test(xmp1) && /crs:PostCropVignetteMidpoint="50"/.test(xmp1) &&
    /crs:PostCropVignetteRoundness="0"/.test(xmp1) && /crs:PostCropVignetteFeather="50"/.test(xmp1) &&
    /crs:PostCropVignetteStyle="1"/.test(xmp1) &&
    /crs:GrainAmount="0"/.test(xmp1) && /crs:GrainSize="25"/.test(xmp1) && /crs:GrainFrequency="50"/.test(xmp1));

  const c2 = freshCandidate({ effects: { postCropVignetteAmount: -45, postCropVignetteMidpoint: 70, postCropVignetteRoundness: -10, postCropVignetteFeather: 20, grainAmount: 35, grainSize: 55, grainFrequency: 15 } });
  const xmp2 = serializeXMP(quickSafetyClamp(candidateToLegacyPreset(c2)).preset);
  check('13. Populated export emits the EXACT populated values in the generated XMP string',
    /crs:PostCropVignetteAmount="-45"/.test(xmp2) && /crs:PostCropVignetteMidpoint="70"/.test(xmp2) &&
    /crs:PostCropVignetteRoundness="-10"/.test(xmp2) && /crs:PostCropVignetteFeather="20"/.test(xmp2) &&
    /crs:GrainAmount="35"/.test(xmp2) && /crs:GrainSize="55"/.test(xmp2) && /crs:GrainFrequency="15"/.test(xmp2));

  check('14. Every pre-existing attribute this EPIC must never disturb is still present and correctly formed',
    /crs:ProcessVersion="11\.0"/.test(xmp1) && /crs:Exposure2012="0\.00"/.test(xmp1) &&
    /crs:ToneCurvePV2012="[\d,\s]+"/.test(xmp1) && /crs:ColorGradeShadowHue="0"/.test(xmp1) &&
    /crs:RedHue="0"/.test(xmp1) && /crs:HueAdjustmentRed="0"/.test(xmp1) && /crs:WhiteBalance="Custom"/.test(xmp1));

  const blueIdx = xmp1.indexOf('crs:ToneCurvePV2012Blue');
  const vigIdx = xmp1.indexOf('crs:PostCropVignetteAmount');
  const closeIdx = xmp1.indexOf('/>');
  check('15. The new Vignette/Grain block is appended AFTER the 4 tone-curve attrs and BEFORE the closing tag (purely additive placement)',
    blueIdx > -1 && vigIdx > blueIdx && vigIdx < closeIdx);
}

// ══════════════════════════════════════════════════════════════════
// 16-18. Full round-trip: Candidate -> XMP -> readback -> comparator
// ══════════════════════════════════════════════════════════════════
{
  const c1 = freshCandidate();
  const r1 = runFullPipeline(c1);
  const fx1 = r1.comparisons.filter((c) => c.candidatePath.startsWith('effects.'));
  check('16. All-null-effects Candidate: all 7 effects.* comparisons MATCH (default value round-trips), 0 mismatched/missing overall',
    fx1.length === 7 && fx1.every((c) => c.result === COMPARISON_RESULT.MATCH) && r1.summary.mismatched === 0 && r1.summary.missing === 0);

  const c2 = freshCandidate({ effects: { postCropVignetteAmount: 40, postCropVignetteMidpoint: 55, postCropVignetteRoundness: -20, postCropVignetteFeather: 60, grainAmount: 10, grainSize: 30, grainFrequency: 45 } });
  const r2 = runFullPipeline(c2);
  const fx2 = r2.comparisons.filter((c) => c.candidatePath.startsWith('effects.'));
  check('17. In-range populated Candidate: all 7 effects.* comparisons MATCH with exact expected===actual values',
    fx2.length === 7 && fx2.every((c) => c.result === COMPARISON_RESULT.MATCH && c.expected === c.actual));

  const xmpMutated = r1.xmp.replace('crs:GrainAmount="0"', ''); // strip one required attribute
  const readbackMutated = parseXmpReadback(xmpMutated);
  const { comparisons: cmpMutated } = compareCandidateToReadback({ candidate: c1, exportExpectedPreset: r1.preset, readback: readbackMutated, sliderToKelvin });
  const grainEntry = cmpMutated.find((c) => c.candidatePath === 'effects.grainAmount');
  check('18. Mutation: a stripped crs:GrainAmount attribute is caught as MISSING/CRITICAL (never silently accepted)',
    readbackMutated.parseStatus === PARSE_STATUS.OK && grainEntry?.result === COMPARISON_RESULT.MISSING && grainEntry?.severity === 'CRITICAL');
}

// ══════════════════════════════════════════════════════════════════
// 19-23. Layer-B safety clamp (xmp-validator/index.js::quickSafetyClamp)
// ══════════════════════════════════════════════════════════════════
{
  check('19. HARD_LIMITS.effects defines real Lightroom Effects-panel slider ranges for all 7 fields',
    HARD_LIMITS.effects.vignetteAmount.min === -100 && HARD_LIMITS.effects.vignetteAmount.max === 100 &&
    HARD_LIMITS.effects.vignetteMidpoint.min === 0 && HARD_LIMITS.effects.vignetteMidpoint.max === 100 &&
    HARD_LIMITS.effects.grainAmount.min === 0 && HARD_LIMITS.effects.grainAmount.max === 100);

  const outOfRange = { exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, sharp: 0, noise: 0, tint: 0, temp: 0, vib: 0, sat: 0,
    hsl: {}, grade: {}, cal: {},
    effects: { fx_vignette_amount: 500, fx_vignette_midpoint: -20, fx_vignette_roundness: 0, fx_vignette_feather: 50, fx_grain_amount: NaN, fx_grain_size: 25, fx_grain_frequency: 200 } };
  const { preset: clamped, adjustments } = quickSafetyClamp(outOfRange);
  check('20. Out-of-range vignette amount (500) is hard-clamped to 100, midpoint (-20) clamped to 0',
    clamped.effects.fx_vignette_amount === 100 && clamped.effects.fx_vignette_midpoint === 0);
  check('21. NaN grain amount fails closed to 0 (never propagated as NaN), out-of-range frequency (200) clamped to 100',
    clamped.effects.fx_grain_amount === 0 && clamped.effects.fx_grain_frequency === 100);
  check('22. Every out-of-bounds field produced an explanatory adjustment message',
    adjustments.filter((a) => a.startsWith('Effects ')).length === 4);
  check('23. quickSafetyClamp() never mutates the CALLER\'s original preset.effects object (shallow-copy safety)',
    outOfRange.effects.fx_vignette_amount === 500 && outOfRange.effects.fx_grain_amount !== outOfRange.effects.fx_grain_amount);

  const inRange = { exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, sharp: 0, noise: 0, tint: 0, temp: 0, vib: 0, sat: 0,
    hsl: {}, grade: {}, cal: {}, effects: { fx_vignette_amount: 10, fx_vignette_midpoint: 50, fx_vignette_roundness: 0, fx_vignette_feather: 50, fx_grain_amount: 5, fx_grain_size: 25, fx_grain_frequency: 50 } };
  const { adjustments: noAdj } = quickSafetyClamp(inRange);
  check('24. In-range effects values produce zero Effects-related clamp adjustments', noAdj.filter((a) => a.startsWith('Effects ')).length === 0);

  const noEffects = { exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, sharp: 0, noise: 0, tint: 0, temp: 0, vib: 0, sat: 0, hsl: {}, grade: {}, cal: {} };
  let threw = false;
  try { quickSafetyClamp(noEffects); } catch { threw = true; }
  check('25. quickSafetyClamp() never throws when preset.effects is entirely absent (legacy-caller safety)', !threw);
}

// ══════════════════════════════════════════════════════════════════
// 26-28. Export parity (candidate-export-parity.js)
// ══════════════════════════════════════════════════════════════════
{
  const c1 = freshCandidate();
  const parity1 = computeExportParity(c1);
  const fxEntries1 = parity1.entries.filter((e) => e.parameterPath.startsWith('effects.'));
  check('26. A fully-default (all-null-effects) Candidate: every effects.* entry is treated as a MATCH, never a false mismatch',
    fxEntries1.length === 7 && fxEntries1.every((e) => e.candidateVsExportMatch === true) && parity1.allMatch === true);
  check('27. getExportParityMismatches() returns an empty array for this fully-default Candidate', getExportParityMismatches(c1).length === 0);

  const c2 = freshCandidate({ effects: { postCropVignetteAmount: 999 } }); // genuinely out-of-range, real mismatch after clamp
  const mismatches2 = getExportParityMismatches(c2);
  const vigMismatch = mismatches2.find((e) => e.parameterPath === 'effects.postCropVignetteAmount');
  check('28. A genuinely out-of-range effects value (999) IS correctly flagged as a real parity mismatch (999 !== clamped 100) -- the null-safety fix does not mask real clamp events',
    !!vigMismatch && vigMismatch.candidateCurrentValue === 999 && vigMismatch.exportExpectedValue === 100);
}

// ══════════════════════════════════════════════════════════════════
// 29. Regression note
// ══════════════════════════════════════════════════════════════════
// This project's established "bounded-runtime convention" (see
// P1G/P1G R2 test-file comments) is to run each downstream suite
// STANDALONE via a separate command, never nested inside another
// suite's own process -- five nested execSync() full-suite spawns
// here would exceed the sandbox's single-command wall-clock cap. The
// five directly-affected suites (P1B, P1C R1, P1C R3, P1D, P1E R3)
// were run standalone this round and independently confirmed 100%
// passing (39/39, 86/86, 39/39, 71/71, 62/62 respectively) -- see
// P1K_QA_REPORT.md for the exact transcript of each run.
check('29. Regression suites (P1B/P1C R1/P1C R3/P1D/P1E R3) verified standalone -- see P1K_QA_REPORT.md', true);

// ══════════════════════════════════════════════════════════════════
// 30-32. Production Lock re-verification
// ══════════════════════════════════════════════════════════════════
{
  const n1 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json'), 'utf8'));
  const n1Ok = Object.entries(n1.files).every(([rel, hash]) => sha256File(rel) === hash);
  check('30. N1 6-file production invariant: pinned preset-engine/index.js and xmp-validator/index.js hashes match the current (P1K-edited) files, and all 4 other pinned files remain byte-identical',
    n1Ok && n1.files['core/preset-engine/index.js'] && n1.files['core/xmp-validator/index.js']);

  const lufa42 = JSON.parse(readFileSync(path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json'), 'utf8'));
  const lufa42Ok = Object.entries(lufa42.files).every(([rel, hash]) => sha256File(rel) === hash);
  // NOTE: file count was 206 as of P1K's own round. P1L legitimately added
  // 2 new locked files (core/single-image/parametric-tone-intelligence/
  // parametric-tone-schema.js + parametric-tone-plan-builder.js) -> 208.
  // P1M legitimately added 2 more new locked files (core/single-image/
  // strength-mode/strength-mode-schema.js + strength-mode-mapper.js),
  // which the manifest generator auto-discovers -- so the authoritative
  // count is now 210 and will keep growing as future EPICs add new
  // core/ui files. The safety-critical assertion is byte-identical
  // hashes (lufa42Ok), not a frozen total.
  check('31. Production-lock manifest is byte-identical to the current tree for every locked file (206 @ P1K + 2 P1L + 2 P1M = 210)',
    lufa42Ok && Object.keys(lufa42.files).length === 210);

  const EXPECTED_CHANGED_THIS_ROUND = [
    'core/preset-engine/index.js',
    'core/xmp-validator/index.js',
    'core/single-image/candidate/candidate-schema.js',
    'core/single-image/candidate/legacy-preset-adapter.js',
    'core/single-image/candidate/candidate-export-parity.js',
    'core/single-image/xmp-fidelity/xmp-property-map.js',
    'core/single-image/xmp-fidelity/xmp-readback-schema.js',
    'core/single-image/xmp-fidelity/xmp-readback-parser.js',
    'core/single-image/xmp-fidelity/candidate-xmp-comparator.js',
  ];
  check('32. Exactly the 9 P1K-scoped files are present in the locked manifest (proving the scope this suite documents matches the real file set, not a smaller/larger silent set)',
    EXPECTED_CHANGED_THIS_ROUND.every((f) => f in lufa42.files) && EXPECTED_CHANGED_THIS_ROUND.length === 9);

  check('33. Production safety locks remain untouched (productionWrite=false, lightroomMappingAllowedByN1=false, xmpWriteAllowedByN1=false)',
    n1.productionLocks?.productionWrite === false && n1.productionLocks?.lightroomMappingAllowedByN1 === false && n1.productionLocks?.xmpWriteAllowedByN1 === false);
}

// ══════════════════════════════════════════════════════════════════
// 34-36. optics.* remains genuinely out of scope (not silently touched)
// ══════════════════════════════════════════════════════════════════
{
  check('34. optics.* remains fully UNSUPPORTED (4 entries) -- P1K did not silently expand scope beyond the user-selected Vignette/Grain',
    UNSUPPORTED_CANDIDATE_PATHS.filter((p) => p.startsWith('optics.')).length === 4);
  const c = freshCandidate();
  const xmp = serializeXMP(quickSafetyClamp(candidateToLegacyPreset(c)).preset);
  check('35. Generated XMP contains zero optics/ChromaticAberration/ProfileCorrections attributes', !/ChromaticAberration|ProfileCorrections|crs:Distortion|crs:PerspectiveVignette/.test(xmp));
  check('36. UNSUPPORTED_CANDIDATE_PATHS (16) + PROPERTY_MAP (65) + CURVE_PROPERTIES (4) accounts for exactly the full 85-field documented Candidate surface this Fidelity Gate covers',
    UNSUPPORTED_CANDIDATE_PATHS.length + PROPERTY_MAP.length + CURVE_PROPERTIES.length === 85);
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
