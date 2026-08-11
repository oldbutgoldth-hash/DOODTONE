# P1J — Known Limitations

1. **Parametric Tone Curve sliders are out of scope.** `candidate.curves.parametric`
   (Shadows/Midtones/Highlights scalar sliders) is not driven by this
   Intelligence layer and stays at whatever `rawPreset.crv_sh/crv_mid/crv_hi`
   provides (currently 0 — no override). No existing Core engine computes
   parametric slider recommendations; inventing that math would violate
   this project's reuse-first rule. This is a documented, explicit
   non-goal, not an oversight.

2. **No strength-mode UI control this round.** `STRENGTH_MODE.{NATURAL,
   BALANCED,DRAMATIC}` exist in the schema for architecture/extensibility,
   but `candidate-builder.js` always uses `DEFAULT_STRENGTH_MODE`
   (BALANCED). A user-facing strength selector, if wanted, is future
   scope — matching the same pattern P1F/P1G/P1H shipped their first
   round with fixed defaults before any strength UI existed.

3. **Browser QA not attempted this round.** No persistent Chromium
   session was available in this sandbox environment. All verification
   is real Node-level integration testing against the actual production
   modules (not simulated/mocked shapes), but a live-browser
   upload→analyze→export walkthrough has not been captured for this
   specific round. This is reported honestly rather than fabricated.

4. **Advanced Diagnostics table shows point counts, not raw values.**
   The per-channel table intentionally shows point-array length and
   match status only, never the raw `{x,y}` coordinates — consistent
   with every other Advanced Diagnostics panel's "never raw pixel/XML
   data" convention. A user wanting to see the actual curve shape should
   use the existing (separate, optional) Curve Editor preview, which
   still visualizes `session.evidence.toneCurves` points directly.

5. **Engagement confidence floor is a single global threshold.**
   `MIN_ENGAGEMENT_CONFIDENCE` (0.15) applies uniformly; it is not
   scene-category-aware the way some other Intelligence layers'
   thresholds are. This mirrors the P1F Basic Tone engagement gate's
   first-round scope and was not flagged as a problem in that precedent.
