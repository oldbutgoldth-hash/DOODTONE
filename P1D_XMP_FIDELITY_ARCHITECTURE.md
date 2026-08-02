# P1D — XMP Fidelity Gate Architecture

## Purpose

EPIC 2E-P1D adds a validation layer, not a new export path. It proves
that the XMP string `core/preset-engine::serializeXMP()` produces from
the canonical Candidate can be read back and that every supported
Lightroom parameter survived serialization intact. It does not change
what gets exported, only whether an export is allowed to complete.

## Data flow

Validated Candidate (`candidateStore.getCandidateExportReadiness()`)
→ `candidateToLegacyPreset()` (unchanged, P1C)
→ `quickSafetyClamp()` (unchanged, P1B/xmp-validator) — its output is
  the "export-expected" ground truth
→ `serializeXMP()` (unchanged, preset-engine) — called exactly once
→ `xmp-fidelity/xmp-readback-parser.js` — parses that same string
→ `xmp-fidelity/candidate-xmp-comparator.js` — compares parsed values
  against the export-expected preset, using `xmp-property-map.js`
→ `xmp-fidelity/xmp-fidelity-gate.js` — decides PASS / PASS_WITH_WARNINGS / FAIL
→ `xmp-fidelity/xmp-fidelity-report.js` — assembles the serializable report
→ `single-image-orchestrator.js::runXmpFidelityCheck()` — traces every
  lifecycle event and commits the report to `session.xmpFidelity`
→ `ui/app.js::handleDownload()` — downloads the SAME already-generated
  XMP string only if the gate allowed it; blocks otherwise.

## Module responsibilities

- `xmp-property-map.js` — pure data: Candidate path → legacy-preset key
  → real `crs:` attribute name → comparison mode → clamp group. Single
  source of truth, built from `P1D_XMP_SERIALIZATION_AUDIT.md`.
- `xmp-readback-parser.js` — pure function, safe tokenizer (not a
  general XML parser — see "Parser design" below). No DOM, no network,
  no external entities, bounded length.
- `xmp-readback-schema.js` — the normalized readback contract + a
  NaN/Infinity/undefined-rejecting validator.
- `candidate-xmp-comparator.js` — pure function, one comparison per
  property-map entry plus 4 Tone Curve array comparisons, using
  MATCH / MATCH_WITH_TOLERANCE / MISSING / MISMATCH / UNSUPPORTED /
  INVALID.
- `xmp-fidelity-gate.js` — pure function: parse → compare → decide
  status. Never touches Session, DOM, or trace events.
- `xmp-fidelity-report.js` — pure function: assembles the serializable
  Fidelity Report object from a comparator result.
- `single-image-orchestrator.js::runXmpFidelityCheck()` — the ONLY
  place that traces P1D events and writes `session.xmpFidelity`,
  mirroring the existing pure-core/traced-orchestrator split already
  used by `buildAndCommitCandidate()`.

## Parser design (why not DOMParser or a general XML library)

The input is never untrusted third-party XML — it is always the
string this app's own `serializeXMP()` just produced, in one fixed
shape: a single `<rdf:Description>` element with every value as a
plain quoted attribute (see audit §2). A small, deterministic
attribute tokenizer covers that exact shape completely and identically
in Node (tests) and the browser, without depending on `DOMParser`
(unavailable in Node) or adding a dependency. Safety is enforced
independent of "is this well-formed XML": bounded length, rejection of
`<!DOCTYPE`/`<!ENTITY`/`SYSTEM`/`<![CDATA[` constructs, no network, no
filesystem.

## Single Serialization Rule

Exactly one `serializeXMP()` call per download attempt
(`ui/app.js::handleDownload()`). The Fidelity Gate parses that same
string; `downloadXMP()` receives that same string. Verified by test
suite checks 14-15c in `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs`.

## Session integration

`session.xmpFidelity` is a new, additive field (`single-image-
session.js`) — cleared on every fresh Session (new upload) and by
`resetSessionData()` (Reset button), tagged with the exact
`candidateId`/`candidateRevision` it was computed against. Every
download attempt reruns the Gate fresh; there is no cross-attempt
caching, so a "stale report" can only ever be a display artifact (a
badge left over from a previous check) — the UI derives what to show
from the CURRENT candidate revision, never trusts a stored status
blindly for gating.

## What P1D deliberately does not do

Retune Auto-Tune values, change Core analysis formulas, change any
Candidate Builder formula, redesign the UI, change Report
calculations, touch Reference Color Match or P0.8A Preview, or
activate Production write paths. See `P1D_KNOWN_LIMITATIONS.md`.
