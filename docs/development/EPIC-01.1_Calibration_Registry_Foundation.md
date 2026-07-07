# EPIC 1.1 — Calibration Registry Foundation

## Goal

Every prior stage's documentation has repeated some version of the same
risk note: *"this weight/threshold is a reasoned default, not tuned from
real-world samples."* True across `core/decision-engine`,
`core/lightroom-mapping-engine`, `core/reference-transfer-engine`, and
`core/xmp-validator` — dozens of numeric constants live scattered across
those files with no single place to see them, understand their purpose,
or safely reason about changing one. This stage creates that single
place: a centralised, read-only, explainable calibration registry — and
explicitly does **not** yet change any engine's behaviour.

## Source-of-Truth Discipline

Per the Latest Project File Rule, every value in the registry was pulled
directly from the current source in this package, verified with `grep`/
`sed` against the actual constants before being copied — not invented,
not estimated. For example:

- `HARD_LIMITS` was read verbatim from `core/xmp-validator/index.js`
  lines 30–52.
- `ENGINE_PRIORITY_WEIGHT`, `BUDGET_SCALE`, `MIN_ENGINE_SCALE`, and the
  default per-dimension budget shares were read from
  `core/lightroom-mapping-engine/index.js`.
- `SCENE_STRATEGIES.general`'s trust values were read from
  `core/decision-engine/index.js`.
- The 17 styles' `priority` values were read from `STYLE_PROFILES` in
  `core/decision-engine/index.js`.
- Feasibility/transfer level cutoffs (0.7/0.4, 0.55/0.25, etc.) were read
  from `core/reference-transfer-engine/index.js`.

Every registry entry's `value` field is intended to be byte-identical to
its corresponding engine constant at the time of writing — if a future
audit finds a mismatch, that is a documentation bug to fix, not evidence
the engine changed independently (this stage did not touch any engine).

## Registry Structure

`core/calibration-registry/index.js` exports a flat array of 87 entries
(internally indexed by key for O(1) lookup), each shaped:

```js
{
  key: 'validationThreshold.wb.tempCap',
  value: 40,
  category: 'validation-threshold',
  owner: 'xmp-validator',
  purpose: 'Maximum absolute White Balance Temperature shift.',
  rationale: 'Beyond this, WB is "overcorrection", not "reproducing mood"...',
  risk: 'Raising this could let extreme, scene-specific WB moods transfer...',
}
```

`value` is either a number, a `[min, max]` range pair (e.g. Tone Curve
anchor bounds), or a boolean flag (used for the "does this style have
explicit rules" presence entries).

### 9 Categories (87 entries total)

The spec named 8 categories; a 9th (`style-budget`) was added because
Style Budget's mathematical scaling matrix (`BUDGET_SCALE`,
`ENGINE_PRIORITY_WEIGHT`, per-dimension default shares) is one of the
densest concentrations of tunable constants in the codebase and didn't
fit cleanly under any of the 8 named categories without stretching one of
them past its stated purpose.

| Category | Entries | Owner module(s) |
|---|---|---|
| `style-weight` | 17 | decision-engine |
| `style-threshold` | 4 | decision-engine |
| `feasibility-threshold` | 4 | reference-transfer-engine |
| `transfer-threshold` | 6 | reference-transfer-engine |
| `validation-threshold` | 21 | xmp-validator |
| `engine-trust-default` | 8 | decision-engine |
| `style-budget` | 12 | lightroom-mapping-engine |
| `photographer-style-rule` | 10 | decision-engine |
| `confidence-clamp` | 4 | decision-engine, lightroom-mapping-engine |

`photographer-style-rule`'s 8 "has explicit rules" flags document *which*
of the 17 styles currently have Style DNA Validation required/forbidden
rules (per `03_PHOTOGRAPHER_INTELLIGENCE_PRINCIPLES.md`) without
duplicating the rule content itself verbatim — the actual required/
forbidden element lists remain the single source of truth in
`core/decision-engine`'s `STYLE_DNA_RULES`, avoiding two copies of the
same data structure drifting apart over time.

## What This Stage Deliberately Does Not Do

- **No engine reads from this registry yet.** Confirmed:
  `grep -rn "calibration-registry" ui/ index.html core/*/index.js` (excluding
  the registry's own file) returns nothing. Every engine still uses its
  own internal constant.
- **No behaviour change of any kind.** Re-ran the full analyse → map →
  validate → benchmark → export pipeline end-to-end after adding the
  registry: zero JS console errors, XMP export still produces a valid
  file with the same structure as before this stage.
- **No architecture, UI, or XMP export changes.**

## Helper Functions

```js
getCalibration(key)                    // full entry incl. metadata, or undefined
getCalibrationValue(key, fallback)     // just .value, or fallback if missing
listCalibrationByCategory(category)    // array of entries in that category
listCalibrationCategories()            // array of the 9 distinct category names
listAllCalibrations()                  // the full raw entry array
validateCalibrationRegistry()          // { isValid, issues, warnings, summary }
```

`getCalibrationValue`'s `fallback` argument is the key design point for
future migration: `getCalibrationValue('styleBudget.scale.budgetScale', 40)`
degrades safely to the engine's own previous literal value if the key is
ever renamed or removed by mistake, rather than returning `undefined`
into a numeric computation.

## Validation Logic

`validateCalibrationRegistry()` checks, in order:

1. **Missing required fields** — every entry must have `key`, `value`,
   `category`, `owner`, `purpose`, `rationale`, and `risk`.
2. **Missing rationale / missing owner** (explicit, separately-worded
   checks per the spec, even though the generic field-loop above already
   catches both) — these two fields are called out because they are the
   ones most likely to be skipped when adding an entry quickly.
3. **Invalid numeric values** — `NaN`, or a `[min, max]` range where
   `min > max`.
4. **Invalid ranges for 0–1 categories** — a warning (not a hard issue)
   fires if a `style-weight`/`style-threshold`/`feasibility-threshold`/
   `transfer-threshold`/`confidence-clamp` entry's value falls outside
   0–1, since those categories are conventionally normalised (the
   feasibility style-adjustment bounds are explicitly excluded from this
   check since ±0.2/+0.15 legitimately go negative).
5. **Duplicate keys** — every key is counted; any key appearing more than
   once is reported.

Verified against three synthetic broken inputs (not part of the shipped
registry, used only to prove the validator works): a missing-
rationale/owner entry, two entries sharing the same key, and a
`[50, 10]` inverted range — all three were correctly flagged as `isValid:
false` with specific, actionable issue messages.

Run against the actual shipped registry: **`isValid: true`, 87 entries
across 9 categories, 0 issues, 0 warnings.**

## How Future Stages Will Use This Registry

Migration is intended to happen **one engine, one constant, at a time** —
never as a bulk refactor:

```js
// Before (still the current state after this stage):
const BUDGET_SCALE = 40;

// After a future migration stage:
import { getCalibrationValue } from '../calibration-registry/index.js';
const BUDGET_SCALE = getCalibrationValue('styleBudget.scale.budgetScale', 40);
```

Because every registry entry's value already matches the engine's
current constant exactly, migrating any single engine to read from the
registry is a **no-op on behaviour by construction** — the fallback
argument is the same literal the engine already had, so even a
registry-loading failure would reproduce today's exact behaviour. Only a
**future edit to the registry value itself** (a deliberate calibration
change, presumably informed by real-world testing this project doesn't
yet have — see Remaining Risks) would actually change output.

Suggested migration order for a future stage, roughly by risk (lowest
first): `validation-threshold` (already the most tightly-scoped, hard
safety ceilings) → `engine-trust-default` → `style-budget` →
`style-weight`/`style-threshold` → `feasibility-threshold`/
`transfer-threshold` last, since those two categories' formulas
(weighted sums with fixed coefficients like ×0.45/×0.35/×0.20) would need
the coefficients themselves added to the registry too before a full
migration, which this stage did not attempt.

## Modified / New Files

- **New:** `core/calibration-registry/index.js` (87 entries, 9
  categories, 6 exported functions).
- **New:** `docs/development/EPIC-01.1_Calibration_Registry_Foundation.md`
  (this file).
- **Updated:** `docs/project/05_PROJECT_MEMORY.md` (new stage row +
  registry noted in architecture summary).
- **Not modified:** every file under `core/` other than the new registry
  folder, all of `ui/`, `index.html`. Confirmed via `grep` that no
  existing file references the new module.

## Remaining Risks

- **The registry is descriptive, not yet enforced.** Nothing currently
  prevents an engine's internal constant from drifting away from its
  registry mirror over time until a future migration stage actually wires
  engines to read from here — until then, this file requires manual
  upkeep to stay accurate.
- **All 87 values remain hand-reasoned estimates**, exactly as before
  this stage — centralising them makes that fact more visible and
  auditable, but does not resolve it. No tuning against real preset
  outcomes has occurred.
- **Three separate high/medium/low three-band threshold pairs exist in
  `transfer-threshold`** (WB risk: 0.55/0.25, editing distance: 0.55/0.30,
  acceptance: 0.65/0.35) that are not currently harmonised to a single
  shared pair — a future stage may want to unify them, which this stage's
  registry now makes easy to spot but does not resolve.
- **The registry's own internal categorisation (9 categories) is this
  author's judgement call**, not something the underlying engines
  enforce — a future contributor could reasonably re-group these entries
  differently without any test catching the change, since nothing reads
  the `category` field programmatically yet beyond
  `listCalibrationByCategory()`.
