/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LIGHTROOM MAPPING V2 — FEATURE FLAGS (EPIC 2E-A)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for every flag that gates whether Lightroom
 * Mapping V2 is allowed to influence production output. Every
 * production-impacting flag below defaults to `false` (or a
 * conservative threshold) so that, unmodified, this file keeps legacy
 * Lightroom Mapping as the exclusive path to XMP export — exactly as
 * required by EPIC 2E-A's "default answer must be No" goal.
 *
 * Nothing in this project currently sets these flags to anything other
 * than their defaults — there is no UI, no environment variable, no
 * config file wiring them to `true`. Changing production behavior would
 * require a deliberate future code change to this file (or an explicit
 * override object passed into `buildLightroomControlledActivationV2`),
 * never an accidental one.
 */

export const LIGHTROOM_MAPPING_V2_FLAGS = {
  // ── Production-impacting flags — ALL default false ──────────────────────
  enableControlledActivation: false,   // master switch; false = V2 can never influence output
  allowProductionOverride: false,      // even if eligible, production must still be explicitly allowed
  allowLegacySafetyOverlay: false,     // whether V2's safety layer may overlay (not replace) legacy output — unused while V2 is inactive

  // ── Requirement flags — default to the SAFEST (most demanding) setting ──
  requireShadowCompare: true,          // a Shadow Compare Report must exist before V2 is even considered
  requireLegacyMappingAvailable: true, // legacy output must be available for a real comparison
  requireNoHardStops: true,            // any active hard stop blocks eligibility outright
  requireNoCriticalOverstack: true,    // critical over-stack severity blocks eligibility outright
  requireHumanReview: true,            // a human sign-off gate that nothing in this codebase can satisfy automatically

  // ── Thresholds — conservative defaults, not yet validated against real data ──
  minGlobalSafetyScore: 0.75,
  minShadowAlignment: 0.65,
  minActivationConfidence: 0.72,
  maxAllowedOverStackSeverity: 'medium',

  // ── EPIC 2E-B: Legacy Safety Overlay flags ──────────────────────────────
  // The overlay lets V2's safety intelligence advise/guardrail the ACTIVE
  // legacy mapping without replacing it. Production-impacting flags default
  // false; the one warnings-only flag defaults true because report-only
  // output can never touch XMP. Default state = overlay produces advice
  // only, never a production clamp.
  enableLegacySafetyOverlay: false,          // master switch for the overlay layer
  allowLegacyOverlayProductionClamp: false,  // whether the overlay may actually clamp production output (never, by default)
  allowLegacyOverlayWarningsOnly: true,      // report-only advice is always safe — cannot touch XMP
  requireActivationGateForOverlay: true,     // overlay needs the activation gate to exist and have selected legacy
  requireNoHardStopsForOverlay: true,        // any hard stop blocks a production clamp
  requireNoCriticalOverstackForOverlay: true,// critical over-stack blocks a production clamp
  minOverlaySafetyScore: 0.72,
  minOverlayConfidence: 0.68,
};
