# P1G / P1F / P1E Coordination Policy

## Composition order (frozen)

```
Evidence  →  P1F Basic Tone Plan  →  P1E Color Plan  →  P1G Detail Plan  →  canonical Candidate validation  →  UI  →  XMP
```

This is the same "pipeline order is frozen; new capabilities go inside
existing stages" convention this project has followed since P1E — P1G
adds a new stage at the correct point rather than reordering anything
already built.

## Why Detail runs after Basic Tone (P1F), not before or independently

`buildDetailPlan()` accepts two already-final P1F values as read-only
inputs: `p1fTexture` (`candidate.basic.texture`) and `p1fClarity`
(`candidate.basic.clarity`). Both are Detail-adjacent adjustments (they
affect perceived sharpness/microcontrast) computed independently by
P1F's own evidence-driven planner. P1G reads them purely to avoid
double-applying detail enhancement — if P1F already pushed Texture/Clarity
up for a genuinely detailed scene, P1G's own Sharpening pressure is
correspondingly reduced (test 21) — never to recompute or override
P1F's own values.

## Why Detail runs after Color (P1E), not before

No functional dependency exists between Color and Detail; the ordering
is a matter of following the established convention (P1E already runs
after P1F) and keeping the composition list append-only, matching how
P1F itself was added after P1E in the P1E R3 → P1F transition.

## Ownership boundaries (structurally enforced, not just documented)

| Field | Owner | P1G's relationship |
|---|---|---|
| `candidate.basic.*` | P1F | Read-only (texture/clarity only); never written |
| `candidate.hsl` / `.grading` / `.cal` | P1E | Never read or written |
| `candidate.whiteBalance.*` | Pre-existing WB pipeline | Never read or written |
| `candidate.detail.sharpening` / `.noiseReduction` | **P1G** | Owned exclusively |
| `candidate.detail.colorNoiseReduction` | Pre-existing hardcoded literal | Never touched by P1G |

`buildDetailPlan(evidence, opts)` takes no `candidate` parameter at
all, which makes the "P1G never writes to P1F/P1E fields" guarantee a
structural property of the function signature, not a convention that
could silently be violated by a future edit. Test 39 additionally
confirms P1F/P1E-owned fields remain populated (by their own planners)
after a full session build with P1G engaged.

## Regression discovered and fixed by this coordination

`qa/epic-2e-p1c-candidate-test.mjs`'s pre/post equivalence check (test
53) previously assumed only P1F-owned Basic fields could legitimately
diverge from the raw preset passthrough. P1G's `sharp`/`noise` fields
now intentionally diverge too, so `P1G_OWNED_DETAIL_KEYS` was added to
that check's exclusion set — a real, expected regression this EPIC's
own composition-order change correctly surfaced, not a bug in P1G's
integration. See `P1G_MODIFIED_FILES.md`.
