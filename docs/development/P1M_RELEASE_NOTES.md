# EPIC 2E-P1M — Release Notes (v2.13.0)

## What's new

A **Strength** control — Natural / Balanced / Dramatic — now sits above
the sliders panel. It drives all six Intelligence layers at once
(Basic Tone, Tone Curve, Parametric Tone, Detail, Color, White Balance),
each scaled through its own already-existing strength table so the
photographer-safe bounds every layer already enforces (skin protection,
halo-safe sharpening caps, export-safety clamps) are never bypassed.

Changing Strength mode after a photo has already been analyzed
instantly rebuilds the Auto-Tune Candidate from the same evidence — no
re-analysis, no re-upload, just a fast re-scale using whatever the
reference photo's analysis already found.

## How it works

- **Natural** — the gentlest transfer each layer supports.
- **Balanced** — the existing default behavior every layer already had
  before this release (choosing Balanced changes nothing).
- **Dramatic** — the strongest transfer each layer's own safety bounds
  allow (Detail's strongest tier is internally named "Crisp" to keep it
  skin/halo-safe; Color's strongest tier is internally named "Strong").

The choice is remembered as a standing preference for the session and
is not cleared by Reset-to-Auto or a new photo upload.

## Under the hood

- One canonical UI enum (`UI_STRENGTH_MODE`) plus a small, pure
  translation layer maps it onto each of the six Intelligence layers'
  own (slightly different) vocabulary — no existing module's schema was
  renamed or altered.
- `candidate.diagnostics.strengthMode` records which mode produced the
  current Candidate, for the Advanced Diagnostics panel.
- Every export-time safety net from prior EPICs (P1D's XMP Fidelity
  Gate, P1G R2's Detail export clamp, and every module's own
  Layer-A/Layer-B bounds) is completely unaffected — Strength mode only
  changes which of each module's own already-safe presets gets used.

## Compatibility

Purely additive. No existing Candidate field, XMP property, or Report
field changed shape. Omitting Strength mode entirely (any code path
that doesn't pass it) behaves exactly as before this release — proven
by the full regression suite, especially P1L's suite remaining 21/21
unmodified.
