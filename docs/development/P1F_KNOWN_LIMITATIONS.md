# P1F Known Limitations

1. **Haze detection is a proxy, not a dedicated sensor.** `HAZY`
   classification and Dehaze confidence both derive from
   `contrastRatio` + `avgSatPct` thresholds rather than a true
   atmospheric-scattering estimate. Documented explicitly in
   `P1F_DYNAMIC_RANGE_CLASSIFICATION.md`; a future EPIC could swap in a
   real haze-density model without changing `computeLocalContrastDetail()`'s
   public contract.

2. **`quickSafetyClamp()` still has no clamp for texture/clarity/dehaze.**
   This is a pre-existing structural gap in `core/xmp-validator`
   (Production-Locked, out of scope to change this round) —
   `basic-tone-guardrails.js`'s Layer A bound is the *only* safety net
   for those 3 fields. If a future change to P1F's planners ever
   produces an out-of-bounds value for one of these 3 fields, Layer B
   will not catch it. Layer A is exercised by mutation test M3 (NaN
   fail-closed) but there is no independent second check.

3. **Strength modes are not user-facing yet.** `STRENGTH_MODE.{NATURAL,
   BALANCED,DRAMATIC}` exist in the architecture (default `BALANCED`)
   but there is no UI control to switch them this round — this
   EPIC's scope was the underlying intelligence layer and Advanced
   Diagnostics visibility, not a new user-facing slider/mode toggle.

4. **Basic Tone strength and Color Intelligence strength remain
   independently owned**, per the explicit composition-policy decision
   documented in `P1F_P1E_COMPOSITION_POLICY.md`. If a future EPIC
   wants a single unified "tone strength" concept spanning both Basic
   and Color, that is a deliberate architecture change, not a bug fix.

5. **Skin-heavy threshold is a single global constant**
   (`SKIN_HEAVY_COVERAGE_PCT = 15`), not adaptive to image
   resolution/crop or multiple detected faces. This mirrors P1E's own
   equivalent threshold and has not been re-derived from real
   population data.

6. **No dedicated per-region (e.g. sky-only, subject-only) Basic Tone
   logic.** All recommendations operate on whole-frame histogram
   statistics; a partially-blown sky with a well-exposed foreground
   subject, for example, is handled only through the existing
   whole-frame `clipHiPct`/`avgLum` signals, not a segmented analysis.

7. **Minimal-evidence tolerance was a real bug found and fixed during
   this EPIC's own regression pass** — both `classifyDynamicRange()`
   and `buildBasicTonePlan()` originally required `stats.total > 0`,
   which caused a legitimate minimal/synthetic fixture (no `total`
   field) to fall into `LOW_CONFIDENCE` incorrectly. Fixed by relaxing
   the guard to only require `stats.total !== 0` (see the Errors/Fixes
   section of this EPIC's release notes) — flagged here in case any
   other minimal-fixture caller elsewhere in the codebase makes the
   same original assumption.

8. **Browser QA could not be executed in this delivery environment.**
   `qa/epic-2e-p1f-browser-qa.mjs` is complete and ready to run, but
   this sandbox has no Chromium binary and the network allowlist
   blocks `npx playwright install` from downloading one
   (`403 Connection blocked by network allowlist`). See
   `P1F_QA_REPORT.md`'s Browser QA section for the exact honest result.

9. **Lightroom import was not manually verified** — no Lightroom
   license/binary available in this environment. See
   `P1F_LIGHTROOM_MANUAL_QA_GUIDE.md` for the required human steps.
