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
  allowLegacySafetyOverlay: false,     // DEPRECATED/ALIAS: an early EPIC 2E-A placeholder, superseded by
                                        // `enableLegacySafetyOverlay` (added in EPIC 2E-B) as the canonical
                                        // flag. Confirmed unused anywhere in this codebase (grep-verified) —
                                        // kept only so nothing that might reference it by name breaks. Do not
                                        // add new logic that reads this key; read `enableLegacySafetyOverlay` instead.

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

  // ── EPIC 2E-C: Overlay Preview / Controlled Overlay Simulation flags ───
  // The simulation answers "if the overlay WERE allowed to act, what
  // would it recommend?" — a pure report/preview layer. Report-only
  // flags default TRUE because report output can never touch XMP or
  // mutate the legacy preset; production-impacting flags still default
  // false, same discipline as every other EPIC 2E flag set.
  enableLegacyOverlaySimulation: true,        // safe to default on — simulation never touches production by itself
  allowOverlaySimulationReport: true,         // report-only output is always safe
  allowOverlaySimulationProductionWrite: false, // simulation must never write production output
  allowOverlaySimulationPresetMutation: false,  // simulation must never mutate the legacy preset object
  requireLegacyOverlayForSimulation: true,
  requireSafetyClampForSimulation: true,
  requireControlledActivationGateForSimulation: true,
  minSimulationConfidence: 0.6,
  minSimulationSafetyScore: 0.65,

  // ── EPIC 2E-D: Controlled Overlay Test Gate flags ───────────────────────
  // Answers "is the overlay simulation safe enough to enter a controlled
  // test mode?" — NOT production activation. Gate/report flags may
  // default true (evaluating readiness is always safe); every flag that
  // could let overlay output reach a preset preview or production write
  // defaults false, same discipline as every other EPIC 2E flag set.
  enableControlledOverlayTestGate: true,       // safe to default on — evaluating the gate never touches production by itself
  allowControlledOverlayTest: false,           // whether a controlled test may actually run — never by default
  allowOverlayTestPresetPreview: false,        // whether overlay output may be previewed as a preset — never by default
  allowOverlayTestProductionWrite: false,      // whether a test may write production output — never by default, not even in a "test"
  requireOverlaySimulationForTest: true,
  requireLegacySafetyOverlayForTest: true,
  requireSafetyClampForTest: true,
  requireShadowCompareForTest: true,
  requireHumanReviewForOverlayTest: true,      // a human sign-off gate that nothing in this codebase can satisfy automatically
  requireNoHardStopsForOverlayTest: true,
  requireNoCriticalOverstackForOverlayTest: true,
  minOverlayTestConfidence: 0.72,
  minOverlayTestSafetyScore: 0.75,
  minOverlaySimulationConfidence: 0.6,
  minOverlaySimulationSafetyScore: 0.65,

  // ── EPIC 2E-E: Controlled Overlay Preview Sandbox flags ─────────────────
  // Answers "if we previewed the overlay safely, what abstract preset
  // changes would be simulated?" — a separate, non-production preview
  // object. Report/sandbox-object flags may default true (building an
  // abstract preview object never touches production by itself); every
  // flag that could let preview output reach real XMP, production
  // output, or the legacy preset object defaults false.
  enableControlledOverlayPreviewSandbox: true,   // safe to default on — building the sandbox object never touches production by itself
  allowOverlayPreviewSandboxReport: true,        // report-only output is always safe
  allowOverlayPreviewPresetObject: true,         // building an abstract, non-production preview object is always safe
  allowOverlayPreviewXMPExport: false,           // exporting the preview as real XMP — never by default
  allowOverlayPreviewProductionWrite: false,     // writing preview output to production — never by default
  allowOverlayPreviewPresetMutation: false,      // mutating the legacy preset object — never, under any flag
  requireControlledOverlayTestGateForPreview: true,
  requireOverlaySimulationForPreview: true,
  requireLegacySafetyOverlayForPreview: true,
  requireSafetyClampForPreview: true,
  requireNoHardStopsForPreview: true,
  requireNoCriticalOverstackForPreview: true,
  minPreviewSandboxConfidence: 0.68,
  minPreviewSandboxSafetyScore: 0.7,
  maxPreviewRiskLevel: 'medium',
};
