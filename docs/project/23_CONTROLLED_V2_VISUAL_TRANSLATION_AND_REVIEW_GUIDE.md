# 23 — Controlled V2 Visual Translation & Human Review Guide

**CONTROLLED V2 VISUAL TRANSLATION R1.**

This document explains, in plain language (English + Thai), what the
Controlled V2 preview actually is, why it looks the way it does, how
the Human Review Checklist works, and exactly what stays unchanged in
Production. It assumes you have already read doc 22 (the daily
workflow) and doc 20 (the Phase C final QA report covering the
Controlled Overlay Preview Sandbox itself).

## 0. The one-sentence summary / สรุปหนึ่งประโยค

**EN:** Controlled V2 is a browser-only, safety-restrained *preview* of
what a more automated pipeline would protect or hold back — it never
touches your exported preset, and it is always honestly labeled as
either a real (but bounded) preview or a truthful "no change available"
Identity preview, never guessed or invented.

**TH:** Controlled V2 คือ *ตัวอย่าง* ที่แสดงในเบราว์เซอร์เท่านั้น
แสดงให้เห็นว่าไพล์ไลน์อัตโนมัติที่ควบคุมความปลอดภัยมากขึ้นจะปกป้องหรือ
ระงับอะไรบ้าง — ไม่แตะต้องพรีเซ็ตที่ส่งออกจริงเลย และจะติดป้ายกำกับอย่าง
ตรงไปตรงมาเสมอ ไม่ว่าจะเป็นตัวอย่างจริง (แต่มีขอบเขตจำกัด) หรือ Identity
Preview ที่บอกตามจริงว่า "ไม่มีการเปลี่ยนแปลงที่รองรับได้" — ไม่มีการ
เดาหรือสร้างค่าขึ้นมาเอง

## 1. Legacy Preview vs Controlled V2 Safety-restraint Preview vs Identity fallback

| | Legacy Preview | Controlled V2 — Safety-restraint | Controlled V2 — Identity fallback |
|---|---|---|---|
| Source of values | The real, already-normalized Legacy adjustment model (the same one that gets exported to XMP) | The SAME Legacy model, with SPECIFIC fields pulled bounded amounts toward zero/toward-safety | The unmodified Legacy model, byte-for-byte |
| Can it invent a new adjustment? | N/A (it *is* the real preset) | **Never.** It can only reduce an existing Legacy value — it can never add an adjustment Legacy didn't already have, never strengthen one, never flip its sign | N/A — nothing changes |
| When does this happen? | Always (this is Production) | When at least one Sandbox restraint action (see §2) produces a real, ≥0.005 change in a field the pixel renderer understands | When every restraint action would change nothing by at least 0.005 — the preview is honestly identical to Legacy |
| `translationMode` value | *(not applicable — this is Legacy, not a V2 mode)* | `'legacy-derived-safety-restraint'` | `'identity-fallback'` |
| Does it affect Production/XMP? | This *is* the Production/XMP source | **No. Never.** Preview-only. | **No. Never.** Preview-only. |

**EN — why V2 doesn't look "AI-generated":** because it isn't. Every
number you see in a Safety-restraint preview started as a real Legacy
value and was only ever pulled a bounded amount toward zero or toward
a safer direction — never invented from nothing. This is intentionally
less dramatic than a full AI re-render; it is a *restraint* preview,
not a *replacement* preview.

**TH — เหตุใด V2 จึงไม่ดูเหมือน "สร้างโดย AI":** เพราะมันไม่ใช่
ตัวเลขทุกตัวที่เห็นในตัวอย่างแบบ Safety-restraint เริ่มต้นจากค่า
Legacy จริง แล้วถูกดึงเข้าหาศูนย์หรือทิศทางที่ปลอดภัยกว่าในขอบเขตที่
จำกัดเท่านั้น — ไม่เคยสร้างขึ้นมาจากความว่างเปล่า สิ่งนี้ตั้งใจให้ดู
ไม่หวือหวาเท่าการเรนเดอร์ใหม่ด้วย AI เต็มรูปแบบ เพราะมันคือตัวอย่าง
แบบ "ยับยั้ง" ไม่ใช่ตัวอย่างแบบ "แทนที่"

## 2. Where the restraint comes from — the abstract actions

The Sandbox's `simulatedPreviewPreset` never contains concrete
Lightroom-style values — only ABSTRACT risk-mitigation actions:
`protect-channel`, `warn`/`block-aggressive-direction`, `cap-intensity`,
`suppress-risk`, `keep-legacy`/`no-action`, plus the structural
`require-human-review` hard stop. The translator maps each action to a
bounded restraint factor applied to specific Legacy fields:

- `protect-channel` (skin protection, C1) → shrinks temperature, tint,
  saturation, vibrance, contrast, clarity toward zero (never more than
  30% of the way).
- `warn` / `block-aggressive-direction` on highlights (C2) → shrinks
  positive highlights/whites/contrast (never more than 35%).
- `warn` on shadows (C3) → shrinks negative shadows/blacks toward zero
  (never more than 35%), never touches positive (recovery) values.
- `warn`/`cap-intensity` on white balance (C4) → shrinks
  temperature/tint magnitude in the SAME direction, never reverses it
  (never more than 55%).
- `cap-intensity`/`suppress-risk` on clarity/dehaze/texture (C5) →
  shrinks positive values only, up to 70%.
- `suppress-risk` on color grading (C6) → shrinks shadow/midtone/
  highlight hue-saturation-luminance triples toward zero, up to 70%.
- `keep-legacy`/`no-action` → the field is left exactly as Legacy has
  it (0% restraint).
- Calibration (C7) and tone-curve/masking (C8) actions are always
  reported as **unsupported** — the pixel renderer has no path for
  them, so they are listed in `unsupportedActions` and never silently
  dropped or faked.
- `require-human-review` (structural) is a **hard stop** — Human
  Review can never override it; the preview becomes honestly
  `unavailable` until it is resolved elsewhere in the pipeline.

## 3. The 10-item Human Review Checklist — 6 manual + 4 system-verified

**EN:** Six items genuinely require you to look at the image — no
automated evidence can substitute for a human actually comparing skin
tones, highlights, shadows, white balance, colour stacking, and the
source image itself. Four items are **system-verified**: they are
re-derived automatically, every time, from real Preview Sandbox facts
(is Production still Legacy? does rollback work? is this preview
confirmed non-production? is the XMP export path unchanged?) — a
manual click can never change these, and they can never get "stuck" on
stale evidence, since nothing about them is cached.

**TH:** หกรายการต้องการให้คุณดูภาพจริง ๆ — ไม่มีหลักฐานอัตโนมัติใดมา
แทนการที่มนุษย์เปรียบเทียบโทนสีผิว ไฮไลต์ เงา สมดุลแสงขาว การซ้อนสี
และภาพต้นฉบับได้ ส่วนอีกสี่รายการเป็น **ตรวจสอบโดยระบบ**: ระบบจะ
คำนวณใหม่ทุกครั้งโดยอัตโนมัติจากข้อเท็จจริงจริงของ Preview Sandbox
(Production ยังคงเป็น Legacy อยู่หรือไม่? การย้อนกลับใช้งานได้หรือไม่?
ตัวอย่างนี้ถูกยืนยันว่าไม่ใช่ Production หรือไม่? เส้นทางส่งออก XMP
ไม่เปลี่ยนแปลงหรือไม่?) — การคลิกด้วยตนเองไม่สามารถเปลี่ยนค่าเหล่านี้
ได้ และจะไม่ค้างอยู่กับหลักฐานเก่า เพราะไม่มีการแคชค่าใด ๆ ไว้เลย

| Group | Items | Who completes it |
|---|---|---|
| Visual inspection | Source image reviewed, Skin tones, Highlights, Shadows, White balance, Colour stacking | **You** — required, never auto-passable |
| System integrity | Legacy output preserved | **The app** — re-derived every call |
| Safety guarantees | Rollback confirmed, Preview non-production confirmed, Export path unchanged | **The app** — re-derived every call |

The Review Console groups these visually into exactly these three
sections, marks the four system-verified items read-only (no
Pass/Fail buttons — a click there is a safe no-op), and shows a bounded
progress summary ("Visual 4/6 · System 4/4") plus one plain-language
next-step sentence, so it never implies you need to press ten buttons
when four are already handled for you.

## 4. Why "Re-analyze" / "Build Controlled V2 Preview" is required

**EN:** Nothing renders automatically the instant you finish the
checklist. You must click **Build Controlled V2 Preview** (Thai:
**สร้างตัวอย่าง Controlled V2**) — this reuses the exact same
Re-analyze pipeline the app already had (no new, separate analysis
engine was introduced for this button). The button stays disabled
until `readyToBuildV2` is true (all 10 items complete), disables itself
again for the duration of the run so you can't start two overlapping
builds, and afterward announces the honest outcome — a Safety-restraint
preview, an Identity fallback, or an honest "not yet available"
message — through a dedicated announcement region, then scrolls to the
Visual Preview Comparison section so you can see the result.

**TH:** จะไม่มีการเรนเดอร์อัตโนมัติทันทีที่คุณทำรายการตรวจสอบเสร็จ
คุณต้องคลิก **สร้างตัวอย่าง Controlled V2** (อังกฤษ: **Build
Controlled V2 Preview**) — ปุ่มนี้ใช้ไพล์ไลน์ Re-analyze เดิมที่แอปมี
อยู่แล้วซ้ำ (ไม่มีการสร้างเอนจินวิเคราะห์ใหม่แยกต่างหากสำหรับปุ่มนี้)
ปุ่มจะปิดใช้งานจนกว่า `readyToBuildV2` จะเป็นจริง (ครบทั้ง 10 รายการ)
และจะปิดใช้งานอีกครั้งระหว่างที่กำลังทำงานเพื่อไม่ให้เริ่มสร้างซ้อนกัน
สองครั้ง จากนั้นจะประกาศผลลัพธ์ตามจริง — ตัวอย่างแบบ Safety-restraint,
Identity fallback หรือข้อความ "ยังไม่พร้อมใช้งาน" ตามจริง — ผ่านพื้นที่
ประกาศเฉพาะ แล้วเลื่อนไปยังส่วน Visual Preview Comparison ให้คุณดูผล

## 5. Two separate evidence layers — Data Comparison vs Visual Preview Comparison

**EN:** The Side-by-Side "Data Comparison" section is a semantic/
planning-level comparison — it very often shows "Unknown" for Legacy,
since Legacy never had rich structured evidence to compare in the
first place. This is a genuinely SEPARATE evidence layer from the
Visual Preview Comparison (the one with actual rendered pixels). A
"Visual Preview available" state for the Visual layer does **not**
mean the Data layer's own "Unknown" values suddenly become known, low-
risk, or equal — the app now says this explicitly in the Data
Comparison panel, rather than leaving you to assume one layer speaks
for the other.

**TH:** ส่วน "Data Comparison" (เปรียบเทียบข้อมูล) แบบ Side-by-Side
เป็นการเปรียบเทียบระดับความหมาย/การวางแผน — มักแสดงผล "ไม่ทราบ"
สำหรับ Legacy บ่อยมาก เพราะ Legacy ไม่เคยมีหลักฐานเชิงโครงสร้างที่
ละเอียดพอจะเปรียบเทียบได้ตั้งแต่แรก นี่เป็นชั้นหลักฐานที่**แยกจากกัน
โดยแท้จริง**กับ Visual Preview Comparison (ชั้นที่มีพิกเซลเรนเดอร์จริง)
สถานะ "มี Visual Preview ให้ดู" ของชั้น Visual **ไม่ได้**แปลว่าค่า
"ไม่ทราบ" ของชั้น Data จะกลายเป็นค่าที่รู้แล้ว มีความเสี่ยงต่ำ หรือ
เท่ากันขึ้นมาทันที — ตอนนี้แอปจะระบุเรื่องนี้อย่างชัดเจนในแผง Data
Comparison แทนที่จะปล่อยให้คุณสันนิษฐานว่าชั้นหนึ่งพูดแทนอีกชั้นหนึ่ง

## 6. Interpreting Observation after a Controlled V2 build

The Observation controls (agree/disagree/no-visible-difference/unsure)
always refer to the CURRENT generation's rendered comparison — building
a new Controlled V2 Preview creates a new generation, and any prior
Observation is retired honestly (never silently carried over and never
silently discarded without a visible stale-generation notice, per the
existing Interactive Before/After lifecycle rules from earlier rounds).

## 7. Production remains Legacy — always

Confirmed at every layer, every time, never inferred:
`selectedOutputSource === 'legacy'`, `canWriteProduction === false`,
`canExportPreview === false`, the Controlled Test Gate's
`canEnterControlledTest` stays governed by its own existing (unchanged)
rules, and the exported `.xmp` file is byte-identical before and after
building a Controlled V2 Preview or selecting an Observation value —
this round's own Browser suite (`qa/epic-2e-j-controlled-v2-browser-
test.mjs`) captures and SHA-256-hashes the exported XMP text both
before and after the Build-V2 workflow for every fixture and requires
an exact match.

## 8. XMP export is unchanged

Nothing described in this document ever reaches the XMP export path.
The translator, the Review Console, the Build-V2 button, and the
Visual/Data Comparison layers are all strictly downstream, read-only
consumers of the same Legacy preset that has always been exported —
none of them can write back into it, by construction (no core/
lightroom-mapping-engine/preset-engine/xmp-validator import exists in
any of this round's new UI-layer files; verified via source-pattern
static tests, see §9).

## 9. Where the tests live

- `qa/epic-2e-j-controlled-v2-translator-static-test.mjs` — 62 pure
  tests of the classifier/intensity-resolution/restraint-factor logic.
- `qa/epic-2e-j-controlled-v2-translator-pixel-static-test.mjs` — 19
  pixel-level tests proving restraint effects are genuinely smaller
  than Legacy, never reversed.
- `qa/epic-2e-j-controlled-v2-review-static-test.mjs` — 27 tests of the
  Preview Sandbox's own Human Review checklist/grouping/reviewGuidance.
- `qa/epic-2e-j-review-state-engine-static-test.mjs` — 16 tests proving
  the SAME system-verified/never-manual guarantee holds in the actual
  UI-facing Review State Engine (not just the Sandbox mirror).
- `qa/epic-2e-j-review-console-ui-static-test.mjs` — 16 tests of the
  grouped, read-only Review Console rendering.
- `qa/epic-2e-j-build-controlled-v2-button-static-test.mjs` — 20 tests
  of the guided Build-V2 button workflow.
- `qa/epic-2e-j-comparison-honesty-note-static-test.mjs` — 11 tests of
  the Data-vs-Visual evidence-layer honesty note.
- `qa/epic-2e-j-qa-snapshot-controlled-v2-static-test.mjs` — 12 tests
  of the bounded QA snapshot fields.
- `qa/epic-2e-j-controlled-v2-browser-test.mjs` — the real end-to-end
  Browser suite across 5 fixture flavors (Step 12 of
  `npm run test:local-gate`).

Stop after CONTROLLED V2 VISUAL TRANSLATION R1.
