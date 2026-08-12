# EPIC 2E-Q1 — Auto Target White Balance Base

## Problem reported

Testing showed Reference Color Match (RCM) producing presets that were
close to a no-op: white balance essentially untouched, Basic panel
values near zero, mood/color not actually transferring from the
reference image to the target, even for a reference/target pair with an
obviously different look (warm golden reference vs. a cooler target).

## Root cause found

RCM already runs a real, pixel-level White Balance analysis
(`whitebalance-engine.analyzeWhiteBalance()`) on the Target image on
every single run — this is the same "White Balance Pro" evidence shown
elsewhere in the app. But that result was never connected to
`targetMediaContext.baseTemperatureK`/`.baseTint`, which is the value
the Candidate/XMP codec needs before it will write an actual Temperature/
Tint override into the exported preset. Only a manually-typed "Target
Lightroom Base Values" field fed those two numbers.

If that manual field was left blank — the common case, especially for a
plain JPEG/PNG target with no RAW as-shot metadata to type in — the
codec fell back to `WhiteBalance="As Shot"` with no Temperature/Tint
attributes at all: white balance transfer was silently skipped for the
whole run, no matter how different the reference and target actually
were. This matches the reported symptoms directly.

## Fix

`ui/reference-color-match-panel.js` now automatically computes a base
Temperature/Tint from the Target's own already-computed White Balance
Pro evidence (`coreOutputs.whiteBalancePro`), converted to Kelvin via
`whitebalance-engine`'s existing `sliderToKelvin()` — the exact same
function the main single-image pipeline already trusts for the same
job. No new analysis algorithm was written; this is purely wiring
already-computed evidence into a field that only read manual UI input
before.

This auto value is used **only for non-RAW targets** (JPEG/PNG/TIFF/
etc.). RAW targets are untouched: EPIC O8's "Target RAW Temperature/Tint
base requirement" is a deliberate, documented safety principle (a
downsampled proxy pixel read is not a RAW file's real as-shot metadata),
and RAW still requires a real manual base or is blocked via
`TARGET_RAW_WB_BASE_REQUIRED` exactly as before this round.

A manually-typed base always wins, for both RAW and non-RAW targets —
this is additive on top of the manual field, never a replacement for it.
The panel now shows the user exactly which value is in effect and why
(`ค่าอัตโนมัติจากการวิเคราะห์ภาพ...` / `กำลังใช้ค่าที่กรอกเอง...` / RAW
requires manual entry), so a blank field never again silently means
"nothing happened."

## What this does and does not fix

This closes the most concrete, reproducible cause of a near-no-op
result: white balance transfer being skipped entirely. It does not
change the separate (and still real) multiplicative "protection"/
dampening chain across `photographic-compensation-engine.js` and
`target-aware-protection-engine.js`, which can independently reduce a
transfer's magnitude even once a base value is present. That chain was
also audited this round (see the investigation notes in chat) and is
flagged as a candidate for a future round — a "minimum visible transfer"
floor, evidence-gated by real confidence signals, generalized beyond the
one narrow `warmthFloor` case that already exists.

## Compatibility

Purely additive for non-RAW targets. RAW-target behavior, the manual
override, and every existing `buildCandidateWhiteBalanceContext()` /
`serializeCandidateXMP()` decision are unchanged and covered by
regression tests (see QA report).
