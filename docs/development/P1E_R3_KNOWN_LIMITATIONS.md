# EPIC 2E-P1E R3 — Known Limitations

1. **Color Grading (Hue/Saturation/Luminance, all 3 zones) and
   Calibration Hue have NO export-time hard clamp** in
   `quickSafetyClamp()` — confirmed by full source read (see
   `P1E_R3_COLOR_VALUE_PARITY_AUDIT.md` §3-§4, and tests 40-41/44 of
   the new R3 suite, which prove this holds even at deliberately
   extreme magnitudes). Their only safety net is Layer A (`BOUNDS` in
   `color-intelligence-schema.js`), applied once at Color Plan build
   time. This is not currently exploitable by P1E-authored values
   (which never approach even loose neighborhoods of any plausible
   future clamp), but is a genuine architectural gap versus the
   two-layer pattern used everywhere else in this project. Left
   unaddressed this round per the explicit instruction to choose ONE
   coherent parity policy and not modify `quickSafetyClamp()`'s own
   logic; a future round could add a defensive (currently redundant)
   Layer B clamp for these fields for defense-in-depth.

2. **Manual, out-of-P1E-bounds slider edits remain a real, reachable
   UI-vs-Lightroom divergence path.** `SLIDER_RANGES` (DOM limits, e.g.
   ±100) are looser than `quickSafetyClamp()`'s ~10-30 caps for HSL/
   Calibration Saturation and Presence. This round makes the divergence
   checkable (`computeExportParity()`, Advanced Diagnostics panel) and
   visible before export, but does not and should not eliminate
   `quickSafetyClamp()`'s ability to fire on manual edits — the round's
   instructions explicitly require the safety net to remain.

3. **The user's original screenshot examples (specific sign-flipped
   values) are not reproducible from any real code path in this
   codebase.** `quickSafetyClamp()` only ever reduces magnitude toward
   zero (`Math.sign(v) * cap`) — it never flips sign. The audit
   concludes these were illustrative examples of the divergence CLASS
   being guarded against, not a byte-exact reproduction; this is stated
   honestly rather than fabricating a matching mechanism.

4. **Basic Panel (Exposure/Contrast/Highlights/Shadows/Whites/Blacks)
   is unchanged this round.** The audit confirmed a zero/near-zero
   Basic Panel output for low-confidence or flat-scene input is a
   genuine, intentional design choice (project philosophy: "Basic
   Panel is a supporting signal, never primary"), not a defect the
   Color Intelligence module should compensate for by inventing
   non-zero values. A possible future "Basic Tone Phase" is
   recommended but not scoped or implemented here — doing so was
   explicitly out of scope ("do not turn P1E R3 into a full Basic
   Panel rewrite").

5. **No public UI control for Creative Tone strength mode.** The
   architecture supports NATURAL/BALANCED/CINEMATIC/STRONG internally
   and is fully tested at all four levels, but only `BALANCED` (the
   new default) is ever applied — per the explicit instruction that no
   complicated public UI is required this round.

6. **Browser QA for the new Advanced Diagnostics panel is scope-limited
   to what a real browser session can verify without Lightroom itself**
   — see `P1E_R3_QA_REPORT.md` and
   `P1E_R3_LIGHTROOM_MANUAL_VERIFICATION_GUIDE.md` for the exact
   honest boundary between what was automatically verified and what
   requires a human opening the exported XMP in real Lightroom.

7. **The dedicated R3 test suite's own P1C R3 (39/39) spawn is
   deferred to the full static-suite runner** (`qa/run-static-suites.mjs`)
   rather than executed on every single invocation of
   `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` — that particular
   pre-existing suite carries a genuine, deliberate ~16-second in-suite
   timing wait (unrelated to this round's changes) that would otherwise
   make the R3 suite noticeably slower to re-run during normal
   development. The R3 suite still verifies that file's presence and
   syntactic validity directly, and its full 39/39 pass was
   independently confirmed as part of this round's full regression run
   (see `P1E_R3_QA_REPORT.md`).
