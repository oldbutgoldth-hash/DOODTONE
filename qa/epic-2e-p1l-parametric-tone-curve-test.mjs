#!/usr/bin/env node
/**
 * EPIC 2E-P1L — Parametric Tone Curve Intelligence: real integration test.
 *
 * Run: node qa/epic-2e-p1l-parametric-tone-curve-test.mjs
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

const { buildParametricTonePlan } = await import('../core/single-image/parametric-tone-intelligence/parametric-tone-plan-builder.js');
const { PARAMETRIC_TONE_SCHEMA_VERSION, MAX_PARAMETRIC_DEVIATION, MIN_ENGAGEMENT_CONFIDENCE, buildEmptyParametricTonePlan } = await import('../core/single-image/parametric-tone-intelligence/parametric-tone-schema.js');
const { createEmptyCandidate } = await import('../core/single-image/candidate/candidate-schema.js');
const { candidateToLegacyPreset } = await import('../core/single-image/candidate/legacy-preset-adapter.js');
const { serializeXMP } = await import('../core/preset-engine/index.js');
const { quickSafetyClamp, HARD_LIMITS } = await import('../core/xmp-validator/index.js');
const { sliderToKelvin } = await import('../core/whitebalance-engine/index.js');
const { parseXmpReadback } = await import('../core/single-image/xmp-fidelity/xmp-readback-parser.js');
const { compareCandidateToReadback, COMPARISON_RESULT } = await import('../core/single-image/xmp-fidelity/candidate-xmp-comparator.js');

function sha256File(relPath) { return createHash('sha256').update(readFileSync(path.join(ROOT, relPath))).digest('hex'); }

function evidenceFor(points, { confidence = 0.7, category = 'Wedding', warnings = [] } = {}) {
  return { toneCurves: { status: 'COMPLETED', result: { confidence, category, master: { points, reason: 'test' }, warnings } } };
}
const LIFTED_SHADOWS_ROLLED_HIGHLIGHTS = [{ x: 0, y: 12 }, { x: 64, y: 80 }, { x: 128, y: 135 }, { x: 192, y: 180 }, { x: 255, y: 248 }];
const IDENTITY_CURVE = [{ x: 0, y: 0 }, { x: 64, y: 64 }, { x: 128, y: 128 }, { x: 192, y: 192 }, { x: 255, y: 255 }];

// ══════════════════════════════════════════════════════════════════
// 1-4. Schema + empty-plan fallback
// ══════════════════════════════════════════════════════════════════
{
  const empty = buildEmptyParametricTonePlan();
  check('1. Empty plan defaults finalValues to {0,0,0} (legitimate "no override", never a fabricated non-zero value)',
    empty.finalValues.shadows === 0 && empty.finalValues.midtones === 0 && empty.finalValues.highlights === 0);
  check('2. No evidence at all -> plan does not engage, returns the empty-plan defaults', !buildParametricTonePlan({}).diagnostics.engaged);
  check('3. Evidence present but below the engagement-confidence floor -> plan does not engage',
    !buildParametricTonePlan(evidenceFor(LIFTED_SHADOWS_ROLLED_HIGHLIGHTS, { confidence: MIN_ENGAGEMENT_CONFIDENCE - 0.01 }), {}).diagnostics.engaged);
  check('4. Missing/invalid master.points -> plan does not engage, does not throw',
    !buildParametricTonePlan({ toneCurves: { status: 'COMPLETED', result: { confidence: 0.7, master: { points: null } } } }).diagnostics.engaged);
}

// ══════════════════════════════════════════════════════════════════
// 5-9. Real derivation from master curve deviation
// ══════════════════════════════════════════════════════════════════
{
  const plan = buildParametricTonePlan(evidenceFor(LIFTED_SHADOWS_ROLLED_HIGHLIGHTS), { strengthMode: 'BALANCED' });
  check('5. Engages when the master curve has real, non-identity deviation', plan.diagnostics.engaged === true);
  check('6. Shadows: positive (lifted) deviation at x=64 (80 vs identity 64) produces a positive slider value', plan.finalValues.shadows > 0);
  check('7. Midtones: positive deviation at x=128 (135 vs identity 128) produces a positive slider value', plan.finalValues.midtones > 0);
  check('8. Highlights: negative (rolled-off) deviation at x=192 (180 vs identity 192) produces a negative slider value', plan.finalValues.highlights < 0);
  check('9. An exact-identity master curve (no deviation anywhere) produces all-zero finalValues and does NOT engage',
    (() => { const p = buildParametricTonePlan(evidenceFor(IDENTITY_CURVE)); return p.finalValues.shadows === 0 && p.finalValues.midtones === 0 && p.finalValues.highlights === 0 && !p.diagnostics.engaged; })());
}

// ══════════════════════════════════════════════════════════════════
// 10-12. Layer-A bound + strength-mode scaling
// ══════════════════════════════════════════════════════════════════
{
  const EXTREME = [{ x: 0, y: 0 }, { x: 64, y: 200 }, { x: 128, y: 128 }, { x: 192, y: 192 }, { x: 255, y: 255 }]; // absurd +136px deviation
  const plan = buildParametricTonePlan(evidenceFor(EXTREME));
  check('10. An absurd/adversarial deviation is restrained to the Layer-A ceiling, never propagated raw', Math.abs(plan.finalValues.shadows) <= MAX_PARAMETRIC_DEVIATION && plan.diagnostics.deviationsRestrained >= 1);

  const natural = buildParametricTonePlan(evidenceFor(LIFTED_SHADOWS_ROLLED_HIGHLIGHTS), { strengthMode: 'NATURAL' });
  const balanced = buildParametricTonePlan(evidenceFor(LIFTED_SHADOWS_ROLLED_HIGHLIGHTS), { strengthMode: 'BALANCED' });
  const dramatic = buildParametricTonePlan(evidenceFor(LIFTED_SHADOWS_ROLLED_HIGHLIGHTS), { strengthMode: 'DRAMATIC' });
  check('11. Strength modes scale monotonically: NATURAL <= BALANCED <= DRAMATIC in magnitude', Math.abs(natural.finalValues.shadows) <= Math.abs(balanced.finalValues.shadows) && Math.abs(balanced.finalValues.shadows) <= Math.abs(dramatic.finalValues.shadows));
  check('12. schemaVersion is the correct, stable P1L version string', natural.schemaVersion === PARAMETRIC_TONE_SCHEMA_VERSION);
}

// ══════════════════════════════════════════════════════════════════
// 13-16. Layer-B safety clamp (xmp-validator/index.js)
// ══════════════════════════════════════════════════════════════════
{
  check('13. HARD_LIMITS.parametricCurve defines a real, symmetric export-safe range for all 3 fields',
    HARD_LIMITS.parametricCurve.shadows.min === -60 && HARD_LIMITS.parametricCurve.shadows.max === 60 &&
    HARD_LIMITS.parametricCurve.midtones.min === -60 && HARD_LIMITS.parametricCurve.highlights.max === 60);

  const outOfRange = { exp:0,con:0,hi:0,sh:0,wh:0,bl:0,sharp:0,noise:0,tint:0,temp:0,vib:0,sat:0, hsl:{}, grade:{}, cal:{}, crv_sh: 999, crv_mid: NaN, crv_hi: -20 };
  const { preset: clamped, adjustments } = quickSafetyClamp(outOfRange);
  check('14. Out-of-range crv_sh (999) is hard-clamped to 60; NaN crv_mid fails closed to 0; in-range crv_hi (-20) untouched',
    clamped.crv_sh === 60 && clamped.crv_mid === 0 && clamped.crv_hi === -20);
  check('15. quickSafetyClamp() never mutates the caller\'s original preset for crv_sh/crv_mid/crv_hi', outOfRange.crv_sh === 999 && outOfRange.crv_mid !== outOfRange.crv_mid);
  check('16. Every out-of-bounds parametric field produced an explanatory adjustment message', adjustments.filter((a) => a.startsWith('Parametric Tone Curve ')).length === 2);
}

// ══════════════════════════════════════════════════════════════════
// 17-20. Full round-trip: Candidate -> legacy preset -> clamp -> XMP -> readback -> compare
// ══════════════════════════════════════════════════════════════════
{
  const c = createEmptyCandidate({ sessionId: 's1', generationId: 1, candidateId: 'cand1' });
  c.curves.parametric = { shadows: 22, midtones: 9, highlights: -15 };
  const flat = candidateToLegacyPreset(c);
  check('17. legacy-preset-adapter forwards candidate.curves.parametric.* into crv_sh/crv_mid/crv_hi unchanged (pre-existing P1C wiring, unaffected by P1L)', flat.crv_sh === 22 && flat.crv_mid === 9 && flat.crv_hi === -15);

  const { preset } = quickSafetyClamp(flat);
  const xmp = serializeXMP(preset);
  check('18. Generated XMP contains the exact parametric values', /crs:ParametricShadows="22"/.test(xmp) && /crs:ParametricMidtones="9"/.test(xmp) && /crs:ParametricHighlights="-15"/.test(xmp));

  const readback = parseXmpReadback(xmp);
  const { comparisons } = compareCandidateToReadback({ candidate: c, exportExpectedPreset: preset, readback, sliderToKelvin });
  const shEntry = comparisons.find((e) => e.candidatePath === 'curves.parametric.shadows');
  const midEntry = comparisons.find((e) => e.candidatePath === 'curves.parametric.midtones');
  const hiEntry = comparisons.find((e) => e.candidatePath === 'curves.parametric.highlights');
  check('19. All 3 parametric fields MATCH through the P1D Fidelity Gate (pre-existing PROPERTY_MAP entries, no changes needed for P1L)',
    shEntry?.result === COMPARISON_RESULT.MATCH && midEntry?.result === COMPARISON_RESULT.MATCH && hiEntry?.result === COMPARISON_RESULT.MATCH);

  const c2 = createEmptyCandidate({ sessionId: 's2', generationId: 1, candidateId: 'cand2' });
  c2.curves.parametric = { shadows: 999, midtones: 0, highlights: 0 }; // genuinely out-of-range
  const flat2 = candidateToLegacyPreset(c2);
  const { preset: clamped2 } = quickSafetyClamp(flat2);
  const xmp2 = serializeXMP(clamped2);
  check('20. An out-of-range Candidate value IS clamped before export (60, not 999) -- Layer-B genuinely protects export', /crs:ParametricShadows="60"/.test(xmp2));
}

// ══════════════════════════════════════════════════════════════════
// 21. candidate-builder.js wiring
// ══════════════════════════════════════════════════════════════════
{
  const src = readFileSync(path.join(ROOT, 'core/single-image/candidate/candidate-builder.js'), 'utf8');
  check('21. candidate-builder.js imports and calls buildParametricTonePlan(), writes candidate.diagnostics.parametricToneIntelligence, and never touches curves.rgb/red/green/blue in that block',
    src.includes("buildParametricTonePlan(evidence") && src.includes('candidate.diagnostics.parametricToneIntelligence') &&
    !/parametricTonePlan[\s\S]{0,200}candidate\.curves\.(rgb|red|green|blue)/.test(src));
}

console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
