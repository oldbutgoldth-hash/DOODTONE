# LUMIXA AI — Project Memory R5

## Release identity

- Workstream: EPIC 2E-J — Final Locale Closure + Semantic QA R5
- Release type: local-first source package
- Public deployment: not performed
- Public version label: unchanged
- Completion date: 2026-07-26

## Product state preserved

- Production output source remains `legacy`.
- Controlled Test remains disabled.
- Production write remains disabled.
- Preview export remains disabled.
- Production Mapping calculations are unchanged.
- XMP text is exactly unchanged across TH → EN → TH.
- Controlled V2 remains a browser-only comparison/observation surface.

## R5 implementation summary

1. Photographer-facing static text in the app shell, upload surface, Analysis controls, support panel, PromptPay/USDT dialogs, Review Console and footer now uses centralized EN/TH presentation keys.
2. Analysis-complete summaries and panel labels rerender from cached semantic values when the locale changes. Locale switching does not rerun Analysis or alter image pixels.
3. Known Data Comparison/Core values are projected through stable presentation IDs and codes. Raw Core prose is restricted to collapsed Developer Details; unknown values receive a bounded localized summary in the main UI.
4. Review, Build Controlled V2 and applicable Observation announcements retain semantic state as `{ code, params, category, generationId }`, then render for the current locale. Durable state no longer stores only a translated sentence.
5. Visual Preview exposes locale-neutral QA evidence, including translation mode, preview-honesty code, Production source and Production-write state.
6. Live App and Step 7B-B tests now read semantic QA snapshots and canonical reason codes rather than parsing localized English labels.
7. Full-system i18n QA uses 18 precise regions plus a whole-body aggregate safety net. Required visible regions fail closed when missing, unexecuted or empty.
8. Static QA now includes hostile checks that reject raw Core prose presentation outside Developer Details.
9. Browser execution and the local gate fail closed for unavailable, stale, malformed or failing required evidence.

## Final verified baseline

- ESM syntax: 149/149 PASS
- Focused Core: 31/31 PASS
- Static suites: PASS
- R5 semantic-presentation static suite: 13/13 PASS
- In-Memory startup: 22/22 PASS
- Upload baseline: 18/18 PASS
- Live App: 51/51 PASS
- Observation Smoke: 64/64 PASS
- Step 7B-A: 54/57 PASS, 0 FAIL, 3 NOT_APPLICABLE
- Step 7B-B: 183/184 PASS, 0 FAIL, 1 NOT_TESTED (Physical touch hardware only)
- Decoder geometry: 39/40 PASS, 0 FAIL, 1 NOT_APPLICABLE
- Full-app eligible geometry: 98/99 PASS, 0 FAIL, 1 NOT_APPLICABLE
- Controlled V2 Browser: 58/58 PASS
- Full-system i18n Browser: 74/74 PASS
- Local Gate: 13/13 required steps PASS with fresh evidence

## Locale and invariant baseline

- Required localized keys: 705
- Thai keys resolved: 705
- English fallbacks: 0
- Missing keys: 0
- Visible English leak count in Thai coverage report: 0
- Dictionary parity: EN 961 / TH 961
- Review Console Thai-mode leaks: 0
- Data Comparison Thai-mode leaks: 0
- App/Analysis Thai-mode leaks: 0
- English-mode stale Thai fragments: 0
- Whole-body aggregate leaks: 0
- Unresolved template tokens: 0
- TH → EN → TH bounded state changes: 0
- Page errors: 0
- Console errors: 0
- Unexpected in-memory network requests: 0

## Exact XMP invariant

- Before length: 2962
- After length: 2962
- Before SHA-256: `e233c999fb009133d8ee3e4d627e2f97c79e3ddd32144f42038a019004222923`
- After SHA-256: `e233c999fb009133d8ee3e4d627e2f97c79e3ddd32144f42038a019004222923`
- Exact text equality: PASS

## Next development boundary

R5 stops after locale closure and semantic QA. The next feature phase must preserve all Product locks and the verified R5 regression baseline above.

## EPIC 2E-K-R2-FIX4 — Preview Before Candidate Review

Controlled V2 Preview generation is now independent of Candidate Review approval. Preview generation is governed only by source, current generation, render-plan, safety, and pixel-evidence eligibility. Candidate Review begins pending and becomes available only after both Legacy and Controlled V2 canvases render. Approval affects Candidate Review only; Production stays Legacy and Production write/apply/export/XMP remain disabled. Real Chromium verification passed with exact XMP equality. Storage Node suites remain unverified in this environment because `fake-indexeddb` could not be installed.

## EPIC 2E-K-R2-FIX5 — Storage / Release Gate

FIX5 introduced a QA-only deterministic IndexedDB contract harness and a real Native Browser IndexedDB persistence suite. Storage Contract passes 24/24; full static suites and FIX4 Preview-before-review safety pass. Native Browser IndexedDB is `NOT_VERIFIED` in the current environment because Chromium is administratively blocked from opening the temporary localhost origin. The gate fails closed with exit code 2. No Production Mapping or XMP source changed. EPIC 2E-L remains blocked until the Windows/local runner returns `FINAL_PASS`.

---

## EPIC 2E-L — Controlled V2 Candidate Review Pilot (v1.3.0)

- FIX5.3 Release Gate was confirmed `FINAL_PASS` on Windows before this phase.
- Added Candidate Pilot mode to the existing Calibration Lab; no parallel Production workflow was created.
- Pilot cohort accepts only reviewed, browser-verified, pixel-evidence-eligible records.
- Added coverage, safety, low-confidence, regression, V2 net-advantage, and Wilson confidence gates.
- Strongest result is `PILOT_CANDIDATE_EVALUATION_READY`; `PRODUCTION_READY` does not exist.
- Candidate Pilot export contains semantic data/hashes only and refuses image/path/preset/XMP-shaped fields.
- Native Chromium Browser QA passed through an `about:blank` in-memory import-map runtime.
- EPIC 2E-L Release Gate: `FINAL_PASS`.
- Production remains Legacy; Production Mapping, preset engine, XMP validator, `ui/app.js`, and `ui/ui-engine.js` remain byte-for-byte unchanged from FIX5.3.

## EPIC 2E-M — Guided Candidate Cohort Intake (v1.3.1)

- Added a visible three-step review and Cohort save workflow.
- Save and Save-and-Next remain disabled until pixel evidence is eligible and a human decision is selected.
- Successful saves return semantic Cohort receipts and update Candidate Pilot progress automatically.
- Production remains Legacy; Production write, Controlled V2 Apply and Preview export remain disabled.
- Release gate: FINAL_PASS.

---

## EPIC 2E-N1 — Core Color Match Signature Engine (v1.4.0)

The project returned to its central objective: Reference image → Target image
comparison → Lightroom-compatible Color Match. N1 adds a deterministic shared
Signature Schema and semantic Delta Engine before any Lightroom Mapping. The
new layer is shadow-only and explicitly cannot write Production or XMP.

Key decision: values measured from the Reference must never be copied directly
to the Target. Later mapping must consume the **difference between comparable
signatures**, then apply photographic compensation for illuminant, object
colour, skin, dynamic range and style intent.

Next boundary: EPIC 2E-N2 may translate semantic delta evidence into bounded
Lightroom recommendations, but must not activate Production until Preview/XMP
fidelity and real-image Color Match improvement are proven.

## EPIC 2E-O — Target-aware Color Match & Lightroom Round-trip Fidelity
- Trigger: real wedding RAW test exposed excessive warmth/brightness when a warm dark portrait reference was transferred to a high-key target.
- Added target-aware high-key/neutral-white, skin, and scene-object transfer protection.
- Added RAW/rendered Lightroom compatibility profile and Lightroom-return import/evaluation workflow.
- Browser Preview is explicitly approximate and not an Adobe Camera Raw renderer.
- Real Lightroom-exported return image remains required before Reference Color Match Beta or Production.
- Production remains Legacy; Candidate XMP is in-memory only.
