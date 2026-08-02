# P1D — Modified Files

## R2 — additional changes (fixing 2 full-static-suite regressions)

- `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` — added
  `'renderXmpFidelityStatus'` to the reviewed pure-function allowlist
  used by the "every function called inside
  `rerenderCurrentUiForLocale()` is a known pure re-render" check,
  with a written justification. No other part of this test was
  changed; the detector logic itself was not weakened.
- `qa/i18n/visible-text-audit-allowlist.mjs` — added one entry to
  `FILE_ALLOWLIST['ui/app.js']` for the string `'hourglass_top'`
  (a Material Symbols icon glyph identifier set via
  `icon.textContent` inside `renderXmpFidelityStatus()`), with a
  written justification. Allowlist grew from 9 to 10 entries (bound:
  40). The detector's own matching logic in
  `qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs` was not
  changed.
- `package.json` — version `2.4.0` → `2.4.1`, description updated to
  note the static-suite regression fixes.
- `qa/baselines/p1d_r2_full_static_suite_results.txt` (new) —
  per-suite exit-code/timing evidence log from running all 67
  `qa/run-static-suites.mjs` suites individually in declared order
  (see `P1D_QA_REPORT.md` for methodology). Evidence artifact only;
  read by no test or production code.
- `P1D_QA_REPORT.md`, `P1D_MODIFIED_FILES.md`, `P1D_RELEASE_NOTES.md`
  — updated (this document is one of them).

No P1D core module (`core/single-image/xmp-fidelity/*`), no
Candidate/session module, no `ui/app.js` production logic, and no
other file from the R1 list below was touched in R2.

## New files (R1)

- `core/single-image/xmp-fidelity/xmp-property-map.js`
- `core/single-image/xmp-fidelity/xmp-readback-schema.js`
- `core/single-image/xmp-fidelity/xmp-readback-parser.js`
- `core/single-image/xmp-fidelity/candidate-xmp-comparator.js`
- `core/single-image/xmp-fidelity/xmp-fidelity-report.js`
- `core/single-image/xmp-fidelity/xmp-fidelity-gate.js`
- `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` (71 checks: parser
  accept/reject/safety, property-map coverage, single-serialization
  proof, per-group round-trip fidelity, 7 mutation tests, session
  integration/staleness, user-edit invalidation, trace/error-code
  presence, UI wiring, delegated regression to P1A/P1B/P1C/P0.8A/RCM/
  Production-lock suites)
- `P1D_XMP_FIDELITY_ARCHITECTURE.md`, `P1D_XMP_SERIALIZATION_AUDIT.md`,
  `P1D_XMP_PROPERTY_MAP.md`, `P1D_XMP_READBACK_SCHEMA.md`,
  `P1D_XMP_COMPARISON_RULES.md`, `P1D_XMP_FIDELITY_GATE_POLICY.md`,
  `P1D_MODIFIED_FILES.md`, `P1D_RELEASE_NOTES.md`, `P1D_QA_REPORT.md`,
  `P1D_KNOWN_LIMITATIONS.md`

## Modified files (R1)

- `core/single-image/single-image-session.js` — added additive
  `session.xmpFidelity: null` field to `createSingleImageSession()`,
  `requiredTopKeys`, and `resetSessionData()`. No existing field
  renamed or removed.
- `core/single-image/single-image-orchestrator.js` — added
  `traceXmpSerializationStarted/Completed/Failed()`,
  `runXmpFidelityCheck()`, `traceXmpDownloadAllowed/Blocked()`.
  Nothing removed; every existing exported function (including the
  P1C `traceXmpExportUsingCandidate`/`traceXmpExportBlocked`) is
  byte-identical.
- `ui/app.js` — `handleDownload()` rewritten to: trace serialization,
  call `runXmpFidelityCheck()` between serialize and download, gate
  the actual `downloadXMP()` call on PASS/PASS_WITH_WARNINGS, and
  render the new Fidelity status UI. New helper functions
  `renderXmpFidelityStatus()` and `_hideXmpFidelityStatus()` added; the
  latter is called once more, from `handleReset()`, to clear a stale
  badge on Reset/new upload. `candidateToLegacyPreset()` →
  `quickSafetyClamp()` → `serializeXMP()` call sequence is unchanged;
  `serializeXMP()` is still called exactly once per attempt.
- `index.html` — added the `#xmpFidelityStatus` status element (small
  line + collapsed "Advanced Diagnostics" `<details>`) directly after
  the existing `#successMsg` element, inside the same panel as the
  Download/Reanalyze/Reset buttons. No existing element removed or
  restructured.
- `ui/i18n/en.js`, `ui/i18n/th.js` — added 8 new `xmpFidelity*` keys
  each (6 status strings + 2 disclosure labels). No existing key
  changed.
- `qa/run-static-suites.mjs` — registered the new P1D test file.
- `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` — widened test
  24b's regex distance bounds (the try/catch body legitimately grew to
  include the Fidelity Gate call; the semantic property under test —
  a single try/catch wrapping the whole export pipeline with the
  required diagnostic — is unchanged).
- `package.json` — version `2.3.2` → `2.4.0`, description updated.
- `qa/baselines/epic-2e-n1-production-invariant.json` — regenerated
  the `ui/app.js` hash only (the only changed file in that baseline's
  tracked set).
- `qa/baselines/lufa42-production-lock-manifest.json` — regenerated
  hashes for exactly the 5 legitimately-changed locked files
  (`core/single-image/single-image-orchestrator.js`,
  `core/single-image/single-image-session.js`, `ui/i18n/en.js`,
  `ui/i18n/th.js`, `index.html`). All other 140 locked files verified
  byte-identical before and after this round.

## Explicitly untouched (verified via the tests above)

`core/preset-engine/index.js`, `core/curve-engine/index.js`,
`core/xmp-validator/index.js`,
`core/single-image/candidate/legacy-preset-adapter.js`,
`core/single-image/candidate/candidate-store.js`,
`core/single-image/candidate/candidate-slider-adapter.js`,
`core/single-image/candidate/candidate-schema.js` (except the new
`xmp-property-map.js`'s import of its existing exported constants —
read-only), Reference Color Match (`core/color-match/*`), P0.8A
Preview rendering modules, all Production Safety Lock flags.
