# 02 — PROJECT DEVELOPMENT PROTOCOL

This document describes the development conventions actually reflected in
the current codebase (`core/`, `ui/`, `index.html`) — verified by reading
the source, not reconstructed from memory of past instructions.

## 1. Additive-Only Changes

Every stage of development observed in the code adds new fields to
existing return objects rather than replacing or removing them. Evidence
in the current source:

- `core/decision-engine`'s `finalStyleIntent` carries both the original
  flat fields (`mood`, `warmth`, `colorCast`, `contrastLevel`,
  `skinProtected`) *and* the newer structured intents (`moodIntent`,
  `wbIntent`, `skinIntent`, `paletteIntent`, …, `photographerStyle`,
  `styleFeasibilityEstimate`) side by side — explicit backward-compat
  comments mark the older fields as "kept alongside the structured
  intents below so any existing reader still works."
- `core/lightroom-mapping-engine`'s output gained a `_mappingTrace` field
  across development without changing any pre-existing field's shape.
- `core/reference-transfer-engine`'s `buildReferenceTransferReport()`
  return object has grown (`editingDistanceEstimate`, `styleFeasibility`)
  purely by adding new top-level keys.

## 2. Architecture Freeze — Pipeline Order Is Fixed

The current pipeline order (see `04_PROJECT_ARCHITECTURE.md` for the full
diagram) is treated as fixed. New capabilities are added **inside**
existing pipeline stages rather than by inserting new stages or
reordering existing ones. Where a later-stage signal would have been
useful earlier (e.g. Decision Engine "wanting" Reference Transfer's
complexity/benchmark data, which doesn't exist yet when Decision Engine
runs), the codebase's consistent resolution — visible in comments across
`core/decision-engine`, `core/reference-transfer-engine`, and
`core/decision-report-engine` — is:

1. Compute a lightweight **proxy estimate** at the earlier stage from
   whatever signals genuinely already exist there.
2. Compute the **authoritative** version later, once all needed signals
   exist, in whichever stage is the first true convergence point.
3. Document the two as explicitly different numbers, verified in
   comments to actually diverge (e.g. a documented case where a
   preliminary `styleFeasibilityEstimate` read 0.821 while the
   authoritative `styleFeasibility` read 0.77 for the same reference).

This pattern recurs at least four times in the current code
(`decisionConfidence`/`transferAwareConfidence` vs
`finalStyleIntentConfidence`; `transferRiskEstimate` vs the full
`wbTransferRisk`; `styleFeasibilityEstimate` vs `styleFeasibility`) and is
treated as the standard way to handle a circular-dependency-shaped
requirement without changing pipeline order.

## 3. Every Non-Trivial Decision Is Commented In Place

Source files consistently carry inline comments explaining *why* a value
was chosen, not just what it does — e.g. `core/lightroom-mapping-engine`
documents a specific CSS-equivalent bug class in `index.html` (see below)
and a resolved circular-dependency reasoning directly above the function
that implements the resolution, rather than only in separate docs.

## 4. UI Changes Are Root-Caused, Not Patched Symptomatically

The current `index.html` contains an unusually detailed example of this
protocol in its Image Preview Viewer CSS: three sequential root causes
were identified and documented in place before the final fix — (1) a
CSS Grid `1fr` track being pushed wider than its container by
unconstrained intrinsic content, (2) a block-level wrapper with
`width:auto` filling its container instead of shrinking to fit an
oversized child, and (3) `scroll-behavior:smooth` turning a single
programmatic `scrollLeft` assignment into an ~800ms–1s animation. Each is
left in the code as a comment explaining what was tried, why it didn't
work, and what the actual fix was — future maintainers are meant to be
able to see the reasoning trail, not just the final CSS.

## 5. Verification Requirement Before Considering Work Done

The current codebase's comments repeatedly reference concrete,
reproducible verification steps rather than asserting correctness
abstractly — e.g. specific before/after numbers for a bug fix
(`adjustmentsMade: 0 → 1 → 5` across two related patches to the same
style-budget enforcement logic), or an exact MutationObserver timing
trace used to confirm a file-re-selection race condition was fixed
(`t=13958ms display=none → t=13967ms "loading" → t=14628ms new result`).
The convention observed is: a fix is not considered complete until it has
been demonstrated against the actual running application, not just
argued for in the abstract.

## 6. Scope Discipline Per Development Stage

Each development stage in the current code is scoped to an explicit,
narrow set of files (visible in the "Focus files" pattern echoed in
several header comments, e.g. `core/decision-engine`,
`core/decision-report-engine`, `core/reference-transfer-engine` for the
Photographer Intelligence stages) and explicitly avoids touching
`core/lightroom-mapping-engine` or XMP export logic when a stage's stated
purpose is diagnostic/explanatory only (Style DNA, Style DNA Validation,
Style Feasibility are all present in the current code as
**report-only** additions with zero effect on mapped slider values,
confirmed by their complete absence from `core/lightroom-mapping-engine`
and `core/xmp-validator`).

## 7. Backward-Compatible Naming Over Renaming

Where a concept has been refined over time (e.g. the colour-oriented
`photographerStyleLabel`/`styleFamily` classifier from an earlier stage
versus the richer `photographerStyle` object from a later stage), the
current code keeps **both**, deliberately decoupled — the older
classifier still exists and still drives `editingStrategy`/`styleBudget`
unchanged in `core/decision-engine`, while the newer one is additive and
independent. The codebase accepts that the two can disagree on the same
image (documented directly in code comments) rather than forcing a single
source of truth prematurely.

## 8. Documentation Follows Implementation, Never the Reverse

Per this protocol, if any prior planning document, README, or comment
conflicts with what the current source code actually does, **the source
code wins**. This very document set (`docs/project/`) was written by
directly inspecting `core/`, `ui/`, and `index.html` as they exist in this
package, not by trusting any earlier documentation or memory of previous
builds.
