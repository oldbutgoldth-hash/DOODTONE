# P1I — Manual QA Guide

This guide is for a human tester with access to a real browser (this
build environment could not run one — see `P1I_BROWSER_QA_ATTEMPT.md`).
It covers only what P1I adds; it assumes the app's existing upload →
analyze → review → export flow (P1A–P1H) already works.

## Setup

1. Serve the app locally (`python3 -m http.server 8000` from the project
   root, then open `http://localhost:8000/index.html` — do not open
   `index.html` via `file://`, which breaks ES module imports).
2. Have on hand: one neutral/well-lit photo, one photo with strong green
   foliage, one photo with strong pink/warm clothing or skin tones, one
   photo with mixed lighting (e.g. a shaded subject against a sunlit
   background), and one very dark or very flat/low-contrast photo.

## Scenario 1 — Basic pixel-estimator panel appears

1. Upload the neutral photo and run analysis.
2. Open Advanced Diagnostics.
3. **Expect:** a new pixel-level White Balance estimator panel, listing
   all six estimators (Gray World, White Patch, Shades of Gray, Neutral
   Region, Highlight Illuminant, Shadow Illuminant) each with a
   status/confidence, plus an ensemble consensus row.
4. Switch the app language to Thai and re-open the panel. **Expect:**
   all labels in the panel are in Thai, no English leaking through.

## Scenario 2 — Green foliage restraint

1. Upload the green-foliage photo, analyze.
2. Check the Candidate's WB Tint value (or the exported XMP's Tint).
3. **Expect:** Tint is not pushed hard toward Magenta — it should look
   like a plausible, moderate correction, not an extreme value pinned
   near the slider's end. The pixel-estimator panel's Gray World row may
   show a lower confidence or an explicit dominance-penalty note for
   this scene — that is expected and correct.

## Scenario 3 — Pink clothing / skin restraint

Same as Scenario 2, with the pink-clothing/skin photo, checking Tint is
not pushed hard toward Green.

## Scenario 4 — Mixed lighting flag

1. Upload the mixed-lighting photo, analyze.
2. In the pixel-estimator panel, check the Highlight Illuminant and
   Shadow Illuminant rows.
3. **Expect:** if the scene genuinely has different light color in
   highlights vs. shadows, the panel indicates a mixed-light condition
   (however the panel labels it — check against
   `P1I_HIGHLIGHT_SHADOW_ILLUMINANT_MODEL.md` for the exact wording).
   This is informational only — it should not, by itself, cause an
   extreme WB correction.

## Scenario 5 — Flat/low-texture scene degrades gracefully

1. Upload the very flat or very dark photo, analyze.
2. **Expect:** no crash, no error banner. The pixel-estimator panel may
   show lower confidence or `UNAVAILABLE` for one or more estimators
   (this is correct — there isn't much pixel evidence to extract from a
   flat scene) but the overall analysis, Candidate, and export flow
   must complete normally, exactly as it would without P1I.

## Scenario 6 — P1H decision authority preserved

1. For any of the above photos, compare the final Candidate WB Temp/Tint
   against what P1H alone would have produced (if you have a pre-P1I
   build to compare against, or by disabling/ignoring the new panel).
2. **Expect:** P1I's presence should refine/corroborate the decision,
   not produce a wildly different number. If a P1I estimator strongly
   disagrees with P1H's own primary signal, the final decision should
   still look like a reasonable blend, not a value that ignores P1H
   entirely.

## Scenario 7 — No export regression

1. For each photo above, complete the full flow through XMP export.
2. **Expect:** the exported XMP opens cleanly in Lightroom (or is at
   least well-formed/valid), and Temp/Tint values match what the
   Candidate panel showed, exactly as in every prior EPIC round. P1I
   must not change anything about the export path itself.

## Scenario 8 — Mobile layout

1. At a 390px-wide viewport (or an actual phone), open Advanced
   Diagnostics and the new panel.
2. **Expect:** no horizontal overflow (`document.documentElement.scrollWidth`
   should stay within ~10px of the viewport width), panel is readable
   and collapsible/scrollable as appropriate.

## Reporting results

For each scenario, record: pass/fail, the actual Temp/Tint values
observed, and a screenshot of the Advanced Diagnostics panel. File any
failure against the specific module named in
`P1I_MULTI_ESTIMATOR_WB_ARCHITECTURE.md`'s component list, not against
P1I as a whole — this makes it easier to isolate which estimator or
which UI binding needs a follow-up fix.
