# EPIC 2E-P1C R3 — User-Edit XMP Export Fix

## 1. Browser symptom

Real browser workflow: upload an image, analysis completes, the
Candidate becomes ready, the user edits a Lightroom slider (badge
correctly shows USER_EDITED), then clicks **Download XMP — and
nothing happens.** No file downloads. No error message. No console
feedback visible to the user.

## 2. Investigation approach

Per the explicit instruction for this round, no code was changed until
the failure was reproduced by direct execution against the real
production modules (not guessed from the bug report's hypothesis
list). A minimal Node script exercised the exact real sequence a
browser session performs:

```
createSingleImageSession → commitCandidate → completeAnalysis →
buildAndCommitCandidate → resolveSliderEdit('exp', '40') →
updateCandidateParameter → getValidatedCandidate → candidateToLegacyPreset →
quickSafetyClamp → serializeXMP
```

using the real `core/single-image/*` and `core/xmp-validator`/
`core/preset-engine` modules — no synthetic re-implementation of any
Candidate or export logic.

**Result of that first run, before any fix:** the Candidate build,
commit, and single-parameter edit all worked exactly as intended —
`committed: true`, `candidate.status === 'USER_EDITED'`,
`getValidatedCandidate()` returned the edited Candidate correctly. The
hypotheses in the bug report's own list (edit not committed, Candidate
becomes INVALID, USER_EDITED not preserved, Candidate disappears,
generation ownership lost, validation rejects a valid edit,
`getValidatedCandidate()` returns null unexpectedly) were all
individually checked and **none of them was the actual defect** — the
Candidate layer was functioning correctly both before and after this
round's changes.

The actual failure surfaced one step later, inside `serializeXMP()`
itself, called from `candidateToLegacyPreset(candidate)` →
`quickSafetyClamp(...)` → `serializeXMP(...)`:

```
TypeError: Cannot read properties of null (reading 'map')
    at serializeCurvePoints (core/curve-engine/index.js:260:14)
    at _curveStr (core/preset-engine/index.js:184:10)
    at serializeXMP (core/preset-engine/index.js:171:30)
```

**Critically, this exception reproduced on the very FIRST export
attempt too — before any slider edit was made at all.** The bug
report's framing ("the failure happens specifically after a user
edit") describes when the user *first tried* Download, not a defect
that is actually caused by editing. Since `handleDownload()` had no
`try/catch` anywhere in its pipeline, this uncaught exception aborted
silently: no success message, no error message, no downloaded file —
exactly the reported symptom, and exactly why it looked "specific to
after an edit" (that's simply the point in a typical workflow where a
user first clicks Download).

## 3. Real root cause

`core/single-image/candidate/legacy-preset-adapter.js`'s
`candidateToLegacyPreset()` always built:

```js
curves: {
  master: candidate.curves.rgb ?? null,
  red: candidate.curves.red ?? null,
  green: candidate.curves.green ?? null,
  blue: candidate.curves.blue ?? null,
},
```

— a **shell object** with `master: null` whenever no Tone Curve editor
data existed (the common case for an Auto-Tune-only workflow).

`core/preset-engine/index.js`'s `serializeXMP()` (untouched, and
correctly so) has always relied on:

```js
function _curveStr(p, ch) {
  const curves = p.curves ?? defaultCurveSet();
  const pts    = curves[ch] ?? curves.master;
  return serializeCurvePoints(pts);
}
```

Before P1C, the legacy `readSlidersAsPreset()` set the WHOLE `curves`
field to `null` when no curve editor was active
(`curves: state.curveEditor ? state.curveEditor.getCurveSet() : null`),
so `p.curves ?? defaultCurveSet()` correctly fell back to real default
curve point arrays.

P1C's adapter instead always produced a truthy shell object
(`{master: null, red: null, ...}`), so `p.curves ?? defaultCurveSet()`
saw a truthy value and never fell back. For `ch === 'master'`,
`curves['master'] ?? curves.master` evaluates to `null ?? null =
null`, and `serializeCurvePoints(null)` — which calls `pts.map(...)`
— threw. This was a **P1C-introduced regression in the export-adapter
layer**, not a defect in the (untouched) serializer itself, not a
Candidate-layer defect, and not caused by editing.

## 4. Fix

`legacy-preset-adapter.js` now only emits a real `curves` object when
real point-curve data exists, and emits a bare `null` otherwise —
restoring the exact contract `serializeXMP()`'s own fallback has
always depended on:

```js
curves: candidate.curves?.rgb != null
  ? {
      master: candidate.curves.rgb,
      red: candidate.curves.red ?? null,
      green: candidate.curves.green ?? null,
      blue: candidate.curves.blue ?? null,
    }
  : null,
```

This is a one-file, minimal, precisely-scoped fix in the P1C-owned
adapter layer — `core/preset-engine/index.js`'s `serializeXMP()` and
`core/curve-engine/index.js`'s `serializeCurvePoints()` (the "XMP
serializer rules") were **not touched**, per the explicit constraint
for this round.

Re-running the exact reproduction script after this fix: both the
pre-edit and post-edit export attempts succeed and produce a real XMP
string containing the edited value.

## 5. Additional hardening implemented (per this round's explicit requirements)

Beyond the root-cause fix above, the following were implemented
because they were explicitly required, even though direct execution
showed the Candidate-edit layer itself was not the cause of the
reported symptom:

- **Transactional `updateCandidateParameter()`**
  (`candidate-store.js`): previously mutated the live
  `session.candidate` object in place, running structural validation
  *after* the mutation and downgrading status to `INVALID` in place if
  validation failed — meaning a single bad edit could permanently
  destroy the last known-good Candidate. Now: clone the active
  Candidate (`structuredClone`), apply the edit + revision/lineage
  bookkeeping to the clone only, validate the clone, and only commit
  it over `session.candidate` if validation succeeds. A failed edit
  leaves the previously-valid Candidate completely untouched and
  returns `{committed:false, reason:'SHAPE_VALIDATION_FAILED',
  validationErrors:[...]}`.
- **`getCandidateExportReadiness()`** (new, `candidate-store.js`):
  strengthens the export-readiness check beyond a bare status-string
  comparison — verifies the Session exists, the Candidate exists, the
  Candidate's `sessionId`/`generationId` actually match the *active*
  Session (not just "some Candidate object is present"), the status is
  one of `VALID`/`VALID_WITH_WARNINGS`/`USER_EDITED`, and full
  structural validation passes — returning an exact
  `{ready, candidate, reason, validationErrors}` diagnostic instead of
  a bare `null`. `getValidatedCandidate()` is now a thin wrapper around
  this same check, so all existing call sites keep working unchanged.
- **`handleDownload()` rewrite** (`ui/app.js`): now sources from
  `getCandidateExportReadiness()`, logs the required
  `[P1C XMP Download Attempt]` diagnostic on every attempt and
  `[P1C XMP Export Blocked]` with the exact reason on a block, and
  wraps the entire `candidateToLegacyPreset → quickSafetyClamp →
  serializeXMP → downloadXMP` pipeline in `try/catch` — any future
  uncaught exception in this pipeline now logs
  `[P1C XMP Export Failed]` with the error name/message/candidateId/
  revision and shows a real, bounded error message in the UI, instead
  of failing silently the way this bug did. This is the second,
  independent layer of defense for this exact symptom class: even an
  entirely different future export exception can no longer fail
  silently.
- **`resolveSliderEdit()` — `Number(...)` not `parseInt(...)`**
  (`candidate-slider-adapter.js`): `parseInt()` silently truncates any
  decimal value. Audited all 17 real `<input type="range">` sliders in
  `index.html` — none currently declares a fractional `step`
  attribute, so this was not the live cause of the reported symptom,
  but the fix was made as explicitly required and is a genuine
  correctness improvement for any slider whose step is ever changed to
  allow decimals (Exposure, Temperature, Tint, HSL, Color Grading,
  Calibration, Sharpening, Noise Reduction). Blank/garbage input is
  still explicitly rejected before the `Number()` conversion
  (`Number('')` is `0`, not `NaN`, so this guard was added rather than
  relying on `Number()`'s own coercion).
- **Filename sanitization narrowed** (`handleDownload()`'s
  `sanitizePresetFilename()`, new): only the characters genuinely
  illegal in a filename (`< > : " / \ | ? *`) are replaced; previously
  `downloadXMP()`'s own sanitizer used a strict word-character
  allowlist that silently mangled legal characters like parentheses or
  apostrophes into underscores. `downloadXMP()`'s own internal
  sanitize call is left unchanged as a second, now-redundant safety
  net (a no-op on an already-safe string) — the XMP contents and the
  Candidate's `profile.name` field are never altered by this, only the
  downloaded filename.
- **Bounded development diagnostics** added at the 5 required points
  (slider input, edit commit, validation-failure, download attempt,
  export-blocked-with-reason) — every one logs only IDs, numbers, and
  status strings, never image or binary data.

## 6. Test added

`qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` — 39 checks (30
required + 9 supporting/bonus) against real production code, **39/39
PASS** on the fixed source.

**Verified to fail on the pre-fix source.** The single-line root-cause
fix in `legacy-preset-adapter.js` was temporarily reverted to its
exact pre-fix form and the same test file was re-run unmodified:
result **37/39 PASS, 2 FAIL** — the 2 failures were exactly check 10
(`serializeXMP() succeeds`) and check 11 (`Generated XMP contains the
edited Exposure value`), both failing with the identical
`Cannot read properties of null (reading 'map')` exception this fix
resolves. The fix was then restored and the suite re-run, returning to
39/39. This confirms the new test is a genuine, specific regression
guard for the actual defect — not a tautology — and that the fix
targets the real cause.

Covers, per the required list: export-readiness before/after edit,
Exposure edit end-to-end through a real generated XMP file containing
the edited (post-safety-clamp) value, single-parameter-only mutation
proof (deep diff against a pre-edit snapshot), HSL Orange Saturation
edit with the edited value present in the generated XMP,
Temperature/Tint edits remaining finite numbers, transactional
rejection of a NaN edit with the previous valid Candidate proven
completely untouched and still exportable afterward, stale Image A
edit rejection after Image B becomes active (`STALE_GENERATION`, and
Image B's Candidate is proven unaffected), `getValidatedCandidate()`
and `getCandidateExportReadiness()` both passing for a `USER_EDITED`
Candidate, and source-level proof that `handleDownload()` never calls
`readSlidersAsPreset()` or reruns analysis, uses
`getCandidateExportReadiness()`, and is wrapped in `try/catch` with the
required diagnostic — plus full delegated re-verification of the P1C
R1 (86/86), P1C R2 (19/19), P1B (39/39), P1A + Upload Lifecycle (25/25
+ 16/16), P0.8A/Reference-Color-Match invariant, and 145-file
Production Lock manifest suites.

## 7. Browser QA result — honest scope statement

**Chromium remains unavailable in this environment**, re-verified
concretely for this R3 round: `npx playwright install chromium` failed
again with `Download failed: server returned code 403 body
'Connection blocked by network allowlist'`; no system Chromium/Chrome
binary exists on `PATH` or in common install locations. The 6 required
real-browser scenarios (upload → Candidate ready → XMP downloads
before any edit; edit Exposure → USER_EDITED → Download works and XMP
contains the edited Exposure; edit HSL Orange Saturation → Download
works and XMP contains the edited value; edit Temperature and Tint →
Download works and values remain finite numbers; a synthetic invalid
value is rejected and the previous valid Candidate remains exportable;
upload Image B → Image A's Candidate cannot be edited or exported as
Image B, Image B becomes active normally) were **NOT run in a real
browser and their real-browser outcomes are UNKNOWN.**

What substitutes for this, per §6 above: the new 39-case test exercises
the real underlying orchestrator/candidate-store/export-pipeline logic
for the functional core of all 6 scenarios directly against real
production code (not a browser), and is proven (§6's fail-before/
pass-after result) to genuinely catch the specific defect reported.
This is not a substitute for real pixel-level, real-DOM-event Browser
verification, and per the explicit constraint for this round, this
document does not claim that a real XMP file was confirmed to download
successfully in an actual browser after a user edit — it claims, and
has directly demonstrated by execution (§2, §4, §6), that a real,
valid XMP string is produced end-to-end by the real, unmodified
export pipeline both before and after a real user edit, using the
identical sequence of real function calls the browser's
`handleDownload()` makes. Anyone running this package in an
environment with Chromium available should run the 6 scenarios above
manually, or build a dedicated Playwright script following the pattern
already established in `qa/epic-2e-p1c-*` and `qa/epic-2e-p1b-*`
Browser suites, before treating them as confirmed.
