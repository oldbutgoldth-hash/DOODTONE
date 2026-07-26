# 24 — Full-System I18N + Cross-Layer Honesty (R1)

**EPIC 2E-J — FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1.**

This document explains, in plain language (English + Thai), what
changed in this round: the language switch became a real,
state-preserving, application-wide switch, and four cross-layer
honesty defects in the Visual Preview / Data Comparison / Review /
Summary layers were fixed. It assumes you have already read doc 22
(the daily workflow) and doc 23 (the Controlled V2 preview + Human
Review guide).

## 0. The one-sentence summary / สรุปหนึ่งประโยค

**EN:** Switching the language pill now actually re-renders every
visible section of the app from its own already-computed state — never
by re-running Analysis, never by touching Mapping/XMP/Production — and
four places where the app's own numbers, warnings, or labels quietly
contradicted each other now say the same true thing everywhere.

**TH:** การกดสลับปุ่มภาษาตอนนี้จะแสดงผลใหม่ในทุกส่วนที่มองเห็นได้ของ
แอปจริง ๆ โดยอ้างอิงจากสถานะที่คำนวณไว้แล้วเท่านั้น — ไม่มีการรัน
Analysis ใหม่ ไม่แตะต้อง Mapping/XMP/Production เลย — และอีก 4 จุดที่
ตัวเลข คำเตือน หรือป้ายกำกับของแอปเคยขัดแย้งกันเองอย่างเงียบ ๆ ตอนนี้
พูดสิ่งที่เป็นจริงเหมือนกันทุกที่แล้ว

## 1. The four defects, before and after

| # | Defect | Before | After |
|---|---|---|---|
| 1 | Language switch was cosmetic | `setLang()` only updated `state.lang`, `localStorage`, and pill border/background styling — every already-rendered section (Review Console, Data Comparison, Visual Preview Comparison, Interactive Before/After, Preview Observation, Session Summary) kept showing the OLD language until its own workflow re-triggered | `setLang()` now calls `rerenderCurrentUiForLocale()`, which re-renders all 5 section groups from their own already-stashed state (`state.last*State`) — genuinely instant, whole-app language switch, verified to never re-run Analysis or touch Mapping/XMP (see §3) |
| 2 | Data Comparison could contradict Visual Preview | The side-by-side numeric comparison table could describe a different resolved state than what the Visual Preview canvases were actually showing | A single resolved-visual-state builder feeds both displays; Data Comparison always describes what Visual Preview is honestly showing right now |
| 3 | Misleading automatic-evidence warning | A warning implied automated evidence alone could clear a review item that structurally requires a human look | Warning wording now distinguishes what automated evidence *can* and *cannot* substitute for, matching the real 6-manual/4-system-verified split from doc 23 |
| 4 | Production Write showed "Unknown" despite safe evidence | Even when every safety signal was explicitly favorable, the Production Write status field could still read "Unknown" | Production Write now reads its status from the same explicit evidence object the rest of the Review Console already trusts, so a genuinely safe, fully-evidenced state reads as safe — never invented, never guessed |

## 2. The i18n architecture

- **One centralized module, `ui/i18n/index.js`.** Every renderer and
  controller reads user-facing text through `t(key, params, locale)` —
  a dotted key path (`'app.languageChanged'`), optional `{{param}}`
  interpolation, and the requested locale. English is always the
  fallback; a genuinely missing key (absent from both `en.js` and
  `th.js`) returns the literal key string rather than throwing or
  rendering blank, and is recorded once in a bounded diagnostic list —
  never silently swallowed, never crashes.
- **Two flat dictionaries, `ui/i18n/en.js` and `ui/i18n/th.js`.**
  397 leaf keys each, verified byte-for-byte parity by a permanent
  regression test (see §3) — every key path in one file exists in the
  other, and every leaf value is a plain string (no markup).
- **Skeleton/metadata separation, extended for i18n.** Every renderer
  already built its static DOM structure once (`ensure*Layout`) and
  only updated metadata on each `render*()` call. This round gave every
  translatable static element a stable id and added an
  `_applyStaticSkeletonTranslations(container, lang)` helper, called at
  the top of every `render*()`, so re-translating text never rebuilds
  or touches a canvas.
- **State-preserving re-render, `rerenderCurrentUiForLocale()`.** Lives
  in `ui/app.js`, called from `setLang()`. Re-invokes each visible
  section's own renderer using only already-stashed state
  (`state.lastIbaState`, `state.lastObservationState`,
  `state.lastVisualPreviewComparisonState`,
  `state.lastObservationContextInfo`) — never re-decodes the image,
  never re-runs Analysis, never rebuilds a Render Plan, never touches
  Mapping/XMP/Production. Each of the 5 section re-renders is wrapped
  in its own `try`/`catch` so one section's failure can never block or
  hide another, and can never leave `state.lang` un-applied (that
  assignment, plus `localStorage` and pill styling, happens
  unconditionally before the re-render is even attempted).
- **A dedicated announcement.** A persistent `aria-live="polite"`
  region (`langChangeLiveRegion`, distinct from the existing Review
  Console and Build-V2 live regions so announcements can never race
  each other) announces the switch using the centralized i18n text
  itself (`app.languageChanged`), never a hardcoded literal.

## 3. Evidence

- `qa/epic-2e-j-i18n-module-static-test.mjs` — 17/17 PASS. Real-runtime
  (not source-pattern) proof of the i18n module's own contract:
  `normalizeLocale()` never throws and always resolves to `en`/`th`;
  `t()` resolves known keys correctly in both locales; a genuinely
  missing key never throws, never blanks, and is recorded exactly once
  in the bounded diagnostic; `{{param}}` interpolation handles
  string/number/object/missing params correctly; `formatCount()`
  degrades gracefully; and the EN/TH dictionaries have identical
  397-leaf-key parity with every leaf a real string.
- `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` — 21/21 PASS.
  The regression guard specifically for Defect 1: proves `setLang()`
  applies `state.lang`/`localStorage`/pill styling BEFORE attempting
  any re-render, calls `rerenderCurrentUiForLocale()` in its own
  try/catch, and announces through the dedicated live region; proves
  `rerenderCurrentUiForLocale()` re-renders all 5 required section
  groups (each in its own isolated try/catch, each reading only from
  stashed state, each gated on its own layout-built flag); and proves
  — by an explicit forbidden-call-name scan — that it never calls
  `runAnalysis()`, any decode/render-plan/XMP-serialization function,
  or any file/network API. Also covers the one last-resort
  catch-path fallback message (Interactive Before/After's own
  preparation failure) now sourcing from `t('beforeAfter.statusMessage.failed', ...)`
  instead of a raw hardcoded English literal — this was the single
  documented deviation earlier in this round and is now a completed
  fix with its own regression check, not just a disclosed gap.
- Both new suites are wired into `qa/run-static-suites.mjs`
  (`npm run test:static`), which is itself Step 3 of
  `npm run test:local-gate` — every future change to this project runs
  them automatically.
- Fake-DOM smoke verification (ad hoc, not persisted as a permanent
  file, since the renderer modules reference the browser's global
  `document` directly and this sandbox has neither Chromium nor a real
  DOM available) confirmed `renderVisualPreviewComparison`,
  `renderInteractiveBeforeAfterStatus`, and
  `renderInteractivePreviewObservationV2`/session-summary render
  correctly, with no exceptions, in both English and Thai across
  multiple state combinations.
- Full project regression: `npm run test:static` → **21/21 PASS** on
  the new suites, **all suites PASSED** project-wide, zero regressions
  introduced anywhere else in the 21+ suite static regression set.
  `npm run test:local-gate` was also run in full: Steps 1–3 (syntax,
  Focused Core, static suites) PASS; Steps 4–12 (real-Browser suites)
  honestly report `BROWSER_BINARY_UNAVAILABLE` and fail closed, because
  this sandbox has no installed Chromium binary and this session's
  network allowlist blocks downloading one (`npx playwright install
  chromium` returned `403 Connection blocked by network allowlist`) —
  this is the same, previously-documented environment constraint every
  prior round in this exact sandbox has hit, not a regression
  introduced by this round's work, and `test:local-gate` is
  specifically designed to fail closed rather than fabricate a PASS
  when a real Browser cannot be reached.

## 4. What did NOT change (production locks, unchanged per the spec)

Production source remains Legacy; Controlled Test stays disabled;
`allowProductionWrite=false`, `allowExport=false`,
`appliedToProduction=false` throughout; no Controlled V2 value ever
enters Mapping/XMP; no Preview export; no persistence beyond page
memory; no network upload; safety thresholds unchanged; the public
version string remains v1.1.9 / EPIC 2E-I. Nothing in this round
touches `core/*` engines, the XMP serializer, or the production write
path — only `ui/i18n/*` (new), `ui/app.js`'s `setLang`/
`rerenderCurrentUiForLocale`/render-call sites, the four affected
renderer files' text sourcing, and `index.html`'s new live-region
element.
