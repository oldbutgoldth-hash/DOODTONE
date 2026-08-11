# EPIC 2E-P1K — Release Notes

**Version**: 2.11.0
**Title**: Serializer Extension for Post-Crop Vignette + Grain

## What changed

The real XMP serializer (`core/preset-engine/index.js::serializeXMP`)
now emits `crs:PostCropVignetteAmount/Midpoint/Roundness/Feather` and
`crs:GrainAmount/Size/Frequency`, plus the fixed `crs:
PostCropVignetteStyle="1"` literal — 8 new attributes total, all
additive, zero pre-existing attributes disturbed.

The Candidate's `effects.*` group (present since P1C, always `null`,
previously undocumented-as-supported) is now a fully wired,
serializer-supported, Fidelity-Gate-checked, Layer-B-safety-netted
export path — exactly like every other Candidate group. It joins the
list of fully-supported groups; only `optics.*` (out of this round's
scope), `detail.{radius,detail,masking,...}`, `grading.balance`, and
`cal.shadowTint` remain genuinely unsupported by the underlying
serializer.

## What did NOT change

No Intelligence layer computes real Vignette/Grain values yet — every
Candidate's `effects.*` fields remain `null` until a future round adds
that analysis (not part of the user's 4-item selection for this round,
which prioritized this serializer extension first). Exported XMP always
carries Lightroom's own real slider defaults (0/50/0/50/0/25/50) for
this group today, which is correct, safe, and match-verified — not a
placeholder or stub.

## Why this mattered

This was the highest-leverage of the 4 items the user selected (all 4,
Auto Mode): it's the one item that touches the single protected/locked
real XMP serializer, and unblocks any future Effects Intelligence work
(the same way P1E–P1J each first needed a supported export path before
Intelligence could be wired to it).

## Bug fixed incidentally

`candidate-export-parity.js`'s parity check incorrectly flagged every
null-but-legitimate `effects.*` field as a mismatch; fixed with a
null-aware branch (see P1K_QA_REPORT.md for the full root-cause trace).
