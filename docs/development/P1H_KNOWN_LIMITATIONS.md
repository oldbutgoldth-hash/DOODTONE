# P1H — Known Limitations

1. **No per-pixel skin detector.** Skin-consistency validation uses
   `whitebalance-engine`'s existing `wbIntent.skinWarmth` proxy
   (direction/magnitude/confidence), not a real per-pixel skin mask.
   "Saturated/costume-lit skin" is approximated via a coverage floor
   (3%), a warmth-confidence floor (0.45), and a magnitude ceiling (25)
   — documented as a proxy, per the spec's own acknowledgment that no
   per-pixel detector exists in this project.
2. **Object-color-bias separation is spatial-heuristic, not
   semantic.** `illuminant-object-bias-separator.js` generalizes the
   existing green-only `bgGreenDominant` check to any
   center-neutral/border-non-neutral split; it cannot distinguish "red
   costume" from "red wall" from "sunset sky" by content — only by
   spatial cast distribution. A future stage with real object/semantic
   segmentation could sharpen this considerably.
3. **Strength mode is fixed at BALANCED** for this round; no UI toggle
   was added (see `P1H_STRENGTH_MODES.md`). CONSERVATIVE/CORRECTIVE
   exist and are fully tested but not currently user-reachable.
4. **Advanced Diagnostics panel does not re-render on locale switch** —
   a pre-existing, project-wide gap shared with the P1F/P1G panels, not
   introduced or fixed by P1H.
5. **`planConfidence`'s weighting (0.35/0.30/0.15/0.20) is a reasoned
   default**, not empirically tuned against a labeled dataset — flagged
   consistently with how every prior confidence-blend in this project
   (P1E/P1F/P1G) has been documented.
6. **Mixed-light detection is confidence-scored, not deterministic** —
   it can decline to flag genuinely mixed lighting when shadow/highlight
   cast evidence is itself low-confidence (by design: the plan falls
   back to LOW_CONFIDENCE classification and a small guardrail cap in
   that case instead of a false mixed-light claim).
