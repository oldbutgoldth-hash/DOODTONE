# P1D — Release Notes

**EPIC 2E-P1D — XMP Serialize + Readback Fidelity Gate**
Version 2.4.1 (R2). Baseline: EPIC 2E-P1C R3.

## R2 — full static-suite regression fix

R1 was verified against a manually-selected list of delegated
regression suites, but not against the full aggregate
`node qa/run-static-suites.mjs` (67 suites) to a confirmed exit code.
Running it surfaced 2 regressions, both now fixed and re-verified:

1. `renderXmpFidelityStatus()` (added in R1 to re-render the Fidelity
   status line's text on a language switch) was missing from the
   reviewed pure-function allowlist in
   `qa/epic-2e-j-locale-switch-rerender-static-test.mjs`. Verified
   pure (no serialize/analysis/download/network calls) and added to
   the allowlist with a written justification.
2. The Material Symbols icon glyph name `hourglass_top` (used while a
   Fidelity check is running) was flagged by the visible-English-text
   audit as photographer-facing prose, because its snake_case
   underscore splits it into two words. Allowlisted in
   `qa/i18n/visible-text-audit-allowlist.mjs` with a written
   justification, matching this project's existing per-file allowlist
   convention.

No P1D core logic, XMP serializer, Fidelity Gate, Candidate/session
behavior, or UI production code changed in R2 — only the two static
test files above, `package.json`'s version, and this documentation
set. See `P1D_QA_REPORT.md` for full methodology and results,
including how all 67 static suites were verified to individually
exit 0 in this environment (the aggregate command itself exceeds this
tool's 45-second single-call limit; see the report for why that
constitutes a valid verification of its exit code).

## What's new (R1)

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

71/71 checks in `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` (including
7 mutation tests against a genuinely generated XMP string), delegated
re-verification of P1A/P1B/P1C R2/P1C R3/P0.8A/Reference Color
Match/Production-lock suites all clean, and — new in R2 — all 67
suites declared in `qa/run-static-suites.mjs` individually confirmed
to exit 0 in their exact declared order, which per that script's own
exit logic means `node qa/run-static-suites.mjs` exits 0. Browser QA
could not be executed (Chromium unavailable in this environment, same
finding as every prior round) — see `P1D_QA_REPORT.md`.

## Known limitations

See `P1D_KNOWN_LIMITATIONS.md` — most notably, this Gate proves
serialization/readback fidelity, not Lightroom rendering equivalence,
and 23 Candidate fields are not exported by the current serializer at
all (documented, not a defect introduced by this round).
