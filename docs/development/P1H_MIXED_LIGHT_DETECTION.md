# P1H — Mixed Lighting Detection

## Signal

`core/single-image/white-balance-intelligence/mixed-light-detector.js`
combines two REAL, already-computed signals:

1. `color-cast-detector`'s own per-zone `shadows.label` /
   `highlights.label` (a real, per-pixel-luminance-bucketed
   measurement) — if these disagree AND neither is 'neutral', the
   scene has a non-uniform cast across its tonal range.
2. `whitebalance-engine`'s own `wbIntent.mixedLightingRisk` (already
   computed from the exact same shadow/highlight comparison,
   internally, inside `_buildWBIntent()`) — used as a cross-reference,
   not re-derived.

## Behavior when mixed light is detected

- `wb-plan-builder.js` multiplies the planned correction by 0.6 (on
  top of any mood-preservation scaling already applied) — reduces
  global correction without zeroing it, matching the spec's explicit
  requirement.
- `protections.mixedLightGuard = true`.
- `classification.flags` includes `MIXED_LIGHT`, and it is the
  second-highest-priority `primaryCast` (only OBJECT_COLOR_BIAS ranks
  higher).
- `diagnostics.mixedLightMessage` carries the EXACT required bilingual
  text:
  - Thai: "ตรวจพบแสงหลายอุณหภูมิ ระบบจึงปรับสมดุลสีขาวแบบระมัดระวัง"
  - English: "Mixed lighting detected; white-balance correction was kept conservative."
- The Advanced Diagnostics UI panel (`ui/app.js`
  `renderWBIntelligenceDiagnostics()`) surfaces this message in the
  currently-active locale whenever the guard engaged.

## What it does NOT do

It does not attempt to separate and correct shadows/highlights
independently (that would require a per-tonal-zone WB correction
applied selectively during export, which the existing XMP
Temperature/Tint fields cannot express — Lightroom's
`crs:Temperature`/`crs:Tint` are single scene-wide values). The
Candidate always remains a single valid Temperature/Tint pair, per the
spec's explicit "keep Candidate valid" requirement.
