# P1H — White Balance Intelligence Advanced Diagnostics UI

## What was added

- `index.html`: a new `<details id="wbIntelDiagnostics">` disclosure,
  inserted immediately after the existing P1G Detail Intelligence
  panel and before the P1D XMP Fidelity status block — same
  collapsed-by-default, never-primary-UI convention every prior
  Advanced Diagnostics panel in this project uses.
- `ui/app.js`: `renderWBIntelligenceDiagnostics(candidate)` — reads
  `candidate.diagnostics.whiteBalanceIntelligence` (already computed,
  pure) and renders:
  - primary cast + all flags + confidence (score and tier) + strength
    mode + engaged/no-adjustment state,
  - a plain-language evidence summary (raw reading, neutral-reference
    confidence, skin-validation status/reason, object-color-bias
    score) — bounded scalars/labels only, never raw pixel data,
  - the exact bilingual mixed-lighting notice when that protection
    engaged,
  - an export-safety-adjustment notice (reusing `computeExportParity()`,
    the SAME utility every other panel already uses) when
    `quickSafetyClamp()` actually adjusted Temperature or Tint,
  - a Candidate-current-value / Export-Expected-value / match-status
    table for both fields.
- `ui/i18n/en.js` / `ui/i18n/th.js`: 15 new `wb*` keys under
  `appShell`, following the existing `basicTone*`/`detail*` key naming
  convention exactly.

## What was intentionally NOT done

- No raw pixel dumps, no raw XMP string shown in this panel (matches
  every prior EPIC's convention).
- No redesign of the existing Advanced Diagnostics disclosure pattern
  — this is strictly an additive new `<details>` block using the same
  CSS variables/markup style already in use.
- Locale re-render on language switch is NOT wired into
  `rerenderCurrentUiForLocale()` — this matches the EXISTING, already
  established behavior for the P1F/P1G Advanced Diagnostics panels
  (neither of which re-renders on locale switch either); this is a
  pre-existing project-wide gap, not something P1H introduced or is
  scoped to fix.
