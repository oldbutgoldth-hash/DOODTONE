# 24 — Full-System EN/TH Language Guide

**EPIC 2E-J — FULL-SYSTEM I18N COMPLETION R2.**

This is the reference for how English/Thai works across LUMIXA AI: how
to add a translation, which terms intentionally stay English, how Core
codes become localized UI, what the language switch guarantees, and how
the automated tests keep all of it honest.

## 0. One-sentence summary / สรุปหนึ่งประโยค

**EN:** Every photographer-facing string now comes from one central
dictionary keyed by stable codes and IDs — never from Core's English
prose — so switching to Thai translates the whole app instantly without
re-running Analysis or changing a single exported value.

**TH:** ข้อความทุกส่วนที่ช่างภาพเห็นมาจากพจนานุกรมกลางเพียงชุดเดียว
ที่อ้างอิงด้วยรหัสและ ID ที่คงที่ — ไม่ได้มาจากข้อความภาษาอังกฤษของ Core —
ดังนั้นการสลับเป็นภาษาไทยจะแปลทั้งแอปทันที โดยไม่ต้องวิเคราะห์ใหม่
และไม่เปลี่ยนค่าที่ส่งออกแม้แต่ค่าเดียว

## 1. Architecture

| Layer | File | Responsibility |
|---|---|---|
| Runtime lookup | `ui/i18n/index.js` | `t(key, params, locale)`, English fallback, bounded missing-key diagnostics, `{{param}}` text-only interpolation |
| English dictionary | `ui/i18n/en.js` | 734 leaf keys |
| Thai dictionary | `ui/i18n/th.js` | 734 leaf keys (exact parity, enforced by test) |
| Domain presenters | `ui/i18n/domain-presenters.js` | Translates **stable domain codes** — review item IDs, risk levels, comparison directions/sides/states/evidence, preview limitation/reason/blocker codes — into localized text |
| App shell | `index.html` + `rerenderAppShellForLocale()` | 86 `data-i18n-key` + 2 `data-i18n-placeholder-key` attributes re-applied on every switch |
| Section re-render | `rerenderCurrentUiForLocale()` in `ui/app.js` | Re-renders all five dynamic sections from already-stashed state |

## 2. How Core codes map to localized UI

Core modules legitimately emit English prose — they are business logic
and their output is part of the stable production contract, so this
round did not change them. The UI therefore **never displays that prose
in Thai mode**. Instead:

1. Core emits a value *plus* a stable code/ID
   (`translationMode`, `approvalState`, review item `id`, dimension
   `id`, `warningCodes`, `reasonCodes`, `blockerCodes`).
2. The UI branches on the **code**, never on the text.
3. `ui/i18n/domain-presenters.js` turns the code into localized text.
4. The raw Core sentence remains available in the collapsed
   **Developer Details** block only.

Concretely, this round added stable code channels where none existed:

- `ui/isolated-visual-preview-renderer-v2.js` now emits
  `warningCodes` / `reasonCodes` (+ `reasonParams`) beside every
  English `warnings` / `reasons` entry.
- `ui/visual-preview-comparison-controller-v2.js` now emits
  `blockerCodes` / `warningCodes` beside every English
  `blockers` / `warnings` entry.

Both additions are **additive** — no existing field was removed or
repurposed, so existing consumers and QA suites keep working.

## 3. Terms that intentionally remain English

Section proper names (`Visual Preview Comparison`, `Data Comparison`,
`Review Console`, `Session Observation Summary`, `Before/After`),
Lightroom panel names (`Color Grading`, `Tone Curve`, `Basic Panel`),
and the core technical vocabulary: `LUMIXA`, `Legacy`, `Controlled V2`,
`Controlled Test`, `XMP`, `Lightroom`, `Adobe Camera Raw` / `ACR`,
`RGB`, `HSL`, `EXIF`, `Canvas`, `Preview`, `Production`,
`Identity fallback`, `Safety-restraint`, `Mapping`, `Sandbox`.

The authoritative list lives in
`qa/i18n/visible-text-audit-allowlist.mjs` and is enforced by test.

Two further documented exemptions:

- `comparison.developer.*` — Developer Details **field identifiers**
  (`selectedProductionSource`, `canRenderV2Preview`, …). These are kept
  as literal field names so a developer can grep them; the spec
  explicitly permits raw diagnostic values to stay technical English
  inside Developer Details.
- `appShell.presetNamePlaceholder` — the default preset **name written
  into the exported .xmp**. Localising it would change real exported
  production output, which this round is forbidden from doing.

## 4. Adding a new translation key

1. Add the key to **both** `ui/i18n/en.js` and `ui/i18n/th.js` at the
   same path. Parity is enforced; a one-sided key fails the build.
2. Read it via `t('your.key', params, lang)` — never build a sentence
   by concatenating translated fragments.
3. For static shell markup, add `data-i18n-key="your.key"` instead.
4. Never hardcode a visible English string in a renderer. Never add a
   local `{ en: '…', th: '…' }` map — those were removed this round and
   the audit will fail if one returns.
5. Never branch business logic on translated text. Branch on the code.

## 5. State-preserving language-switch contract

Switching language re-renders presentation **only**. After any
TH→EN→TH round trip these must be unchanged:

analysis generation ID · file identity token (never the filename) ·
Review statuses/decisions/notes/progress · Controlled V2
`translationMode` and `visualizedAdjustmentCount` · Legacy/V2 render
state · Exact dimensions · Before/After slider value · Observation
selection and reasons · Session summary counts · selected Production
source · exported XMP hash.

And: no Analysis re-run, no file reload/decode, no Controlled V2
rebuild, no Canvas pixel change, 0 page errors, 0 console errors.

## 6. Coverage table

| Section | Source | EN/TH coverage |
|---|---|---|
| App shell / navigation / upload / tips | `index.html` (86 keys) + 2 placeholders | Full |
| Review Console | `ui/review-console-renderer.js` | Full — headings, risk labels/levels, evidence lines, progress, ARIA, reset dialog, rollback, group labels, per-item title/description/help by stable ID |
| Data Comparison | `ui/side-by-side-comparison-renderer.js` | Full — all 15 dimension names + descriptions by ID, risk/direction/side/state/evidence/approval code maps, all field labels |
| Visual Preview | `visual-preview-comparison-renderer-v2.js` (+ isolated renderer & controller code channels) | Full — badges, limitations, reasons, blockers, row labels, both Legacy and V2 panels |
| Interactive Before/After | `interactive-before-after-renderer-v2.js` | Full — titles, badges, guidance, slider ARIA, technical rows, blocked/partial/failure messages |
| Observation + Session Summary | `interactive-preview-observation-*` | Full — options, reasons, context rows, Clear buttons, live-region announcements, counters |
| Canvas analysis renderers | `ui/*-renderer.js` (histogram, palette, HSL, …) | **Not localized this round** — see §7 |

## 7. Honest limitation: Canvas-drawn labels

The analysis Canvas renderers (histogram, palette, HSL analyzer, tone
curve, calibration, harmony, skin tone) draw their axis/series labels
directly onto a `<canvas>` with `fillText`. They do not currently accept
a locale parameter, so **their in-canvas labels remain English**.

Per the spec's explicit instruction, this is documented rather than
silently claimed as complete. Their surrounding section headings, panel
titles and descriptions — everything in the DOM — *are* translated. The
next phase should thread `locale` into those renderers and redraw them
from cached analysis state (never re-running the Analysis engine).

## 8. Automated enforcement

| Test | Guarantees |
|---|---|
| `qa/epic-2e-j-i18n-module-static-test.mjs` | `t()` contract, fallback, interpolation, EN/TH key parity |
| `qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs` | Zero hardcoded visible English prose; bounded, individually-justified allowlist; hostile self-test proves the detector actually catches a planted leak |
| `qa/epic-2e-j-i18n-coverage-report-static-test.mjs` | Runtime key usage: `genuinelyMissingKeys=0`, `englishFallbackKeys=0`; writes `qa/epic-2e-j-i18n-coverage-report.json` |
| `qa/epic-2e-j-xmp-evidence-invariant-static-test.mjs` | The XMP/export-path contradiction is unreachable; XMP evidence is never inferred from `canExportPreview`/`appliedToProduction` |
| `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` | The switch re-renders every section from stashed state and never re-runs Analysis; the app-shell pass is pure |
| `qa/epic-2e-j-full-system-i18n-browser-test.mjs` | The real 13-step Thai workflow, per-section leak audit, TH→EN→TH state invariants, screenshots |

`npm run test:local-gate` runs all of these and fails closed on a
visible English leak, a missing Thai key, an English fallback, a
language-switch state mutation, an XMP evidence contradiction, or any
required Browser suite being unavailable.

## 9. XMP evidence invariant

`buildReviewSystemEvidence()` in `ui/review-console-renderer.js` is the
single canonical projection. `xmpExportPathUnchanged` is derived from
**the same evidence** as the system-verified `export-path-unchanged`
Review item, so this screen is now structurally impossible:

```
Export path unchanged: Passed
XMP Export: Unknown / Not confirmed.
```

It is never inferred from `canExportPreview === false` or
`appliedToProduction === false` — those are different guarantees.
Tri-state throughout: `true` = verified, `false` = explicit anomaly,
`null` = insufficient evidence (never assumed safe).
