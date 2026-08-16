# EPIC 2E-Q2 — Minimum Visible White Balance Transfer

## Context

Second half of the "RCM presets are close to a no-op" investigation.
EPIC 2E-Q1 fixed white balance transfer being silently skipped entirely
whenever no Target base value was present. This round targets a
separate, real mechanism that can still weaken a transfer even once a
base value exists (auto or manual).

## Root cause

`photographic-compensation-engine.js`'s `wbStrength` compounded up to 4
independently-reasonable "confidence-side" factors —
`illuminant.transferStrength` (itself already dampened by zone-
consistency/object-bias uncertainty), `skin.globalWbTransferStrength`,
`amount` (intensity), and `largeShiftDampen` — **before** target-aware
protection (`neutral.whiteBalanceScale`, `targetSkin.globalWarmthScale`)
even got its own multiplicative turn. For a real illuminant difference
backed by decent-but-not-pristine evidence (zone consistency and
illuminant confidence both around 0.5–0.7 — a realistic reading for a
real photo, not a lab gradient), that compounding alone could crush
`wbStrength` under roughly 0.1, before any legitimate target-specific
protection was even applied.

The one existing safeguard (`warmthFloor`) only covered warmth, never
tint, and used a binary all-or-nothing gate
(`zoneConsistency >= 0.72 AND illuminantConfidence >= 0.55`) — a case
sitting just under that line got zero rescue at all, no matter how good
the evidence actually was.

## Fix

`wbStrength` now includes a continuous, evidence-gated floor:

- `illuminantEvidenceStrength` — a 0–1 scalar averaging zone consistency
  and illuminant confidence, replacing the old binary cliff with a
  smooth ramp.
- `confidenceSideFloor = illuminantEvidenceStrength * 0.65` — guarantees
  the confidence-side factors alone (`transferStrength *
  skin.globalWbTransferStrength`) never fall below what the measured
  evidence quality justifies.
- This floor deliberately does **not** touch `amount`, `largeShiftDampen`,
  or either target-aware protection scale (`neutral.whiteBalanceScale`,
  `targetSkin.globalWarmthScale`) — those remain exactly as able to
  suppress the final value as before, for a target that genuinely
  cannot safely take the move (high-key scenes, already-warm skin,
  etc.).
- Applies uniformly to both warmth **and tint** — tint previously had no
  floor mechanism at all despite sharing the identical dampening chain.

## Verified, not just argued

Reconstructing the pre-Q2 formula from the real engine's own computed
intermediates, for a realistic moderate-confidence case
(zoneConsistency ≈ 0.70, just under the old 0.72 gate): the old binary
gate produced **no rescue at all**; the new floor engages
(`transferFloorApplied: true`) and raises the effective transfer above
the un-rescued value. See `qa/epic-2e-q2-minimum-visible-wb-transfer-test.mjs`
for the exact reproducible numbers.

The same suite re-runs EPIC O's own high-key-wedding-target +
already-warm-skin regression fixture and confirms every one of its
documented safe bounds (`exp<=5`, `hi<=3`, `wh<=2`, `temp<=10`,
`hsl_s_orange<=5`) still holds exactly as before — proving the floor
does not fight genuine, deliberate target-aware protection.

## Honest scope

This closes the confidence-cliff bug specifically in the White Balance
channel (warmth + tint), which is where the compounding is most severe
because `illuminant.transferStrength` adds a dedicated confidence layer
on top of everything Tone/Presence already have. Tone (exposure,
contrast, highlights, shadows), Presence (vibrance, saturation), and the
per-channel HSL transfer were **not** touched this round — they are
dampened primarily by legitimate, deliberate protection (clip-risk,
large-shift caution, target-aware channel overlap) rather than by the
same confidence-quality artifact WB had, so applying an identical floor
there would need its own separate audit and calibration rather than a
copy-paste of this fix. Recommended as a future round if real-world
testing still shows weak tone/presence results after this fix.

The floor fraction (0.65) and the evidence-strength formula were tuned
against synthetic fixtures in this environment (no browser/real-photo
pipeline available here). Real photos from actual use are the highest-
value input for further tuning — see the request at the end of this
round's chat summary.
