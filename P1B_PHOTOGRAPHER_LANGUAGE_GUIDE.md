# EPIC 2E-P1B — Photographer Language Guide

Rules the interpretation engine (`photographer-interpretation-engine.js`)
and renderer (`ui/single-image-report-renderer.js`) follow so the
primary report reads as a photographer would want, not as an engineer's
debug dump.

## 1. Two kinds of language, always separated

Every section separates **observation** (what the evidence shows) from
**recommendation** (what to consider changing). They render in visually
distinct groups; observation text never contains an imperative ("do
X"), and recommendation text never claims certainty about the image
itself ("this is overexposed") — it frames the option ("consider
recovering highlights").

Example (`whiteBalance`):
- Observation: "สีเขียวที่พบส่วนใหญ่มาจากพื้นหลัง ไม่ใช่ค่าความสมดุลแสงขาว" /
  "The detected green is mostly background color, not a white-balance
  reading."
- Recommendation (only when confidence genuinely warrants it): "ตรวจสอบ
  สมดุลแสงขาวด้วยตนเองหากต้องการความแม่นยำสูง" / "Review white balance
  manually if high precision matters here."

## 2. No unexplained engineering jargon in the primary view

Terms like "histogram P95," "K-Means centroid," "confidence fusion
coefficient," or "Worker task code" never appear in the primary report
UI. Where the underlying evidence is useful to show, it is translated:
"95% of pixels fall below this brightness" instead of "P95." Raw values
are available only inside the collapsed **Advanced Diagnostics**
section (`report.diagnostics`), clearly labeled as technical detail, and
are never required reading to understand the report.

## 3. Required white-balance safety phrasing (verbatim, both languages)

When neutral-point evidence is too weak to trust a white-balance
reading (`whiteBalance.lowNeutralConfidence` warning code):

- Thai: "ความมั่นใจในการประเมินสมดุลแสงขาวอยู่ในระดับต่ำ เนื่องจากไม่พบพื้นที่สีกลางที่เพียงพอ"
- English: "White-balance confidence is low because insufficient
  neutral areas were found."

This exact phrasing is set verbatim in `ui/i18n/th.js` and `ui/i18n/en.js`
under `report.warnings.whiteBalance.lowNeutralConfidence`, per the
spec's explicit requirement.

## 4. Technical issue vocabulary (9 codes implemented)

Only emitted when the specific evidence precondition is met — see
`P1B_EVIDENCE_TO_REPORT_MAP.md` §4 for what "supports it" means per
code. All titles/descriptions/recommendations resolve through
`report.issues.<code>.{title,description,recommendation}` i18n keys.

| Code | Severity | Trigger evidence |
|---|---|---|
| `HIGHLIGHT_CLIPPING` | WARNING (CRITICAL if >15%) | `stats.clipping.highlights` above threshold |
| `SHADOW_CRUSH` | WARNING (CRITICAL if >15%) | `stats.clipping.shadows` above threshold |
| `LOW_DYNAMIC_RANGE` | WARNING | `stats` dynamic-range stops below threshold |
| `HARSH_CONTRAST` | CAUTION | `stats` contrast measure above threshold |
| `FLAT_MIDTONES` | INFO | `stats` contrast measure below threshold |
| `EXCESSIVE_SATURATION` | CAUTION | `hsl`/`stats` average saturation above threshold |
| `WB_LOW_CONFIDENCE` | CAUTION | `wb.confidence` below threshold |
| `DOMINANT_COLOR_BIAS` | CAUTION | `colorCast` dominant-background evidence |
| `LOW_SKIN_CONFIDENCE` | CAUTION | `skin` present but `skin.confidence` below threshold |

`NOISE_RISK` and `SHARPNESS_RISK` from the spec's category list are
**not** emitted in P1B: no existing Core evidence key in this codebase
currently measures noise or sharpness, and the spec's own rule
("only generate an issue when evidence supports it") forbids fabricating
one. This is a deliberate, documented omission — not an oversight — and
is called out again in `P1B_RELEASE_NOTES.md`'s known limitations.

## 5. Creative characteristics (not issues)

`buildCreativeCharacteristics` tags style-descriptive, non-corrective
observations — `HIGH_KEY`, `LOW_KEY`, `VIVID_COLOR`, `MUTED_COLOR`,
`WARM_MOOD`, `COOL_MOOD`, `HARMONIOUS_PALETTE` — rendered separately from
`technicalIssues` specifically so a deliberate high-key or vivid
creative choice is never presented alongside "problems to fix."

## 6. Required UI labels (present in both `ui/i18n/en.js` and `ui/i18n/th.js` under `report.*`)

Title, waiting/partial/unavailable notices, section titles per the 7
`ANALYSIS_SECTION_IDS`, confidence level labels, section status labels,
severity labels, Advanced Diagnostics title, and the full observation/
recommendation/warning/issue text catalog (~145 keys per language) — see
the `report:` block added to each i18n file for the complete key list.

## 7. Stable keys, not hardcoded paragraphs

Every string the builder or interpretation engine emits is `{code,
params}`, never a template-interpolated sentence. The renderer resolves
`t('report.<prefix>.<code>', params, lang)` at render time. This is what
makes a language change a pure re-render (no rebuild, no analysis rerun)
— verified by P1B test cases 24-26.
