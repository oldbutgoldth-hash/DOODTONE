# EPIC 2E-Q4 — Graceful Skin Protection Degradation

## Context

Fourth finding from the "RCM presets are not good enough to use"
investigation, targeting the one of the user's four original problem
categories Q1–Q3 did not touch: skin/skin tone being affected.

## Root cause

`classifySkin()` sets `detected = coveragePct > 4` — a hard boolean
cliff. Both `deriveSkinModel()` (`photographic-compensation-engine.js`)
and `deriveTargetSkinProtection()` (`target-aware-protection-engine.js`)
gated **all** skin protection on that single boolean. A target with real
but just-under-4% skin coverage — a smaller/partial-frame portrait, a
face partly out of crop, a modest headshot within a wider scene, or
simply a borderline classifier read — got exactly the same **zero**
protection as a target with no skin at all. This is the same silent-skip
failure shape as EPIC 2E-Q1's missing white-balance base: protection the
system is fully capable of computing simply never engaged because one
upstream boolean landed on the wrong side of a cliff.

The skin *classifier itself* (`core/skin-classifier/index.js`) was read
and audited too, but deliberately **not** changed this round — its
per-pixel YCbCr/HSV/chroma thresholds are the kind of parameter where a
wrong guess without real photographic ground truth could just as easily
introduce or worsen bias across different skin tones as fix anything.
That is not a risk worth taking on synthetic data alone.

## Fix

Both `deriveSkinModel()` and `deriveTargetSkinProtection()` now compute
`skinPresence = clamp(coveragePct / 4, 0, 1)` and multiply the final
protection strength by it, instead of gating on the boolean:

- At/above the classifier's own 4% threshold, `skinPresence` clamps to
  exactly 1 — **byte-identical** output to before this round.
- Between roughly 1–4% coverage, protection now ramps up proportionally
  instead of being exactly zero.
- At genuinely zero coverage, protection is still genuinely zero.
- Explicitly disabling skin protection (`preserveSkinTone: false`) still
  fully disables it regardless of coverage.

## Verified, not just argued

`qa/epic-2e-q4-graceful-skin-protection-test.mjs` demonstrates, with the
real engine's own numbers: at 3% target skin coverage (below the old
cliff), `protectionStrength` moves from the old hard `0` to a real,
non-zero value, and `skinChannelTransferStrength` (the dampening applied
to red/orange/yellow HSL channels) moves from `1` (no protection) to a
meaningfully protective value — while a monotonic ramp across
1%/2%/3%/4.5% coverage is asserted directly. Every already-passing test
that exercises a confidently-detected skin case (coverage well above 4%)
is confirmed unaffected.

## Honest scope

This closes the "protection silently never engages" failure mode. It
does **not** address possible accuracy issues in `classifySkin()`'s own
per-pixel detection (e.g. potential reduced sensitivity for some skin
tones under the fixed YCbCr window) — that would require real
photographic test data with known ground truth to investigate and tune
responsibly, and is flagged as a distinct, separate concern rather than
guessed at here.
