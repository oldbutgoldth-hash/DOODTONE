# EPIC 2E-P1K — Known Limitations

1. **No Vignette/Grain Intelligence exists yet.** `candidate.effects.*`
   remains `null` on every real Candidate — the serializer now
   *supports* these fields, but nothing *computes* them. Every export
   today writes Lightroom's real neutral defaults. Building the
   analysis layer that would populate these fields (e.g. detecting
   whether a reference image's vignette/grain character should be
   transferred) is out of this round's scope and not one of the user's
   4 selected priorities this round.

2. **`crs:PostCropVignetteStyle` is a fixed literal, not
   Candidate-driven.** The Candidate schema has no corresponding field
   for vignette style (Highlight Priority / Color Priority / Paint
   Overlay); `"1"` (Highlight Priority) is hardcoded, matching the
   existing `crs:WhiteBalance="Custom"` convention for other
   non-Candidate-driven fixed attributes. If a future round wants
   user-selectable vignette style, this will need a new Candidate field
   plus PROPERTY_MAP/schema wiring.

3. **Attribute names were calibrated against public Adobe Camera Raw
   documentation, not traced from an existing in-repo function** (every
   other `crs:` attribute in this serializer was traced from
   already-shipped code). This is the one deviation from this project's
   strict "trace from real source, never guess" rule for this specific
   round — justified because no prior code in this repository ever
   emitted these attributes, so there was nothing to trace from. The
   strong 1:1 camelCase-naming correspondence with every other already-
   verified group (documented in P1K_SERIALIZER_XMP_ATTRIBUTE_AUDIT.md)
   is offered as corroborating evidence, but this remains the one place
   in the serializer whose exact wire format has not been round-tripped
   through a real, installed copy of Adobe Lightroom/Camera Raw.

4. **Browser QA not attempted** — no Chromium available in this
   sandbox, consistent with every prior EPIC.

5. **`optics.*` remains unsupported**, by design (out of the user's
   selected scope this round).
