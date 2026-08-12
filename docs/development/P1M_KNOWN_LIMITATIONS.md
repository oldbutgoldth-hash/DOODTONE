# EPIC 2E-P1M — Known Limitations

1. **No per-module override.** Strength mode is one global dial across
   all six Intelligence layers. A user cannot, for example, ask for
   Dramatic Color but Natural White Balance from this UI. Each
   module's plan-builder function already accepts an independent
   `strengthMode` argument, so a future per-layer control is additive
   (no architecture change needed) — just not built in this round.

2. **Only 3 tiers.** `color-intelligence-schema.js` internally supports
   a 4th tier (CINEMATIC) reachable only via direct API calls, never
   from this UI. This was a deliberate scope decision (see
   `P1M_STRENGTH_MODE_AUDIT.md` §3), not an oversight.

3. **No live preview scrubbing.** Changing Strength mode rebuilds the
   Candidate and re-renders the sliders/diagnostics, but does not
   redraw the Before/After preview canvas. That canvas continues to
   reflect whatever the last explicit "Build Preview" action produced
   from prior EPICs; Strength-mode changes are visible in the
   slider/diagnostics panels immediately, and in the canvas only after
   the user re-triggers the existing preview build action.

4. **No Report surfacing yet.** `candidate.diagnostics.strengthMode` is
   recorded but not yet read by `session.report` or the P1B Report
   renderer — a future round could add "Style transfer applied at
   Dramatic strength" to the plain-language report, but this round
   scoped strictly to the sliders/diagnostics UI per the four
   originally-selected P1M priority items.

5. **Browser QA not run this round.** No Chromium/Playwright execution
   was available in this environment for P1M; all verification is
   against real production modules executed directly in Node (see
   `P1M_QA_REPORT.md` §5). A future round should add the standard
   8-scenario Browser QA pass once a Chromium-capable environment is
   available.

6. **Pre-existing comment-parsing landmine in this project's own QA
   tooling (not a P1M defect).** Several structural-check test files in
   this project strip `//` and `/* */` comments from `ui/app.js` via a
   simple regex before searching for real call sites. A pre-existing
   line comment from the P1A era ("`// core/single-image/*.js).`")
   contains a literal "/*" substring inside what is actually a `//`
   comment, which the block-comment-stripping regex misinterprets as
   an opening block comment and swallows a stretch of otherwise
   legitimate code from its regex-stripped view. This has no runtime
   effect (the file itself is syntactically correct JavaScript,
   verified via `node --check` and real ESM `import()`) — it only
   affects test files that build a comment-stripped copy of the source
   for pattern matching. `qa/epic-2e-p1m-strength-mode-test.mjs`
   checks 31/32 were written against the raw, unstripped source
   specifically to avoid this landmine; any future structural check
   added against `ui/app.js`'s comment-stripped text in the
   lines-roughly-70-to-900 range should be aware of this and verify
   against the raw source instead.
