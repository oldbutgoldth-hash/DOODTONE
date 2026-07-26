# LUMIXA AI — QA Report R5

## Scope

Final locale closure, code-based Core presentation, locale-neutral browser QA and fail-closed local acceptance for EPIC 2E-J R5.

## Test environment

- Browser: Chromium 144.0.7559.96
- Executable: `/usr/bin/chromium`
- Main browser harness: in-memory LUMIXA harness
- Required local gate: `npm run test:local-gate`
- Deployment tests: not run; this release was not deployed

## Required acceptance results

| Area | Result |
|---|---:|
| ESM syntax | 149/149 PASS |
| Focused Core | 31/31 PASS |
| Static suites | PASS |
| R5 semantic presentation static | 13/13 PASS |
| In-Memory startup | 22/22 PASS |
| Upload baseline | 18/18 PASS |
| Live App | 51/51 PASS |
| Observation Smoke | 64/64 PASS |
| Step 7B-A | 54/57 PASS; 0 FAIL; 3 NOT_APPLICABLE |
| Step 7B-B | 183/184 PASS; 0 FAIL; 1 NOT_TESTED: Physical touch hardware |
| Decoder geometry | 39/40 PASS; 0 FAIL; 1 NOT_APPLICABLE |
| Full-app eligible geometry | 98/99 PASS; 0 FAIL; 1 NOT_APPLICABLE |
| Controlled V2 Browser | 58/58 PASS |
| Full-system i18n Browser | 74/74 PASS |
| Local Gate | 13/13 required steps PASS |

## Precise i18n audit design

The browser suite audits these 18 required regions independently:

1. App header
2. Primary navigation
3. Right sidebar
4. App footer
5. Language control
6. Upload area
7. Analysis summary
8. Analysis tabs and controls
9. Support panel
10. PromptPay modal
11. USDT modal
12. Review Console
13. Data Comparison
14. Visual Preview
15. Before/After
16. Observation
17. Session Summary
18. Whole-body aggregate safety net

Each required region records `found`, `executed` and `visibleNodeCount`. Expected visible regions fail closed when missing or when `visibleNodeCount` is zero. Hidden modals are opened and audited rather than silently skipped.

### Final locale results

- Thai Review Console visible English leaks: 0
- Thai Data Comparison visible English leaks: 0
- Thai App/Analysis visible English leaks: 0
- Thai whole-body aggregate leaks: 0
- English visible Thai fragments: 0
- Unresolved template tokens: 0
- English fallback keys: 0
- Missing keys: 0

## Semantic presentation verification

- Known Analysis labels, clamp/strategy values and summary fields are localized from semantic codes.
- Known Core comparison dimensions, evidence, reasons, recommendations and rollback instructions are presented through stable codes/IDs.
- Unknown raw diagnostics are not shown as main photographer-facing prose.
- Raw technical values may remain only in collapsed Developer Details.
- Masked identifiers, payment values, URLs, emails and approved technical identifiers are not misclassified as prose leaks.

## Locale-neutral QA verification

- Live App reads the resolved translation mode, rendered state, visualized adjustment count, preview honesty and Production locks from semantic state/attributes.
- Step 7B-B reads Session Summary counters and canonical reason codes from the QA snapshot rather than localized text.
- Only Physical touch hardware remains NOT_TESTED in Step 7B-B.

## Live-region locale stability

Durable announcement state uses:

```text
{
  code,
  params,
  category,
  generationId
}
```

Current visible status is re-presented for the selected locale without rerunning Analysis, rebuilding V2, resetting Review, resetting the Before/After split, resetting Observation/Session or changing Production/XMP state.

## State and XMP invariants

- TH → EN → TH changed bounded fields: 0
- Analysis generation unchanged during locale switching
- Review status and note preserved
- Controlled V2 mode/render state preserved
- Before/After split preserved at 73
- Observation, Reasons and Session preserved
- Production source remains `legacy`
- Production write remains disabled
- XMP before/after length: 2962 / 2962
- XMP SHA-256 before/after: `e233c999fb009133d8ee3e4d627e2f97c79e3ddd32144f42038a019004222923`
- Exact XMP text equality: PASS

## Runtime errors and network

- Page errors: 0
- Console errors: 0
- Unexpected in-memory network requests: 0

## Optional legacy virtual-origin diagnostic

The optional `http://lumixa.test` virtual-origin smoke was blocked by the sandbox before route interception with `ERR_BLOCKED_BY_ADMINISTRATOR`. This is recorded honestly in its result JSON and is not treated as a Product PASS. The required in-memory replacement passed 22/22, and the R5 Local Gate passed all 13 required steps.

## Final decision

PASS for the defined R5 local-first acceptance scope. No deployment was performed.
