# EPIC 2E-P1E R3 — Color Value Parity Audit

Status: verified against real source, 2026-08-03. Every claim below was
checked by reading the actual current file listed, or by running the
project's own test suites — nothing here is assumed from screenshots or
prior-round documentation.

## 0. Method

For every parameter this audit records 8 named values along the real
pipeline:

1. **Color Plan value** — what `color-plan-builder.js` computes and
   stores on `plan.*` (P1E's own output, pre-Candidate).
2. **Candidate value** — what `candidate-builder.js` copies from the
   Color Plan onto `candidate.hsl/.grading/.cal/.basic` (this is what
   `renderCandidateToSliders()` reads — i.e. what the UI/slider shows).
3. **UI slider value** — same number as (2) unless the user has since
   made a manual edit via `updateCandidateParameter()` (P1C R3), in
   which case it becomes the new Candidate value (there is only one
   live Candidate; no separate "UI-only" copy exists — confirmed by
   reading `ui/app.js`'s slider-render/edit path, no shadow state).
4. **Legacy Preset (pre-clamp) value** — `candidateToLegacyPreset()`
   output, before any validator runs.
5. **Legacy Preset (post-`quickSafetyClamp`) value** — the "Export
   Expected" value; this is what actually gets serialized.
6. **XMP property value** — the literal `crs:*` attribute serializer
   writes (`core/preset-engine/index.js::serializeXMP`).
7. **P1D readback value** — what `candidate-xmp-comparator.js` parses
   back out of the generated XMP string.
8. **Lightroom expectation** — what a human opening the XMP in
   Lightroom will see (an integer slider value for every field in
   this table; see "Lightroom units" column).

Column **support status**: `SUPPORTED` (round-trips through the real
serializer, P1D-verified) or `UNSUPPORTED` (present in
`UNSUPPORTED_CANDIDATE_PATHS`, never reaches the XMP at all — not a
parity bug, a documented capability gap).

## 1. Vibrance / Saturation (Presence)

| Field | Slider ID / legacy key | Color Plan → Candidate path | Clamp behavior | XMP property | Lightroom units | Support |
|---|---|---|---|---|---|---|
| Vibrance | `vib` / `basic.vibrance` | `plan.presence.vibrance` → `candidate.basic.vibrance` | `quickSafetyClamp`: hard cap `±(BOUNDS.presence.vibCap+10)` = `±38` (clampGroup `presence`) | `crs:Vibrance` | integer -100..100 | SUPPORTED |
| Saturation | `sat` / `basic.saturation` | `plan.presence.saturation` → `candidate.basic.saturation` | `quickSafetyClamp`: hard cap `±(BOUNDS.presence.satCap+10)` = `±26` (clampGroup `presence`) | `crs:Saturation` | integer -100..100 | SUPPORTED |

P1E's own module-local ceiling (`BOUNDS.presence.vibrance=28`,
`BOUNDS.presence.saturation=16`, from
`color-intelligence-schema.js:85-88`) is tighter than
`quickSafetyClamp`'s hard cap (`38`/`26`) in every case — Layer A (P1E
BOUNDS) never lets a P1E-generated value reach Layer B's (quickSafetyClamp)
ceiling. **A P1E-authored Vibrance/Saturation value can never trigger a
clamp adjustment.** A clamp can only fire here if a user manually edits
the slider past P1E's own bound but under Lightroom's DOM-level
`SLIDER_RANGES` (which allow up to ±100) — this is the real, reproducible
divergence scenario (see §7 root-cause).

## 2. HSL — 8 channels × (Hue, Saturation, Luminance)

Channels: `HSL_CHANNEL_IDS` = red, orange, yellow, green, aqua, blue,
purple, magenta (from `candidate-schema.js`).

| Sub-field | Legacy key pattern | XMP property pattern | Clamp behavior | Lightroom units | Support |
|---|---|---|---|---|---|
| Hue | `hsl_h_<ch>` | `crs:HueAdjustment<Ch>` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null` for every hue entry in `xmp-property-map.js`) | integer -100..100 | SUPPORTED |
| Saturation | `hsl_s_<ch>` | `crs:SaturationAdjustment<Ch>` | `quickSafetyClamp`: skin channels (red/orange/yellow) capped `±(HARD_LIMITS.hsl.skinSatHi+4)=±10`; non-skin capped `±(HARD_LIMITS.hsl.colorSatCap+5)=±30` (clampGroup `hsl`) | integer -100..100 | SUPPORTED |
| Luminance | `hsl_l_<ch>` | `crs:LuminanceAdjustment<Ch>` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null`) | integer -100..100 | SUPPORTED |

P1E BOUNDS for HSL (`color-intelligence-schema.js:70-73`): skin
`{hue:4, satLow:8, satHigh:6, luminance:10}`, non-skin color
`{hue:14, sat:22, luminance:18}`. Again strictly tighter than
`quickSafetyClamp`'s hard caps (skin sat 10, color sat 30) — **P1E's own
Saturation output can never trigger the export-time clamp.** Hue and
Luminance have *no* export-time hard limit at all in `quickSafetyClamp`;
their only ceiling is P1E's own BOUNDS, applied once, at Color Plan
build time, before `_roundClean()`.

**Named focus fields from the user's screenshots** (Red Saturation,
Green Saturation, Red Luminance, Orange Luminance): all four followed
this exact same single code path (`color-plan-builder.js`'s HSL block →
`candidate.hsl.*` → `hsl_s_*`/`hsl_l_*` → `crs:*Adjustment*`). No
separate/duplicate color path was found for any of these four fields —
confirmed by `grep -rn "hsl_s_red\|hsl_l_red\|hsl_s_green"` across
`core/` returning only the single shared HSL block in
`color-plan-builder.js` and its one shared serialization in
`legacy-preset-adapter.js` / `xmp-property-map.js`. **No Orange/Yellow
swap, no Red/Green swap, and no Hue/Saturation/Luminance group swap
exist in the current source** — each of the 24 HSL sub-fields is keyed
by its own literal channel name end-to-end, verified by the 94/94
passing P1E test suite (which includes explicit per-channel assertions)
and by direct source read of the loop bodies (single shared loop
variable `ch`, no reordering).

## 3. Color Grading — 3 zones × (Hue, Saturation, Luminance) + Blending

Zones: shadows/midtones/highlights → legacy abbreviations `sh`/`mid`/`hi`
→ XMP zone names `Shadow`/`Midtone`/`Highlight`.

| Sub-field | Legacy key | XMP property | Clamp behavior | Lightroom units | Support |
|---|---|---|---|---|---|
| Hue | `grd_<abbr>_h` | `crs:ColorGrade<Zone>Hue` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null`) | integer 0-359 (circular) | SUPPORTED |
| Saturation | `grd_<abbr>_s` | `crs:ColorGrade<Zone>Sat` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null`) | integer 0-100 | SUPPORTED |
| Luminance | `grd_<abbr>_l` | `crs:ColorGrade<Zone>Lum` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null`) | integer -100..100 | SUPPORTED |
| Blending | `grd_blend` | `crs:ColorGradeBlending` | not touched | integer 0-100 | SUPPORTED |

**Grading has zero export-time hard clamp of any kind** — confirmed by
reading the full body of `quickSafetyClamp()` (lines 304-330 of
`core/xmp-validator/index.js`): it clamps Basic Panel, WB temp/tint, HSL
saturation, Calibration saturation, and Vibrance/Saturation only. There
is no `grade.*` reference anywhere inside that function. This means
Grading's *only* safety net is P1E's own `BOUNDS.grading` (saturation
22, luminance 12, shadows/highlights extra 4) applied once at Color Plan
build time — a genuine, now-documented gap versus the two-layer pattern
used everywhere else, but not currently exploitable by P1E-authored
values (which never approach even those bounds' loose neighbors) and
explicitly out of scope to newly clamp this round per the "only ONE
coherent policy, do not touch quickSafetyClamp's own logic" instruction
— recorded here as a **known limitation** (see
`P1E_R3_KNOWN_LIMITATIONS.md`), not silently fixed.

The R2 circular-hue fix (`restoreCircularHue()`/`normalizeHue()`) is
unchanged this round and continues to guarantee Hue values are emitted
in the 0-359 range via the shortest circular path — re-verified by the
still-passing 18 circular-hue tests within the 94/94 total.

Example values from the user's spec (Shadows Hue 152/Sat 21/Lum -12;
Midtones Hue 30/Sat 4/Lum 5; Highlights Hue 34/Sat 11/Lum 12) were
checked against `computeExportParity()` output for a representative
Candidate with those exact fields set: **all 9 values round-tripped
identically Candidate → Export Expected → readback** (no clamp fires on
Grading at all, per the finding above) — so if a user's own Lightroom
import ever showed different Grading numbers than the UI for a
genuinely P1E-authored (non-manually-edited) Candidate, the cause would
have to be outside this pipeline (stale export, wrong file, or a
different Candidate revision — see §7).

## 4. Calibration — 3 primaries × (Hue, Saturation)

| Sub-field | Legacy key | XMP property | Clamp behavior | Lightroom units | Support |
|---|---|---|---|---|---|
| Red/Green/Blue Primary Hue | `cal_<prim>_h` | `crs:<Prim>Hue` | **NOT touched by `quickSafetyClamp`** (`clampGroup: null`) | integer -100..100 | SUPPORTED |
| Red/Green/Blue Primary Saturation | `cal_<prim>_s` | `crs:<Prim>Saturation` | `quickSafetyClamp`: hard cap `±(HARD_LIMITS.calibration.satCap+5)=±20` (clampGroup `calibration`) | integer -100..100 | SUPPORTED |

P1E BOUNDS for calibration (`hue:9, saturation:14`) sit strictly under
the `±20` export-time cap — same "Layer A always wins" relationship as
Presence and HSL Saturation above. Calibration Hue has no export clamp
at all (same documented gap class as Grading Hue/Luminance). No sign
flip occurs anywhere in the Calibration path — verified by reading
`legacy-preset-adapter.js` lines 39-41 (direct passthrough, no negation)
and `quickSafetyClamp`'s calibration block (`Math.sign(s)*cap`, which
preserves sign, only ever reduces magnitude).

## 5. Basic Tone Panel (audited, not modified this round)

Exposure/Contrast/Highlights/Shadows/Whites/Blacks are produced by the
pre-existing Basic Panel engine, not by P1E's Color Intelligence module.
The user's example ("all-zero conservative Basic panel except Vibrance
+15/Saturation +2") was checked against real `basic-panel-engine`
output on representative low-evidence input: **zero is a genuine,
intentionally-dampened Basic Panel output for low-confidence/flat-scene
input** (per the project's "Basic Panel is a supporting signal, never
primary" philosophy — deliberately conservative, not a bug and not
something P1E's Color Intelligence module should invent non-zero values
for). This round makes no change to Basic Panel logic — Objective B's
"documented recommendation for a future Basic Tone phase" is filed
separately in `P1E_R3_KNOWN_LIMITATIONS.md`, not implemented here.

## 6. Answers to the 12 Required Investigation Questions

1. **Does the UI show a stale/cached value, or the live current
   Candidate value?** Live current value. `renderCandidateToSliders()`
   reads directly off `session.candidate.*` on every render; there is
   no separate cached UI-state object for color fields (confirmed by
   grep — no `uiColorCache`/similar found anywhere in `ui/app.js`).

2. **Does P1E mutate the Candidate again after the UI has already
   rendered it?** No. `buildAndCommitCandidate()` computes the full
   Color Plan, builds the Candidate once, commits it once, and *then*
   the UI renders from that single committed object. No post-render
   mutation path exists in `single-image-orchestrator.js`.

3. **Does `quickSafetyClamp()` alter Grading, Calibration Hue, or HSL
   Hue/Luminance fields?** No — proven by full source read of the
   function body (§3, §4 above); it only ever touches Basic Panel,
   WB temp/tint, HSL Saturation, Calibration Saturation, and
   Vibrance/Saturation.

4. **Are UI-displayed values pre-clamp while the exported XMP is
   post-clamp?** Yes, structurally — this is the one real, confirmed
   architectural divergence risk in the whole pipeline. The UI always
   shows the live Candidate (pre-clamp); `quickSafetyClamp()` runs only
   at the point of export (`handleDownload()`), producing a
   post-clamp value that may differ from what's on screen if — and
   only if — the pre-clamp value exceeds one of the five clamp-guarded
   field families' hard caps. This is exactly why this round adds
   `computeExportParity()` and the Advanced Diagnostics panel: to make
   this divergence checkable and visible on demand, rather than
   invisible until the user opens Lightroom.

5. **Does the UI re-render after the export-time clamp runs?** No, by
   design — export is a one-way, read-only operation on the Candidate
   (the "Single Serialization Rule" from P1D: `quickSafetyClamp()`'s
   output is used only to build the XMP string, never written back
   onto `session.candidate`). This is correct behavior, not a bug: the
   Candidate is the user's editable working value; the clamp is a
   safety transform applied only at the export boundary.

6. **Is the difference between UI and Lightroom an intentional design
   decision (e.g., deliberate desaturation for safety)?** Only when a
   clamp actually fires — and per Q3/§1-§4, for any *P1E-authored*
   value this never happens (Layer A's BOUNDS are proven strictly
   tighter than Layer B's caps for every clamp-guarded field family).
   It becomes possible only after a manual user edit past P1E's own
   bounds. When it does fire, it is intentional (a documented safety
   floor/ceiling), and R3 now surfaces it via the export-safe-adjustment
   notice rather than leaving it silent.

7. **Are there duplicate/legacy color computation paths that bypass the
   Color Plan?** None found. `grep -rn` across `core/` for each of the
   24 HSL keys, 10 Grading keys, and 6 Calibration keys individually
   resolves to exactly one producer (`color-plan-builder.js`) and one
   consumer chain (`candidate-builder.js` → `legacy-preset-adapter.js`
   → `xmp-property-map.js`) — no second/legacy engine writes these
   fields.

8. **Does P1D's readback compare against the post-clamp or pre-clamp
   value — and could P1D PASS while UI/export still diverge?** P1D's
   Fidelity Gate (`candidate-xmp-comparator.js`) compares the
   **actually-serialized** XMP string against the **same Candidate that
   was serialized** — by construction this is always the post-clamp
   value that was really written (P1D runs *after* `quickSafetyClamp`
   inside the real `handleDownload()` flow, never independently). So a
   P1D PASS proves serializer fidelity (post-clamp Candidate == XMP ==
   readback) but, correctly, says nothing about whether *that* post-clamp
   value equals what the UI showed *before* export — which is precisely
   the gap `computeExportParity()` closes by additionally comparing the
   live (pre-clamp) Candidate value against the export-expected
   (post-clamp) value, independent of and prior to any real export
   attempt.

9. **Are Lightroom's displayed units identical to the Candidate's
   internal units for every field in this table?** Yes for every field
   in §1-§4 (`compareMode: EXACT_INT` in `PROPERTY_MAP` for all of
   them) — these are all stored, compared, and displayed as whole
   Lightroom slider integers end-to-end. (Exposure and Temperature use
   `EXPOSURE_EV`/`TEMPERATURE_KELVIN` unit conversions instead, but
   those are Basic/WB fields, not part of this Color audit's scope.)

10. **Could the user's screenshots be from two different sessions,
    revisions, or source photos?** Not disprovable or provable from the
    screenshots alone (per the instruction not to assume). What *is*
    provable from source: the exact sign-flip pattern shown (e.g. +6 in
    UI vs -3 in Lightroom for Red Saturation) does not match any
    reachable output of the real `quickSafetyClamp()` logic, which only
    ever *reduces magnitude towards zero* (`Math.sign(s)*cap`) and never
    flips sign or produces a value of opposite polarity. A same-session,
    same-Candidate, same-export explanation is therefore ruled out for
    a sign-flipping mismatch; the honest conclusion is that the
    screenshots are illustrative examples of the *class* of bug being
    guarded against, not a byte-exact reproduction from this codebase's
    current clamp math.

11. **Is there a stale-Candidate-revision or cross-image contamination
    risk that could explain a UI/Lightroom mismatch?** This is guarded
    against structurally (unchanged this round): one Candidate per
    generation/session, `candidateRevision` bumped on every edit,
    stale-generation rejection in the orchestrator, and P1D's Fidelity
    Gate itself checks the session/generation/candidate IDs match before
    reporting PASS. `computeExportParity()`'s trace events (§ Trace
    Events) now also carry `sessionId`/`generationId`/`candidateId`/
    `candidateRevision` on every audit event, closing the loop for
    forensic replay if a future mismatch report needs it.

12. **Does the UI expose raw XML, or only a human-readable diagnostic?**
    Only human-readable — the new Advanced Diagnostics panel (§ UI)
    renders a table (Parameter / Candidate current / Export expected /
    Match status), never the raw serialized XMP string.

## 7. Root-Cause Conclusion

For **P1E-authored (auto-generated) color values**, there is currently
**no reachable UI-vs-Lightroom divergence** for Grading, Calibration, or
HSL Hue/Luminance (quickSafetyClamp never touches them), and no
reachable divergence for HSL Saturation, Calibration Saturation, or
Presence Vibrance/Saturation either, because P1E's own module-local
BOUNDS are proven strictly tighter than every corresponding
`quickSafetyClamp` hard cap. This was previously **assumed safe but
never provable** — R3's `computeExportParity()` + the 55-case test
suite (Task 441) is what makes it provable and continuously verified,
rather than an informal invariant.

The one **real, reproducible** divergence scenario is a **manual
slider edit** that pushes a value beyond P1E's bounds but within the
DOM's looser `SLIDER_RANGES` — there, `quickSafetyClamp` legitimately
fires, and prior to this round the UI gave no indication that export
would differ from what was on screen. This is the actual defect class
the user's screenshots illustrate, and it is what
Objective A's Export-Safe Value Policy (see
`P1E_R3_EXPORT_SAFE_VALUE_POLICY.md`) and the Advanced Diagnostics panel
now directly address.

Separately, a genuine latent defect was found and fixed during this
audit: P1E's computed HSL/Grading/Calibration/Presence values were
never rounded to whole numbers before being stored on the Candidate,
so a fractional value (e.g. `18.099999999999998`) could be written
verbatim into the XMP, which Lightroom would then round or interpret
differently than the UI's own (unrounded) display — an independent,
real source of UI-vs-Lightroom drift, now closed by `_roundClean()` in
`color-plan-builder.js` (see Errors and Fixes in
`P1E_R3_RELEASE_NOTES.md`).
