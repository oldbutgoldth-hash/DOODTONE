# P1I Browser QA Attempt — Honest Scope

**Date:** 2026-08-04
**Scope attempted:** Live Chromium verification of the P1I Advanced Diagnostics UI extension (pixel multi-estimator White Balance panel) against `index.html`, in the same manner used successfully in several earlier EPIC rounds of this project (e.g. R3 Phase B1's system-Chromium CDP approach).

## What was tried, in order

1. **Playwright's own bundled browser download.**
   `python3 -m playwright install chromium` (and `--with-deps`) both failed:
   - `--with-deps` failed because the sandbox's `sudo` is configured with the `no new privileges` flag set, which blocks the dependency-installer's privilege escalation (`sudo: The "no new privileges" flag is set, which prevents sudo from running as root.`).
   - Without `--with-deps`, the browser binary download itself failed: `Download failed: server returned code 403 body 'Connection blocked by network allowlist'` against `cdn.playwright.dev`. This sandbox's network allowlist does not include Playwright's CDN.

2. **A system-installed Chromium/Chrome binary**, which prior rounds of this project (notably R3 Phase B1) were sometimes able to find and drive directly via CDP without needing Playwright's own download. A full filesystem search (`find / -iname "*chromium*" -o -iname "*chrome*"`, `dpkg -l | grep chrom`) found no browser binary anywhere on this machine — only unrelated package leftovers (bash-completion scripts, `libchromaprint1` audio library, which is unrelated to browsers). `snap` is not installed either.

3. **A previously-cached Playwright browser** from an earlier EPIC round in this long-running project (in case one had persisted in `~/.cache/ms-playwright`). The cache directory exists but is empty aside from a `.links` bookkeeping folder — no browser binaries are present.

**Conclusion: live browser verification is not possible in this sandbox instance.** This is a sandbox/environment limitation, not a defect in the P1I implementation, and matches the documented finding in most prior rounds of this same project.

## Fallback verification performed instead

Since pixel-level rendering in an actual browser could not be exercised, the following static/structural checks were run against the real production files (no re-implementation, no mocking of production logic):

- `node --check` on every P1I-touched file: all 10 new estimator modules (`core/single-image/white-balance-estimators/*.js`), the updated `wb-evidence-extractor.js`, `single-image-analysis-profile.js`, `single-image-orchestrator.js`, `single-image-session.js`, `ui/app.js`, `ui/i18n/en.js`, `ui/i18n/th.js` — all pass with no syntax errors.
- A real ESM `import()` smoke test (not just `node --check`, per this project's own established convention that `node --check` alone can miss comment-block/brace corruption from edits) against all 13 P1I-related modules — all imported cleanly with no runtime import-time errors.
- The full 98/98 automated test suite (`qa/epic-2e-p1i-pixel-multi-estimator-wb-test.mjs`) exercises the real production estimator math, ensemble policy, P1H evidence extraction, and Advanced Diagnostics trace events end-to-end in Node against real pixel-array fixtures — this is the closest available substitute for interactive browser verification and is the primary evidence of correctness for this round.

## What remains unverified

The following can only be confirmed by an actual browser render, and are NOT covered by the Node-side checks above:
- Visual layout/overflow of the new Advanced Diagnostics pixel-estimator panel at different viewport widths (desktop/mobile).
- Real `<canvas>`/`ImageData` sampling behavior on an actual decoded photo (the automated suite uses synthetic in-memory pixel-array fixtures, not a real decoded image file).
- Any interaction/event-wiring bugs in the DOM (click handlers, collapsible sections) for the new panel.

This gap is disclosed here rather than silently assumed passing, per this project's standing documentation-honesty convention.
