# P1G Sharpening Policy

## Bucket architecture

`sharpening-planner.js::planSharpening()` first assigns each image to
one of four named ranges based on its `DETAIL_SCENE_FLAGS`, then
positions it within that bucket via a 0-1 strength score. This
guarantees bucket-level safety regardless of how the finer-grained
strength math behaves — a `SOFT_FOCUS`/`MOTION_BLUR_RISK`/`HIGH_NOISE`
image always routes to the restrained bucket, full stop.

| Bucket | Range | Routed when |
|---|---|---|
| `NOISY_OR_SOFT` | 0-18 | `HIGH_NOISE`, `SOFT_FOCUS`, or `MOTION_BLUR_RISK` present |
| `CLEAN_PORTRAIT` | 8-22 | `CLEAN_PORTRAIT` (skin-heavy, clean) |
| `DETAILED_PORTRAIT_EVENT` | 14-28 | detailed but not landscape-scale texture |
| `LANDSCAPE_DETAIL` | 18-35 | `FINE_TEXTURE` / `CLEAN_HIGH_DETAIL`, low skin coverage |

Absolute Layer-A bound (union of all buckets): **0-35**, enforced a
second time by `detail-guardrails.js` regardless of which bucket a
plan chose.

## What increases Sharpening

- High `edgeDensity`/`fineDetailDensity` (genuinely detailed source,
  e.g. landscapes) — test 11, test 15.
- Strong evidence-derived `focusConfidence` (source is actually sharp,
  not just claimed to be).
- `STRENGTH_MODE.CRISP` (scalar ×1.22, applied before bucket
  positioning so a mode can never push a value outside its bucket) —
  test 32.

## What restrains or zeroes Sharpening

- `HIGH_NOISE` — sharpening a noisy image amplifies the noise; capped
  at 18 (test 17).
- `SOFT_FOCUS` / `MOTION_BLUR_RISK` — **never used to "repair" blur**.
  Sharpening cannot recreate detail that was never captured; the plan
  is explicitly capped at 18 and the bilingual `FOCUS_LIMITED_TEXT`
  diagnostic is surfaced (test 13, 18, 19; see
  `P1G_SKIN_AND_HALO_GUARDRAILS.md`).
- High skin coverage — portraits are held back relative to landscapes
  at the same evidence level (test 16, 20).
- Strong P1F Texture/Clarity already applied — reduces additional
  Sharpening pressure so the two effects don't compound past a
  natural-looking result (test 21).
- `STRENGTH_MODE.NATURAL` (scalar ×0.72) (test 31).

## Halo risk

`detail-guardrails.js` applies an explicit halo-protection cap (see
`P1G_SKIN_AND_HALO_GUARDRAILS.md`) on top of the bucket system — no
fixture, including deliberately halo-risk-prone scenes, is ever allowed
to exceed the documented 0-35 bound (test 22).
