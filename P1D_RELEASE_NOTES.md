# P1D — Release Notes

**EPIC 2E-P1D — XMP Serialize + Readback Fidelity Gate**
Version 2.4.0. Baseline: EPIC 2E-P1C R3.

## What's new

Every "Download .xmp" click now runs a local, offline Fidelity Gate
between generating the XMP and actually downloading it: the just-
generated XMP string is parsed back and every supported Lightroom
parameter is compared against the exact value handed to the
serializer (post-safety-clamp). A mismatch, a missing required
property, or an unparseable XMP blocks the download and shows exactly
what didn't match; a clean match (or a match with only informational
warnings) downloads immediately, same as before.

- A small status line next to the Download button: "XMP fidelity check
  passed" / "N XMP values do not match the Candidate" / etc. (Thai and
  English), with a collapsed "Advanced Diagnostics" disclosure for the
  mismatch list and the raw XMP.
- The XMP string is generated exactly once per download attempt — the
  Gate validates that same string, and the download uses that same
  string. No behavior change to the actual exported file content.
- The Fidelity Report is attached to the current image's session and
  is cleared on Reset or a new upload; a Candidate edit invalidates it
  automatically (the next download re-checks fresh).

## What did NOT change

The XMP serializer (`serializeXMP`), the Tone Curve codec, the final
safety-net clamp (`quickSafetyClamp`), the Candidate→legacy-preset
adapter, and every P1A/P1B/P1C Candidate/Report/Session behavior are
byte-identical to P1C R3. Reference Color Match and the P0.8A Preview
pipeline are untouched. No Production write path was activated.

## Verification

71/71 checks in the new `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs`
(including 7 mutation tests against a genuinely generated XMP string),
delegated re-verification of P1A/P1B/P1C R2/P1C R3/P0.8A/Reference
Color Match/Production-lock suites all clean after regenerating hashes
for the 5 legitimately-changed locked files. Browser QA could not be
executed (Chromium unavailable in this environment, same finding as
every prior round) — see `P1D_QA_REPORT.md`.

## Known limitations

See `P1D_KNOWN_LIMITATIONS.md` — most notably, this Gate proves
serialization/readback fidelity, not Lightroom rendering equivalence,
and 23 Candidate fields are not exported by the current serializer at
all (documented, not a defect introduced by this round).
