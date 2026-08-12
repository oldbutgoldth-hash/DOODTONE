# EPIC 2E-P1L — Known Limitations

- **Calibration is heuristic, not empirically tuned.** `PIXEL_TO_SLIDER_SCALE
  = 1.2` was derived by tracing the master curve engine's own internal clamp
  ranges, not from a labelled dataset of "correct" Parametric slider values.
  It is a reasoned default consistent with the project's existing
  calibration conventions elsewhere (see e.g. P1E/P1F/P1G plan-builders),
  not a claim of empirical optimality.
- **Three-point sampling only.** The plan builder reads the master curve's
  deviation at exactly x=64/128/192 (the curve's own named shadow/midtone/
  highlight anchors). It does not attempt sub-anchor interpolation or use
  the full 5-point curve shape beyond those three points.
- **No independent Parametric-specific confidence.** Engagement gating reuses
  `toneCurves.confidence` (P1J's own confidence score) rather than computing
  a Parametric-specific confidence metric. This mirrors the existing
  reuse-first pattern (P1L does not invent a second, possibly-disagreeing
  confidence signal) but means Parametric-panel confidence is not currently
  independently distinguishable from Tone Curve panel confidence.
- **Strength mode is not yet user-selectable.** `candidate-builder.js`
  currently always passes `DEFAULT_STRENGTH_MODE` (BALANCED) — the schema
  supports NATURAL/BALANCED/DRAMATIC scaling and the plan-builder correctly
  applies whichever mode it's given, but no UI control exists yet to let the
  user choose. This is explicitly EPIC 2E-P1M's scope (Strength-mode UI),
  not a P1L defect.
- **Advanced Diagnostics text fix (in-scope, not a new UI section).** The
  pre-existing `toneCurveIntelParametricNote` element (part of P1J's Tone
  Curve Intelligence diagnostics panel) previously always displayed a
  static "Parametric fields are not driven by this Intelligence layer"
  message. Since P1L makes that claim false, `renderToneCurveIntelligenceDiagnostics()`
  in `ui/app.js` was updated to branch on `candidate.diagnostics.parametricToneIntelligence.engaged`
  and show either the real derived Shadows/Midtones/Highlights values or an
  honest "did not adjust this photo" message. Two new i18n keys
  (`toneCurveParametricEngaged`, `toneCurveParametricNotEngaged`) were added
  in both `en.js`/`th.js`; the old `toneCurveParametricUnsupported` key was
  left in place (unused) rather than deleted, per this project's
  additive-only-changes convention. No new standalone diagnostics section
  was built for P1L — it reuses P1J's existing panel.
- **Browser/visual QA not executed this round** (consistent with every prior
  EPIC in this project's history when Chromium/Playwright are unavailable in
  the sandbox) — verification here is Node-level: unit tests, full
  round-trip export-fidelity tests, and direct isolated-script verification
  of the plan-builder's core math. No screenshot-level UI confirmation that
  the Advanced Diagnostics panel renders the new
  `parametricToneIntelligence` diagnostics block was performed.
