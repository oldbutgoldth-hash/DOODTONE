# EPIC 2E-P1N — Known Limitations

1. **10 named categories, not the skill's cited "17 styles/61 DNA
   ingredients."** The `anthropic-skills:photographer-style-intelligence`
   skill describes a larger reference implementation than what
   currently exists in `core/style-recognition-engine/index.js` (10
   `PROFILES` entries, no shared DNA ingredient catalog at all). This
   round wires in the classifier that actually exists in this codebase
   rather than assuming the skill's numbers apply here — see
   `P1N_PHOTOGRAPHER_STYLE_AUDIT.md` §3. That file's own header
   comment separately claims "11 categories" while only defining 10 —
   a pre-existing, unrelated discrepancy not touched or resolved this
   round.

2. **No Layer 2/3/4 (DNA / Validation / Feasibility) for
   `style-recognition-engine`.** Per the skill's own guidance ("if the
   user only needs classification with no downstream reproduction
   step, Layers 1–2 alone are enough"), and because the task's actual
   scope was "wire into Report/UI" rather than "extend the
   classifier," this round surfaces Layer 1's existing output plus
   `style-fingerprint`/`style-benchmark-engine` as supporting context —
   it does not add a new ingredient catalog, internal-consistency
   validator, or reproducibility/feasibility model to the classifier
   itself. A future round could add these following the skill's
   4-layer pattern if a concrete need arises.

3. **Alternates capped at 2.** `styleRecognition.styles` contains all
   10 categories ranked by confidence; the Report shows only the top
   match plus 2 alternates (consistent with how other sections in this
   Report keep their extraRows compact) rather than the full ranked
   list. The full list remains available on `session.evidence.
   styleRecognition.styles` for any future UI that wants it.

4. **`report.safetyWarnings` does not include this section's
   warnings.** An ambiguous or low-confidence style classification is
   a labeling-uncertainty concern, not an export-safety concern in the
   sense `safetyWarnings` represents elsewhere in the Report (clipping,
   color cast, low WB confidence). The section's own `.warnings` array
   is still shown in its own block.

5. **Style category names are not localized.** `topStyle` and
   `alternates[].style` render as their raw English category names
   (Wedding, Portrait, etc.) in both English and Thai UI — matching
   this renderer's pre-existing precedent for `report.scene.
   primaryType`, which is also never translated.

6. **Browser QA not run this round.** No Chromium/Playwright execution
   was available in this environment for P1N; all verification is
   against real production modules executed directly in Node (see
   `P1N_QA_REPORT.md` §4). A future round should add the standard
   Browser QA pass covering this new section once a Chromium-capable
   environment is available.

7. **P1J's own nested-spawn suite still exceeds this environment's
   tool-call timeout.** This is the same pre-existing, documented
   limitation noted in every prior round since P1G — not a P1N
   regression. Every suite it nests was independently confirmed green
   in this round's own standalone runs (see `P1N_QA_REPORT.md` §2).
