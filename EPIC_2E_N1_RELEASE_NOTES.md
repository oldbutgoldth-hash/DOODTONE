# EPIC 2E-N1 — Core Color Match Signature Engine

## Release

- LUMIXA AI `v1.4.0`
- Stage: `N1_SIGNATURE_DELTA_FOUNDATION`
- Production: Legacy unchanged
- Deployment: not performed

## What changed

N1 introduces a shared analysis contract for the two images that matter to
Color Match: the **Reference** and the **Target**. Both now produce the same
schema, so their differences can be calculated without copying raw values
from the Reference directly into Lightroom controls.

The signature covers white-balance direction by tonal zone, tonal luminance
and contrast, palette distribution across eight colour families, weighted
saturation/luminance, optional skin evidence, optional style evidence and
capture-risk evidence. A separate Delta Engine compares those signatures,
handles circular hue correctly, emits stable reason/risk codes and calculates
an evidence-weighted Match Need score.

## UI

The Reference Color Match panel now shows a Shadow-only Core Match Inspector:

- Match state
- Match Need score
- Evidence confidence
- Warmth/Tint delta
- Midtone delta
- Palette distance

The inspector explicitly reports Legacy Production and no XMP write.

## Important boundary

N1 does **not** translate the delta into Lightroom sliders and does not change
the existing Reference XMP generator. That translation belongs to N2 after
photographic compensation policies are implemented and tested.
