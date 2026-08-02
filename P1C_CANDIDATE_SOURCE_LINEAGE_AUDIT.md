# EPIC 2E-P1C — Candidate Source & Lineage Audit

Repository audit performed against the P1B R1 baseline (verified via
`P1B_RELEASE_NOTES.md`/`P1B_QA_REPORT.md`) before any P1C implementation.
Every function/file/line below was located by direct search of the real
Production source — nothing here is assumed from the spec.

## 1. Functions that build Lightroom values

- `core/decision-engine/index.js` — `buildFinalPreset(inputs)` (line 146).
  The single real entry point that turns all analysis evidence into a
  flat Lightroom preset object (`temp`, `tint`, `exp`, `con`, `hi`, `sh`,
  `wh`, `bl`, `clarity`, `dehaze`, `texture`, `vib`, `sat`, `sharp`,
  `noise`, `crv_hi`/`crv_mid`/`crv_sh`, `hsl{}`, `grade{}`, `cal{}`,
  `curves{}`), plus a `_decision` diagnostic object. Internally delegates
  to `core/lightroom-mapping-engine`. **P1C does not call, wrap, or
  modify this function** — the Candidate Builder consumes its already-
  computed output only.
- `core/preset-engine/index.js` — `buildPreset(stats)` (line ~55): a
  legacy single-pass fallback, not used by the live single-image
  pipeline. Left untouched.

## 2. Writes into Lightroom slider DOM elements

- `ui/app.js` — `applyPresetToSliders(preset)` (line 3087): the only
  function that writes preset values into slider DOM elements, via
  `setSlider(id, val)` (`ui/ui-engine.js:24`) for every supported
  parameter ID. Called once per completed analysis, right after
  `singleImageOrchestrator.commitCandidate(...)`.
- Static sliders (`exp,con,hi,sh,wh,bl,temp,tint,vib,sat,sharp,noise,
  clarity,dehaze,texture`) exist in `index.html` with real `min`/`max`
  attributes (see §12). `crv_hi`/`crv_mid`/`crv_sh` are hidden inputs
  (`index.html:702-704`, defaults 15/10/5, not directly user-draggable
  in the current UI).
- HSL (`hsl_h/s/l_<channel>` × 8 channels), Color Grading
  (`grd_<zone>_h/s/l` × 3 zones + `grd_blend`), and Calibration
  (`cal_<primary>_h/s` × 3 primaries) sliders are generated at runtime
  by `ui/ui-engine.js`'s `renderHSLPanel`, `renderGradingPanel`,
  `renderCalibrationPanel`, called once at boot (`ui/app.js:679-681`,
  inside `waitForRoot()`) — **not** re-rendered on language change or
  panel switch, so these elements are created exactly once per page
  load.

## 3. Functions that read sliders

- `ui/app.js` — `readSlidersAsPreset()` (line 3282): the only function
  that reads every slider back into a flat preset object via a shared
  `gv(id)` helper (`parseInt(document.getElementById(id)?.value ?? 0,
  10)`). Also reads `state.curveEditor.getCurveSet()` for `curves`.

## 4. `readSlidersAsPreset()` callers

Exactly one real call site: `ui/app.js:3121`, inside `handleDownload()`
(the XMP export button handler). This is the single DOM-as-source-of-
truth path P1C must remove from the main export flow.

## 5. `quickSafetyClamp()` callers

- `ui/app.js:2548` — inside `runAnalysis()`, applied to the just-built
  `validatedPreset` only when `benchmark.details.extremelyUnsafe` is
  true (a reclamp of the **freshly analyzed** Candidate, not of DOM
  values).
- `ui/app.js:3123` — inside `handleDownload()`, applied to
  `readSlidersAsPreset()`'s output at export time (the DOM-as-source
  path P1C removes).
- Also called from `core/color-match/*` and `core/calibration-lab/*`
  (Reference Color Match / Calibration Lab pipelines) — unrelated,
  untouched by P1C.

## 6. Existing Candidate/preset-shaped mutable objects

- `core/single-image/single-image-session.js` already declares
  `session.candidate: null` (P1A) and a `validation: { candidateValid:
  false, ... }` sub-object.
- `core/single-image/single-image-orchestrator.js:307` —
  `commitCandidate(ticket, candidate)` (P1A): writes whatever object
  it's given directly into `s.candidate`. As shipped in P1B, `ui/app.js`
  calls this with the **flat legacy `finalPreset` object** (line 2563)
  — i.e. `session.candidate` currently holds the same flat shape
  `readSlidersAsPreset()`/`serializeXMP()` use, not a canonical nested
  contract. P1C repurposes this: the flat object becomes
  `session.candidateRaw` (new field, see §13) and `session.candidate`
  becomes the canonical nested Candidate.
- `core/single-image/single-image-analysis-profile.js` already declares
  a `decisionCandidate` profile entry (`evidenceKey: 'candidate'`,
  `sourceEngine: 'core/decision-engine/index.js'`, `sourceFunction:
  'buildFinalPreset'`) — confirms the module-ID/evidence-key/source-
  engine names used for Candidate lineage below.
- Confirmed via `grep` across `qa/*.mjs`: every other `.candidate`
  reference in the test suite belongs to the **unrelated** Reference
  Color Match pipeline (`core/color-match/*`'s own `pipeline.candidate`
  object, e.g. `qa/epic-2e-o3-o7-xmp-lineage-static-test.mjs`,
  `qa/epic-2e-n-core-color-match-browser-test.mjs`). No test asserts on
  `core/single-image` Session's `session.candidate` shape — confirming
  it is safe to change what that field holds.

## 7. XMP serialization entry point

`core/preset-engine/index.js` — `serializeXMP(p)` (line 104). Consumes
exactly: `p.exp, con, hi, sh, wh, bl, clarity, dehaze, texture, crv_sh,
crv_mid, crv_hi, sharp, noise, temp (via sliderToKelvin), tint, vib,
sat, grade.{grd_sh_h,grd_sh_s,grd_sh_l,grd_mid_h,grd_mid_s,grd_mid_l,
grd_hi_h,grd_hi_s,grd_hi_l,grd_blend}, cal.{cal_red_h,cal_red_s,
cal_green_h,cal_green_s,cal_blue_h,cal_blue_s}, hsl.{hsl_h/s/l_<ch>}
(8 channels), curves.{master,red,green,blue}`. `ColorNoiseReduction` is
hardcoded to `"25"` in the serializer itself (not a Candidate field).
`ProcessVersion` is hardcoded to `"11.0"`. **Untouched by P1C** — the
Legacy Preset Adapter's job is to produce exactly this input shape.

## 8. XMP download entry point

`core/preset-engine/index.js` — `downloadXMP(xmpString, fileName)` (line
~188). Called from `ui/app.js:3135` inside `handleDownload()`, after
`serializeXMP()`. Untouched.

## 9. Reset/new-upload behavior

`handleReset()` (`ui/app.js`, called unconditionally at the top of
`loadFile()` and by the Reset button) already calls
`singleImageOrchestrator.resetActiveSession(state)`, which nulls
`session.candidate` (P1A, `single-image-session.js:261`). P1C adds
explicit Candidate Store + slider-display clearing to the same function
(see `P1C_MODIFIED_FILES.md`).

## 10. Language/panel rerender behavior

`rerenderCurrentUiForLocale()` (`ui/app.js`) re-renders the P1B Report
from its stashed snapshot but does **not** call `renderHSLPanel`/
`renderGradingPanel`/`renderCalibrationPanel` or touch any slider value
— confirmed by grep of the function body. This means a language change
already cannot corrupt Candidate state; P1C's job is only to make sure
nothing added to this function ever calls Candidate build/analysis.

## 11. Preview logic reading slider values

No preview-rendering code (`ui/ui-engine.js`, the RCM preview pipeline)
reads the single-image sliders — Reference Color Match has its own,
fully separate preview/Candidate machinery in `core/color-match/*` and
is not wired to `exp`/`con`/etc. Confirmed isolated.

## 12. Current parameter ranges and conversions

Real, authoritative source: `core/xmp-validator/index.js`'s
`HARD_LIMITS` (exported, line 27) plus the DOM `min`/`max` attributes in
`index.html`/`ui/ui-engine.js`. Full detail in
`P1C_LIGHTROOM_PARAMETER_CONTRACT.md`. Summary:

| Group | Source of range |
|---|---|
| `exp,con,hi,sh,wh,bl` | `HARD_LIMITS.basic.*` (safety) + DOM `min`/`max` (UI) |
| `temp,tint` | `HARD_LIMITS.wb.*` (safety) + DOM `min`/`max` (UI) |
| `vib,sat` | `HARD_LIMITS.presence.*` (safety) + DOM `min`/`max` (UI) |
| `hsl_s_<ch>` | `HARD_LIMITS.hsl.*` (safety, skin vs. color channels differ) + DOM `min`/`max` |
| `hsl_h_<ch>,hsl_l_<ch>` | DOM `min`/`max` only (`-100..100`) — no HARD_LIMITS entry |
| `cal_<prim>_h/s` | `HARD_LIMITS.calibration.*` (safety) + DOM `min`/`max` (`-100..100`) |
| `grd_<zone>_h` | DOM `min`/`max` only (`0..360`) |
| `grd_<zone>_s` | DOM `min`/`max` only (`0..100`) |
| `grd_<zone>_l`, `grd_blend` | DOM `min`/`max` only (`-100..100` / `0..100`) |
| `clarity,dehaze,texture,sharp,noise` | DOM `min`/`max` only, no HARD_LIMITS entry |
| `crv_hi,crv_mid,crv_sh` | No DOM range (hidden input), no HARD_LIMITS entry — defaults 15/10/5 |
| `curves.{master,red,green,blue}` | Points clamped to `x,y ∈ [0,255]` by `core/curve-engine/index.js` |

No new limits are invented anywhere in P1C — every range in the
Candidate Validator is taken verbatim from one of these two real
sources.

## 13. Design decision this audit drives

Because `session.candidate` currently holds the **flat legacy preset**
(§6) and nothing outside `core/single-image/` reads that field back
(§6), P1C:

1. Renames the P1A write target inside `commitCandidate()` from
   `s.candidate` to `s.candidateRaw` (additive Session field — the raw
   `buildFinalPreset()` output, kept for the analysis cache and as the
   Candidate Builder's direct input).
2. Adds `buildAndCommitCandidate(ticket, {legacyState})` to the
   orchestrator, which reads `session.candidateRaw` (already-computed,
   never re-run) plus `session.evidence`, builds the canonical nested
   Candidate, validates it, and commits it to `session.candidate` —
   which is now exclusively the P1C canonical contract.
3. `ui/app.js` calls this immediately after the existing
   `commitCandidate()` call, then syncs sliders from the canonical
   Candidate (via the Legacy Preset Adapter + the existing, unmodified
   `applyPresetToSliders()` — see `P1C_SLIDER_MAPPING.md`) instead of
   from the raw `finalPreset` directly.

This is additive and does not change `writeCompletedEvidence()`'s cache
contract (it stores whatever is in `s.candidate`/now also
`s.candidateRaw` opaquely; nothing reads a cached candidate back for
reconstruction in the current codebase).
