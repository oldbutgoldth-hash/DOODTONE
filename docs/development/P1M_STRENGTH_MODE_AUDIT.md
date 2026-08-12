# EPIC 2E-P1M — Strength-mode UI: Audit and Design

## 1. Goal

Add a single, user-facing Strength-mode control (Natural / Balanced /
Dramatic) that scales how aggressively the six Intelligence-layer plan
builders (Basic Tone, Tone Curve, Parametric Tone, Detail, Color, White
Balance) transfer the reference photo's style onto the user's photo —
without re-running Core analysis and without duplicating any existing
module's own strength logic.

## 2. Audit: does every module already support a strength concept?

Yes — every one of the six P1F/P1J/P1L/P1G/P1E/P1H modules already has
its own `STRENGTH_SCALARS` (or `STRENGTH_MULTIPLIER`) table and a
`strengthMode` option on its plan-builder function. The gap was never
"build a new strength engine" — it was "there is no single UI control
that drives all six independent strength options at once."

## 3. The vocabulary mismatch (the real design problem)

Grepping each module's own schema file surfaced that the six modules do
**not** share one strength-mode vocabulary:

| Module | Own STRENGTH_MODE enum |
|---|---|
| basic-tone-schema.js | NATURAL / BALANCED / DRAMATIC |
| tone-curve-schema.js | NATURAL / BALANCED / DRAMATIC |
| parametric-tone-schema.js | NATURAL / BALANCED / DRAMATIC |
| detail-schema.js | NATURAL / BALANCED / **CRISP** |
| color-intelligence-schema.js | NATURAL / BALANCED / CINEMATIC / **STRONG** (4 tiers) |
| white-balance-schema.js | **CONSERVATIVE** / BALANCED / **CORRECTIVE** (no NATURAL/DRAMATIC at all) |

`detail-schema.js`'s own header comment explicitly documents that its
strongest tier is named CRISP rather than DRAMATIC on purpose (stays
skin-safe/halo-safe — see P1G's own docs). `color-intelligence-schema.js`'s
own header comment names STRONG as exactly the tier "a future
user-facing intensity control" should reach, with CINEMATIC reserved for
direct API use only. This is the exact class of "circular dependency /
mismatched vocabulary between stages" this project's skill instructs to
resolve with a lightweight adapter, not by renaming any existing
module's schema (additive-only convention).

## 4. Design: one canonical enum + a pure translation layer

- **`core/single-image/strength-mode/strength-mode-schema.js`** — the
  ONE UI-facing enum: `UI_STRENGTH_MODE = { NATURAL, BALANCED, DRAMATIC }`,
  `DEFAULT_UI_STRENGTH_MODE = BALANCED`, `isValidUiStrengthMode()`.
- **`core/single-image/strength-mode/strength-mode-mapper.js`** — a pure
  function `mapUiStrengthModeToModule(uiStrengthMode, moduleKey)` that
  returns the exact string each target module's own schema expects,
  per the table above. Fails closed to that module's BALANCED-equivalent
  string for any unrecognized `uiStrengthMode` or `moduleKey` — never
  throws, never returns undefined. This is a second, independent safety
  net on top of every downstream module's own pre-existing
  `STRENGTH_SCALARS[x] ?? STRENGTH_SCALARS[DEFAULT]` fallback.

No existing module's `STRENGTH_MODE` enum, `STRENGTH_SCALARS` table, or
plan-builder function signature was renamed, removed, or altered.

## 5. Wiring: candidate-builder.js

`buildCandidateFromSession(session, { engineVersion, strengthMode })`
gained a `strengthMode` parameter defaulting to `DEFAULT_UI_STRENGTH_MODE`
(BALANCED) — matching every module's own pre-P1M hardcoded default
exactly, so omitting the option is a strict no-behavior-change no-op
(proven by P1L's 21/21 suite still passing unmodified). Each of the six
plan-builder call sites now passes
`mapUiStrengthModeToModule(strengthMode, MODULE_KEY.<X>)` instead of a
hardcoded default. `candidate.diagnostics.strengthMode` records the raw
UI-facing value (not the per-module-mapped one) for the Advanced
Diagnostics panel and any future Report surfacing.

## 6. Wiring: rebuild-without-reanalysis

Two pre-existing facts made a fast "change Strength mode without
re-running Core analysis" UI possible:

- `buildCandidateFromSession()` is pure — confirmed via direct code
  audit and this round's own test 22 (session.evidence byte-identical
  before/after a rebuild call).
- `buildAndCommitCandidate()` safely re-commits by overwriting
  `session.candidate` — confirmed via this round's tests 27–30 (a
  second call with a different `strengthMode` on the SAME
  session/generation succeeds, touches no evidence, and the Candidate
  Store reflects only the latest rebuild).

`ui/app.js`'s new `setStrengthMode(mode)` therefore: validates the
incoming mode, updates the standing `state.strengthMode` preference,
and — only if a photo has already been analyzed (`activeUploadTicket`
is truthy) — re-invokes `buildAndCommitCandidate()` with the new mode
and re-runs the exact same post-build render chain a fresh analysis
completion uses (factored into the new shared `applyCandidateBuildResult()`
function so both call sites — the original analysis-completion path and
this new rebuild path — stay in sync). `buildAndCommitCandidate()`'s
own pre-existing terminal-status + `isActiveGeneration()` guards are
unchanged and still apply to this second call site (proven by the
functional orchestrator tests in `epic-2e-p1m-strength-mode-test.mjs`).

## 7. Two legitimate new source facts this created

Two pre-existing structural regression tests (`epic-2e-p1c-candidate-test.mjs`
test 69 and `epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs`'s
"exactly one call site" check) had hard-coded the assumption that
`ui/app.js` contains exactly ONE `buildAndCommitCandidate()` call site.
P1M legitimately adds a second, and both suites were updated — not
loosened — to assert exactly TWO named call sites (the original gated
`runAnalysis()` completion path, and the new `setStrengthMode()`
rebuild path), each independently checked to invoke the shared render
chain in its own successful-commit branch. See `P1M_QA_REPORT.md` for
the full before/after.
