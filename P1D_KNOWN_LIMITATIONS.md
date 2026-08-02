# P1D — Known Limitations

P1D validates: serialized property presence, property value fidelity,
value type fidelity, array/curve ordering, namespace correctness where
detectable, and round-trip equality within documented tolerances,
against this app's own real serializer output.

**P1D does NOT prove:**
- Identical Lightroom rendering (pixel output) for any given XMP.
- Identical Adobe internal processing of the values.
- Identical camera-profile interpretation.
- Compatibility with every Lightroom/Camera Raw version.
- Visual pixel equivalence between the source image and any rendered result.

## Structural coverage gaps (permanent, documented, not export defects)

23 Candidate fields are never serialized by the real, unmodified
`core/preset-engine::serializeXMP()` and therefore can never be
validated for fidelity: `detail.colorNoiseReduction` and 5 sibling
Detail fields, `profile.name`/`treatment`/`processVersion`,
`grading.balance`, `cal.shadowTint`, all of `effects.*`, all of
`optics.*`. See `P1D_XMP_PROPERTY_MAP.md`'s "Unsupported" table. This
is not new to P1D — it mirrors `candidate-schema.js`'s own pre-existing
`UNSUPPORTED_FIELD_PATHS` (P1C) — P1D adds two previously-undocumented
gaps found during the serialization audit:
`detail.colorNoiseReduction` (present on the Candidate, silently never
mapped by the Legacy Preset Adapter) and the fact that
`profile.name`/`treatment`/`processVersion` are never read by the
serializer at all (ProcessVersion is a hard-coded literal).

## Parser scope

`xmp-readback-parser.js` is a deliberately narrow tokenizer for this
app's own single-element, attributes-only XMP shape — it is not a
general-purpose, standards-compliant XML parser. A hand-crafted XMP
string using a structurally different but still-valid-XML shape (e.g.
child elements, `rdf:Seq`/`rdf:li` wrappers) would not parse — this is
intentional and safe, since the only input this parser ever receives
in production is the output of this app's own `serializeXMP()`, whose
shape is fixed and audited (see `P1D_XMP_SERIALIZATION_AUDIT.md` §2).

## Locale re-render

`rerenderCurrentUiForLocale()` re-renders the Fidelity status line's
TEXT from the last-computed result (`state.lastXmpFidelityUiStatus`/
`state.lastXmpFidelityReport`) when the element is currently visible —
a pure text re-render, never a re-check. This was verified by source
inspection only (no browser); real click-through behavior for
Browser QA Scenario 7 is unverified.

## Browser QA

Chromium could not be installed in this environment
(`npx playwright install chromium` → `403 Connection blocked by
network allowlist`, reproducing the identical finding from every prior
P1A/P1B/P1C round) and no system Chrome/Chromium binary is present.
The 7 required browser scenarios (see `P1D_QA_REPORT.md`) are
therefore verified only via the real-module Node integration test
suite (`qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs`, 71/71 passing) and
source inspection of the DOM wiring — not via an actual rendered page.

## PASS_WITH_WARNINGS reachability

With genuine integer Candidate data, the Exposure tolerance path is
provably never triggered (verified exact for every possible input in
this audit) — a real PASS_WITH_WARNINGS export has not been observed
and may be practically unreachable under the current serializer's
exact-integer-arithmetic design. The status and its UI/trace/policy
wiring are still fully implemented and unit-tested via a synthetic
comparator result (test 31), since the contract explicitly requires
the status to exist and be handled correctly if it ever does occur
(e.g. a future serializer change that introduces genuine floating-point
formatting elsewhere).
