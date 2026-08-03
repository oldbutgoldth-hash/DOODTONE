/**
 * core/single-image/color-intelligence/color-intelligence-engine.js
 *
 * EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate.
 *
 * Main entry point, called ONCE by candidate-builder.js's
 * `buildCandidateFromSession()`, immediately after the pure reshape of
 * `candidateRaw` into `candidate.hsl` / `candidate.grading` /
 * `candidate.cal` / `candidate.basic.vibrance` /
 * `candidate.basic.saturation`, and BEFORE the lineage/autoValues
 * snapshot is taken (so "Reset to Auto" correctly reverts to the
 * enriched recommendation, not the pre-enrichment one -- the enriched
 * value IS the new "auto" recommendation).
 *
 * PURE function: no Session/DOM access, no localStorage, no network,
 * no Core analysis calls, no XMP knowledge. Mutates only the color
 * sub-objects of the `candidate` object it is given (the same object
 * candidate-builder.js is already building field-by-field) and
 * returns a diagnostics object for `candidate.diagnostics.colorIntelligence`.
 *
 * Never touches: candidate.whiteBalance, candidate.basic.exposure/
 * contrast/highlights/shadows/whites/blacks/texture/clarity/dehaze,
 * candidate.curves, candidate.grading.balance (documented UNSUPPORTED
 * field, P1D property map), candidate.cal.shadowTint (also
 * UNSUPPORTED), candidate.detail/effects/optics, candidate.profile.
 */

import { deriveColorSignals } from './evidence-color-signals.js';
import { buildColorPlan } from './color-plan-builder.js';
import { DEFAULT_STRENGTH_MODE, COLOR_INTELLIGENCE_SCHEMA_VERSION } from './color-intelligence-schema.js';

/**
 * @param {object} candidate  the in-progress Candidate object (mutated in place)
 * @param {object} evidence   session.evidence (read-only)
 * @param {{strengthMode?: string}} [opts]
 * @returns {{candidate: object, diagnostics: object}}
 */
export function applyColorIntelligence(candidate, evidence, { strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const startedAt = Date.now();
  const signals = deriveColorSignals(evidence ?? {});

  const candidateColorFields = {
    hsl: candidate.hsl,
    grading: candidate.grading,
    cal: candidate.cal,
    basic: { vibrance: candidate.basic.vibrance, saturation: candidate.basic.saturation },
  };

  const plan = buildColorPlan({ candidateColorFields, signals, strengthMode });

  // ── Apply the plan onto the Candidate's color fields ─────────────
  for (const ch of Object.keys(plan.hsl.hue)) {
    candidate.hsl.hue[ch] = plan.hsl.hue[ch];
    candidate.hsl.saturation[ch] = plan.hsl.saturation[ch];
    candidate.hsl.luminance[ch] = plan.hsl.luminance[ch];
  }
  for (const zone of ['shadows', 'midtones', 'highlights']) {
    if (!plan.grading[zone]) continue;
    candidate.grading[zone].hue = plan.grading[zone].hue;
    candidate.grading[zone].saturation = plan.grading[zone].saturation;
    candidate.grading[zone].luminance = plan.grading[zone].luminance;
    // grading.balance is intentionally never written by P1E -- it is
    // a documented UNSUPPORTED field (P1D_XMP_PROPERTY_MAP.md); the
    // schema keeps it structurally present but always null/untouched.
  }
  for (const key of ['redPrimaryHue', 'redPrimarySaturation', 'greenPrimaryHue', 'greenPrimarySaturation', 'bluePrimaryHue', 'bluePrimarySaturation']) {
    candidate.cal[key] = plan.cal[key];
  }
  // cal.shadowTint is intentionally never written by P1E (documented
  // UNSUPPORTED field, same reason as grading.balance above).
  candidate.basic.vibrance = plan.presence.vibrance;
  candidate.basic.saturation = plan.presence.saturation;

  const diagnostics = {
    schemaVersion: COLOR_INTELLIGENCE_SCHEMA_VERSION,
    strengthMode,
    engaged: plan.engaged,
    fieldsBoosted: plan.fieldsBoosted,
    skinProtection: plan.skinProtection,
    reasons: plan.reasons,
    durationMs: Date.now() - startedAt,
  };

  return { candidate, diagnostics };
}
