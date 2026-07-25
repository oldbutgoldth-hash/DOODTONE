# 22 — Local-First Daily Development Workflow

**LOCAL-FIRST GEOMETRY R3 — Phase H.**

This document is the everyday, Windows-desktop workflow for developing
LUMIXA AI locally, testing it locally, and deploying to Preview only
once per day. It assumes no prior context beyond a working Windows PC
with Node.js installed.

## 0. The 11-step Windows daily workflow, at a glance

 1. `npm install`
 2. Install Playwright's Chromium once (`npx playwright install
    chromium`), OR set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an
    already-installed Chrome/Chromium executable on your machine.
 3. `npm run dev`
 4. Open `http://localhost:4173/?qa=1`
 5. Manually test a real photo (see the checklist in §5)
 6. `npm run test:local-gate`
 7. Commit locally during the day as you go
 8. Push a Preview branch once, near the end of the day
 9. Set `LUMIXA_DEPLOY_URL` to that Preview URL
10. `npm run test:deploy`
11. Promote to Production only after that passes

The rest of this document expands each of these steps.

## 1. One-time setup (Windows)

1. Install [Node.js](https://nodejs.org) (LTS). Verify:
   ```
   node --version
   npm --version
   ```
2. Open a terminal (PowerShell, Command Prompt, or a terminal inside
   your editor) in the project folder.
3. Install dependencies:
   ```
   npm install
   ```
   This installs `playwright` (dev-only — never shipped, never part of
   the deployed static site) into `node_modules/`.
4. Install a real Chromium binary for Playwright to drive (only needed
   once, and only for the Browser suites — everyday static/syntax
   checks never need this):
   ```
   npx playwright install chromium
   ```
   If your machine already has Google Chrome or a system Chromium
   installed, the test suites will auto-detect and use it instead —
   see `qa/helpers/playwright-lumixa-test-runtime.mjs`'s
   `detectBrowserExecutable()` (checks the Playwright-bundled path,
   then `/usr/bin/chromium`, `/usr/bin/google-chrome`, etc., or an
   explicit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` environment variable
   you can set yourself if it lives somewhere else on your machine).

## 2. Everyday inner loop

While actively working on a change:

1. Start the local dev server:
   ```
   npm run dev
   ```
   This runs `tools/local-static-server.mjs` — a dependency-light
   static file server (no build step) at **http://localhost:4173/?qa=1**.
   For the current LAN workflow, run `npm run dev:lan`; it binds to
   `0.0.0.0:3000` and prints the real computer-LAN URL, such as
   **http://192.168.1.105:3000/?qa=1**. The server sends `Cache-Control:
   no-store`, so refreshes show the current source instead of an older
   browser-cached module.
   The `?qa=1` query flag enables the app's own bounded QA
   diagnostics hook (`window.__LUMIXA_QA__`), used by every automated
   suite and useful for manual poking in DevTools too. Press **Ctrl+C**
   to stop it cleanly.
2. Open that URL in your real desktop browser and use the app normally
   — upload a photo, watch Analysis run, review the preview.
3. After making a code change, run the fast checks (no Browser/Chromium
   needed, seconds not minutes):
   ```
   npm run test:syntax
   npm run test:static
   ```
   `test:syntax` is the real ES-module syntax gate
   (`tools/esm-syntax-gate.mjs`) — it uses a genuine ESM parse goal
   (`vm.SourceTextModule`), which is what actually catches defects like
   a duplicate `const` in the same scope. Plain `node --check` does
   **not** reliably catch this defect class in this project — that gap
   is exactly what caused a real shipped regression this round, and is
   why `test:syntax` exists as its own explicit step rather than being
   assumed covered by habit.
4. Before committing or ending a work session, run the full local gate:
   ```
   npm run test:local-gate
   ```
   See §3 below for exactly what this does and how to read its output.

## 3. `npm run test:local-gate` — the real local pre-commit/pre-deploy gate

This is the one command that should never be skipped before calling a
change "done" locally. It runs, **in this exact order**, and prints a
clear PASS/FAIL summary at the end:

 1. ESM syntax (`tools/esm-syntax-gate.mjs`)
 2. Focused Core (`qa/epic-2e-j-focused-core-smoke-test.mjs` — plain-Node
    import smoke test of all 30 `core/*/index.js` analysis engines)
 3. Static suites (`qa/run-static-suites.mjs` — every no-Browser
    self-test in the project)
 4. In-Memory startup (`qa/playwright-in-memory-app-smoke.mjs`)
 5. Upload baseline (`qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs`)
 6. Live App (`qa/epic-2e-j-phase-c-live-app-test.mjs`)
 7. Observation Smoke (`qa/epic-2e-j-phase-c-observation-smoke-test.mjs`)
 8. Step 7B-A (`qa/epic-2e-j-phase-c-step7b-a-test.mjs`)
 9. Step 7B-B (`qa/epic-2e-j-phase-c-step7b-b-test.mjs`)
10. Decoder/render geometry — Phase C1 (`qa/epic-2e-j-preview-geometry-decoder-render-test.mjs`)
11. Full-app safety-eligible geometry — Phase C2 (`qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs`)

It exits **non-zero** (fails) if any of the following is true:
- any required suite reports a FAIL
- Chromium/Playwright is unavailable in the current environment (steps
  4–11 need a real Browser; if none is resolvable, the gate fails
  rather than silently skipping — this is a fail-closed design, not a
  bug, and it is exactly why step 3 above matters: install a real
  Chromium via `npx playwright install chromium`)
- a suite's result JSON is stale (its recorded `sourceHash` no longer
  matches the current on-disk source files) or malformed
- the Upload baseline suite's own upload step did not execute/PASS
- the Phase C2 suite's V2-render, Exact-dimensions, or Observation-
  enabled assertions were not proven PASS

The **only** permitted `NOT_TESTED` row anywhere in the whole gate is
the single, explicitly documented "Physical touch hardware" item inside
Step 7B-B (a real touchscreen device cannot be simulated by an
automated Browser run) — any other `NOT_TESTED` row anywhere is treated
as a failure, never silently accepted.

### Two things this is deliberately NOT

- `npm run test:browser` / `npm run test:browser:report` are a
  **separate, non-blocking** way to eyeball every Browser suite's own
  results JSON without the strict staleness/completeness checks
  `test:local-gate` applies. `test:browser` (no flag) now itself exits
  non-zero if any suite failed; `test:browser:report` (with `--report`)
  is the old always-exits-0 variant, kept only for casual inspection —
  **never use `test:browser:report` as a gate**.
- `npm run test:deploy` targets a real **deployed** Preview URL (via
  the `LUMIXA_DEPLOY_URL` environment variable) and is never part of
  the everyday local inner loop — see §4.

## 4. Deploying (once per day)

1. Make sure `npm run test:local-gate` passes cleanly first. Deploying
   on top of a failing local gate is exactly the pattern this workflow
   exists to prevent.
2. Push/deploy to your Preview environment however you normally do
   (Vercel, Netlify, etc. — this project has no custom deploy step of
   its own beyond serving the static files).
3. Once the Preview URL is live, run the real Deploy parity check
   against it:
   ```
   set LUMIXA_DEPLOY_URL=https://your-preview-url.example.com
   npm run test:deploy
   ```
   (On PowerShell use `$env:LUMIXA_DEPLOY_URL = "https://..."` instead
   of `set`.) This suite is intentionally gated behind that environment
   variable — it is never run against `localhost`, and it is never run
   as part of `test:local-gate`, since a Preview URL only exists after
   a real deploy has already happened.

## 5. Manual verification checklist (for anything the automated suites
   cannot cover)

Run through this by hand at least once before a release, in a real
desktop browser at `http://localhost:4173/?qa=1`, the LAN URL printed by
   `npm run dev:lan`, or your deployed
Preview URL), using a real photo (not a test fixture):

- [ ] **First upload** — Analysis completes, Preview looks correct.
- [ ] **Re-analyze** — clicking Re-analyze on the same photo produces a
      fresh generation, no stale geometry left over from the first run.
- [ ] **Second upload** — uploading a different photo cleanly replaces
      the first; no visual or geometric trace of the first photo remains.
- [ ] **Portrait** — a real portrait-orientation photo from a phone
      camera displays right-side-up with correct dimensions.
- [ ] **Landscape** — a real landscape-orientation photo displays
      correctly.
- [ ] **EXIF rotation** — a photo taken with the phone physically
      rotated (so its EXIF Orientation tag is 3, 6, or 8, not 1)
      displays right-side-up, not sideways or upside-down.
- [ ] **V2 Preview** — the V2/Controlled preview renders (or shows a
      truthful Identity Preview when there are no supported adjustments).
- [ ] **Exact dimensions** — the Interactive Before/After alignment
      indicator reads "Exact dimensions", not "Blocked geometry" or
      "Not evaluated".
- [ ] **Observation** — the Observation controls become enabled and a
      value can be selected (mouse and keyboard both).
- [ ] **Console errors** — open DevTools, confirm zero red console
      errors throughout the whole session above.
- [ ] **XMP** — the exported XMP file downloads and opens correctly in
      Lightroom (or your target application), and is unchanged by
      selecting an Observation value.

Two further checks worth doing at least once per release, beyond the
required list above:
- [ ] Tab through the entire Review Console and Observation controls
      using only the keyboard — confirm focus is always visible and
      the tab order is sensible.
- [ ] If you have access to a touchscreen device, confirm every button
      and control is comfortably tappable (this is the one item every
      automated suite in this project honestly reports as
      `NOT_TESTED` — it can only be confirmed by hand).
