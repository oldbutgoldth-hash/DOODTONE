# P1D — XMP Fidelity Gate Policy

## Statuses

| Status | Meaning | Download |
|---|---|---|
| PASS | Every required, supported property matched exactly; no parser errors; no critical mismatches. | Allowed |
| PASS_WITH_WARNINGS | Every required property matched; only tolerance-level or informational items remain. | Allowed, with a warning badge |
| FAIL | Parse failure, a required property is missing, a value mismatch, wrong XMP attribute name (manifests as MISSING), invalid type, or an invalid Tone Curve structure. | Blocked, exact mismatch summary shown |
| PARSE_FAILED | The generated XMP string itself could not be parsed. | Blocked |
| STALE | A previously-stored report no longer matches the current Candidate revision (display-only state — see below). | N/A (never gates a real download) |

## Design note on PASS_WITH_WARNINGS

The 23 documented-unsupported Candidate fields (`grading.balance`,
`effects.*`, `optics.*`, etc.) are a **permanent, structural**
characteristic of the current serializer, true on every single export
this app will ever produce until the serializer itself changes — not
a per-export anomaly. Counting them toward PASS_WITH_WARNINGS would
make every export "warn," training users to ignore the badge. P1D
therefore classifies them `UNSUPPORTED`/`INFO` and excludes them from
the warnings count; `PASS_WITH_WARNINGS` is reserved for genuine
per-export anomalies (currently: a tolerance-level Exposure match).
This is a documented interpretation of an ambiguous spec phrase
("only optional/unsupported warnings remain") — the Important
Limitation itself is already documented once, globally, in
`P1D_KNOWN_LIMITATIONS.md`, rather than repeated as UI noise on every
download.

## Bounded error codes

`NO_EXPORT_READY_CANDIDATE`, `STALE_CANDIDATE`, `SERIALIZATION_FAILED`,
`XMP_TOO_LARGE`, `XML_PARSE_FAILED`, `REQUIRED_PROPERTY_MISSING`,
`PROPERTY_VALUE_MISMATCH`, `INVALID_CURVE`, `CANDIDATE_REVISION_MISMATCH`,
`UNKNOWN_FIDELITY_ERROR` (`core/single-image/xmp-fidelity/xmp-fidelity-
gate.js::FIDELITY_ERROR_CODE`).

## Trace events (15, `single-image-orchestrator.js`)

`XMP_SERIALIZATION_STARTED`, `XMP_SERIALIZATION_COMPLETED`,
`XMP_SERIALIZATION_FAILED`, `XMP_READBACK_STARTED`,
`XMP_READBACK_COMPLETED`, `XMP_READBACK_FAILED`,
`XMP_FIDELITY_COMPARISON_STARTED`, `XMP_FIDELITY_MATCH`,
`XMP_FIDELITY_MISMATCH`, `XMP_FIDELITY_PASSED`,
`XMP_FIDELITY_PASSED_WITH_WARNINGS`, `XMP_FIDELITY_FAILED`,
`XMP_FIDELITY_STALE_REJECTED`, `XMP_DOWNLOAD_ALLOWED`,
`XMP_DOWNLOAD_BLOCKED`. Each carries sessionId, generationId,
candidateId, candidateRevision (where applicable), fidelityReportId,
status, mismatchCount, durationMs, errorCode, errorMessage, timestamp
— never image binary data. `XMP_FIDELITY_MATCH`/`XMP_FIDELITY_MISMATCH`
are aggregate signals fired once per gate run (zero vs. nonzero
mismatches), not once per property, to avoid trace-log spam.

## Download workflow order (`ui/app.js::handleDownload()`)

1. `getCandidateExportReadiness()` — block outright if not ready.
2. `candidateToLegacyPreset()` (unchanged).
3. `quickSafetyClamp()` (unchanged) — its output is the export-expected preset.
4. `traceXmpSerializationStarted()` → `serializeXMP()` (the ONE call) → `traceXmpSerializationCompleted()`.
5. `runXmpFidelityCheck(ticket, {candidate, exportExpectedPreset, xmpString})` —
   parses/compares the SAME string, traces every event, commits
   `session.xmpFidelity`.
6. Render the status badge from the result.
7. If PASS/PASS_WITH_WARNINGS: `downloadXMP(xmp, name)` using the SAME
   string from step 4 — never re-serialized — then trace
   `XMP_DOWNLOAD_ALLOWED`.
8. If FAIL/PARSE_FAILED: trace `XMP_DOWNLOAD_BLOCKED`, do not download,
   Candidate is left untouched (nothing above ever mutates it).

## Staleness

`session.xmpFidelity` is tagged with the exact `candidateId`/
`candidateRevision` it was computed against. `runXmpFidelityCheck()`
is generation-gated (`isActiveGeneration()`) exactly like every other
P1A-P1C write path, and additionally re-checks that the live
`session.candidate` still matches the identity/revision the report was
computed for before committing — a race (edit/rebuild/reset landing
mid-check) is rejected via `XMP_FIDELITY_STALE_REJECTED` rather than
silently overwriting a newer state. New upload / Reset both produce a
Session with `xmpFidelity: null`.
