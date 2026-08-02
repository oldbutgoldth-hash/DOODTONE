# P1D — XMP Serialization Audit

Source-grounded audit of the REAL, unmodified serializer
(`core/preset-engine/index.js::serializeXMP`), the REAL Tone Curve
codec (`core/curve-engine/index.js`), the REAL final safety net
(`core/xmp-validator/index.js::quickSafetyClamp`), and the REAL
Candidate→flat-preset adapter (`core/single-image/candidate/
legacy-preset-adapter.js::candidateToLegacyPreset`). Every property
name and transform below was read directly from source on 2026-08-02
during this EPIC — nothing is assumed from memory of Adobe's public
XMP schema.

## 1. Serializer entry point

`export function serializeXMP(p)` in `core/preset-engine/index.js`.
Called from exactly one place in the real app: `ui/app.js`'s
`handleDownload()`, immediately after `quickSafetyClamp(preset)`.
Returns a single XML **string** (not a DOM object). Untouched by P1D.

## 2. XMP template shape

A single `<rdf:Description>` element with ALL Lightroom parameters as
**XML attributes** (never child elements, never `rdf:Seq`/`rdf:li`
wrappers — even Tone Curves are flat attribute strings, see §9). Three
namespaces declared:

| Prefix | URI | Declared on |
|---|---|---|
| `x` | `adobe:ns:meta/` | `<x:xmpmeta>` |
| `rdf` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | `<rdf:RDF>` |
| `crs` | `http://ns.adobe.com/camera-raw-settings/1.0/` | `<rdf:Description>` |

Fixed literal attributes (never derived from the Candidate, always
these exact values):
`crs:ProcessVersion="11.0"`, `crs:PresetType="Normal"`,
`crs:SupportsAmount="False"`, `crs:SupportsColor="True"`,
`crs:SupportsMonochrome="False"`, `crs:SupportsHighDynamicRange="True"`,
`crs:SupportsNormalDynamicRange="True"`, `crs:SupportsSceneReferred="True"`,
`crs:SupportsOutputReferred="True"`, `crs:CameraModelRestriction=""`,
`crs:Copyright=""`, `crs:ColorNoiseReduction="25"`,
`crs:WhiteBalance="Custom"`.

**Important:** `crs:ProcessVersion` is a **hard-coded string literal**
— `candidate.profile.processVersion` is never read by the serializer.
`candidate.profile.treatment` and the readback contract's
`profile.cameraProfile` have **no corresponding XMP attribute at
all** — no `crs:Treatment`/`crs:ConvertToGrayscale`/`crs:CameraProfile`
is ever emitted, and `cameraProfile` does not even exist as a
Candidate schema field. `candidate.profile.name` is mapped by the
adapter into the flat preset's `name` field, but `serializeXMP` never
reads `p.name` — no `crs:Name`/`crs:UUID` attribute exists anywhere in
the template. The Preset Name the user sees is a **filename-only**
concept (`#presetName` DOM input via `sanitizePresetFilename()`),
entirely separate from XMP content.

## 3. Every serialized Candidate parameter (flat-preset field → XMP attribute)

| Flat preset field | XMP attribute | Transform |
|---|---|---|
| `exp` | `crs:Exposure2012` | `(exp/100).toFixed(2)` — **divided by 100, 2-decimal string** |
| `con` | `crs:Contrast2012` | raw number → string |
| `hi` | `crs:Highlights2012` | raw |
| `sh` | `crs:Shadows2012` | raw |
| `wh` | `crs:Whites2012` | raw |
| `bl` | `crs:Blacks2012` | raw |
| `clarity` | `crs:Clarity2012` | raw |
| `dehaze` | `crs:Dehaze` | raw |
| `texture` | `crs:Texture` | raw |
| `crv_sh` | `crs:ParametricShadows` | raw |
| `crv_mid` | `crs:ParametricMidtones` | raw |
| `crv_hi` | `crs:ParametricHighlights` | raw |
| `sharp` | `crs:Sharpness` | raw |
| `noise` | `crs:LuminanceSmoothing` | raw |
| `temp` | `crs:Temperature` | **`sliderToKelvin(temp)`** — slider (-100..100) → Kelvin integer (2000..50000, midpoint 5500). Round-trip via `kelvinToSlider` verified exact (diff 0) across the full -100..100 integer range in this audit. |
| `tint` | `crs:Tint` | raw |
| `vib` | `crs:Vibrance` | raw |
| `sat` | `crs:Saturation` | raw |
| `grade.grd_sh_h/s/l` | `crs:ColorGradeShadowHue/Sat/Lum` | raw, `?? 0` |
| `grade.grd_mid_h/s/l` | `crs:ColorGradeMidtoneHue/Sat/Lum` | raw, `?? 0` |
| `grade.grd_hi_h/s/l` | `crs:ColorGradeHighlightHue/Sat/Lum` | raw, `?? 0` |
| `grade.grd_blend` | `crs:ColorGradeBlending` | raw, `?? 50` |
| `cal.cal_red_h/s` | `crs:RedHue`/`crs:RedSaturation` | raw, `?? 0` |
| `cal.cal_green_h/s` | `crs:GreenHue`/`crs:GreenSaturation` | raw, `?? 0` |
| `cal.cal_blue_h/s` | `crs:BlueHue`/`crs:BlueSaturation` | raw, `?? 0` |
| `hsl.hsl_h_{ch}` (×8) | `crs:HueAdjustment{Cap}` | raw, `?? 0` |
| `hsl.hsl_s_{ch}` (×8) | `crs:SaturationAdjustment{Cap}` | raw, `?? 0` |
| `hsl.hsl_l_{ch}` (×8) | `crs:LuminanceAdjustment{Cap}` | raw, `?? 0` |
| `curves.master` | `crs:ToneCurvePV2012` | `serializeCurvePoints()` — see §9 |
| `curves.red` | `crs:ToneCurvePV2012Red` | falls back to `curves.master` if `curves.red` is null |
| `curves.green` | `crs:ToneCurvePV2012Green` | falls back to `curves.master` if null |
| `curves.blue` | `crs:ToneCurvePV2012Blue` | falls back to `curves.master` if null |

`{Cap}` = channel id capitalized (Red, Orange, Yellow, Green, Aqua,
Blue, Purple, Magenta) — from `HSL_CHANNELS` in
`core/hsl-engine/index.js`, identical order to
`HSL_CHANNEL_IDS` in `candidate-schema.js`.

If `p.curves` itself is null, ALL FOUR curve channels fall back to
`defaultCurveSet()` (linear 0,0 / 255,255) — see §9.

## 4. Every omitted / unsupported Candidate field

Documented in `candidate-schema.js`'s own `UNSUPPORTED_FIELD_PATHS`
(never serialized, always `null` on a built Candidate):
`detail.radius`, `detail.detail`, `detail.masking`,
`detail.noiseReductionDetail`, `detail.colorNoiseReductionDetail`,
`detail.colorNoiseReductionSmoothness`, `grading.balance`,
`cal.shadowTint`, all of `effects.*`, all of `optics.*`.

**New gaps found in this audit, not previously documented:**

- `candidate.detail.colorNoiseReduction` — present and non-null on
  every Candidate (`?? 25`), but `candidateToLegacyPreset()` never
  maps it into the flat preset at all, and `serializeXMP` hard-codes
  `crs:ColorNoiseReduction="25"` unconditionally. This Candidate value
  can never affect the exported XMP no matter what it is set to. Must
  be classified UNSUPPORTED (the product has never promised this
  parameter is exported), not a fidelity failure.
- `candidate.profile.name` — mapped to the flat preset's `name` field
  by the adapter, but `serializeXMP` never reads `p.name`. Dead for
  XMP purposes.
- `candidate.profile.treatment`, `candidate.profile.processVersion` —
  never mapped into the flat preset at all by
  `candidateToLegacyPreset()` (no `treatment`/`processVersion` keys
  exist on its output object). `serializeXMP` independently
  hard-codes `crs:ProcessVersion="11.0"` and never emits a
  Treatment attribute. Both UNSUPPORTED.

## 5. Legacy Preset Adapter name conversions

`core/single-image/candidate/legacy-preset-adapter.js::candidateToLegacyPreset()`
is the exact, sole reshaping point (already existed, unmodified by
P1D). Field map: `candidate.basic.{exposure,contrast,highlights,
shadows,whites,blacks,clarity,dehaze,texture}` → `{exp,con,hi,sh,wh,
bl,clarity,dehaze,texture}`; `candidate.whiteBalance.{temperature,
tint}` → `{temp,tint}`; `candidate.basic.{vibrance,saturation}` →
`{vib,sat}`; `candidate.detail.{sharpening,noiseReduction}` →
`{sharp,noise}`; `candidate.curves.parametric.{highlights,midtones,
shadows}` → `{crv_hi,crv_mid,crv_sh}`; `candidate.hsl.{hue,saturation,
luminance}[ch]` → `hsl.hsl_{h|s|l}_{ch}`; `candidate.grading[zone].
{hue,saturation,luminance}` → `grade.grd_{sh|mid|hi}_{h|s|l}`
(`GRADE_ZONE_ABBR = {shadows:'sh', midtones:'mid', highlights:'hi'}`);
`candidate.grading.blending` → `grade.grd_blend`; `candidate.cal.
{red,green,blue}Primary{Hue,Saturation}` → `cal.cal_{red|green|blue}_
{h|s}`; `candidate.curves.{rgb,red,green,blue}` → `curves.{master,
red,green,blue}` **only when `candidate.curves.rgb != null`, else the
whole `curves` field is `null`** (the P1C R3 root-cause fix — a truthy
`{master:null,...}` shell previously broke the serializer's own
`p.curves ?? defaultCurveSet()` fallback).

## 6. `quickSafetyClamp()` transformations (the "expected value" ground truth)

`core/xmp-validator/index.js::quickSafetyClamp(preset)` — the ONLY
transform allowed to run between the Legacy Preset Adapter and
`serializeXMP()`. P1D's comparator must treat its OUTPUT, not the raw
Candidate value, as "expected" wherever a clamp fires:

| Field(s) | Clamp |
|---|---|
| `exp,con,hi,sh,wh,bl` | `_clampBasicPanel()` to `HARD_LIMITS.basic` ranges: exposure[-35,35], contrast[-20,25], highlights[-55,10], shadows[-25,35], whites[-30,20], blacks[-35,15] |
| `tint` | floor `HARD_LIMITS.wb.tintGreenFloorIntentional` (-25), ceil `tintMagentaCeil` (30) |
| `temp` | `±(tempCap × 1.5)` = ±60 |
| `hsl_s_{ch}` | skin channels (red/orange/yellow) cap `skinSatHi+4`=10; other channels cap `colorSatCap+5`=30 |
| `cal_{prim}_s` | cap `calibration.satCap+5` = 20 |
| `vib` | cap `presence.vibCap+10` = 40 |
| `sat` | cap `presence.satCap+10` = 30 |

Every other field (contrast/highlights/etc. within `_clampBasicPanel`,
all curve fields, all grading fields, all HSL hue fields, all
calibration hue fields) passes through `quickSafetyClamp` completely
unchanged — no clamp exists for them at export time.

## 7. String / number / boolean / array formatting

Every XMP attribute value is a template-literal string. Plain numbers
use JS's default `Number→String` coercion (`5` → `"5"`, `-12.5` →
`"-12.5"`) — **except** `crs:Exposure2012`, which explicitly calls
`.toFixed(2)`. No booleans are ever derived from Candidate data — the
`crs:Supports*="True"/"False"` attributes are fixed literals, and the
Candidate schema's own boolean fields (`optics.removeChromaticAberration`,
`optics.enableProfileCorrections`) are always `null` and never reach
the adapter's output at all (`optics.*` is not mapped into the flat
preset object).

## 8. Tone Curve format

`core/curve-engine/index.js::serializeCurvePoints(pts)`:
`pts.map(p => \`${Math.round(p.x)}, ${Math.round(p.y)}\`).join(', ')`
— a flat comma-space-separated integer pair list, e.g.
`"0, 8, 64, 70, 128, 130, 192, 195, 255, 248"`. **Not** `rdf:Seq`/
`rdf:li` — a single plain attribute string. Points are x-ascending by
construction (`candidate-schema.js::_validCurvePoints` already
rejects non-ascending x during Candidate validation).

`parseCurvePoints(str)` **already exists** in the same file:
splits on `,`, `parseInt`s each token, pairs them, clamps each to
[0,255]. **Caveat found in this audit:** if fewer than 2 valid points
survive, it silently returns `defaultCurve()` (linear) rather than
signaling failure — the new readback parser must NOT call this
function directly as its only validation path, or a genuinely
corrupted curve string would silently read back as a "valid" default
linear curve instead of failing. P1D's parser reimplements strict
tokenization first (reusing `parseCurvePoints`'s pairing algorithm)
and only accepts the result when the raw string actually contained a
well-formed, even-length numeric token list.

## 9. HSL / Grading / Calibration / Detail / Effects / Optics readback support

- **HSL**: all 8 channels × 3 properties (24 attributes) ARE
  serialized — full readback support (§3 table).
- **Grading**: Shadows/Midtones/Highlights Hue+Sat+Lum (9 attributes)
  and Blending ARE serialized. `grading.balance` is NOT serialized
  (schema-documented unsupported, §4).
- **Calibration**: Red/Green/Blue Primary Hue+Saturation (6
  attributes) ARE serialized. `cal.shadowTint` is NOT serialized.
- **Detail**: only `sharpening`→`crs:Sharpness` and
  `noiseReduction`→`crs:LuminanceSmoothing` are serialized.
  `colorNoiseReduction` is present on the Candidate but never flows
  through (§4). `radius/detail/masking/*Detail/*Smoothness` are
  schema-null, never serialized.
- **Effects**: zero fields serialized — `effects.*` is entirely
  unsupported.
- **Optics**: zero fields serialized — `optics.*` is entirely
  unsupported.

## 10. Process Version / Profile properties

`crs:ProcessVersion="11.0"` is a fixed literal (§2). No Treatment,
CameraProfile, or Name/UUID attribute exists in the template (§2).

## 11. Preset name / UUID handling

No `crs:Name` / `crs:UUID` / `xmp:CreatorTool` attribute anywhere.
"Preset name" in this app is exclusively a **download filename**
concept, sourced from the `#presetName` DOM input (not from the
Candidate), via `sanitizePresetFilename()` in `ui/app.js`.

## 12. Filename generation

`ui/app.js::sanitizePresetFilename(name)`: trims, replaces
`[<>:"/\|?*]` → `_`, falls back to `'AI Preset'` if empty. Then
`downloadXMP(xmpString, fileName)` in `core/preset-engine/index.js`
applies its OWN, broader sanitize (`[^\w฀-๿\s\-_]` → `_`)
before appending `.xmp` — an intentional two-layer safety net (see
`lumixa-ai-development` skill §6, "never consolidate a two-layer
net").

## 13. Download handler

`downloadXMP(xmpString, fileName)` in `core/preset-engine/index.js`:
builds a `Blob`, an object URL, a temporary `<a download>` element,
calls `.click()`, revokes the URL. Synchronous, browser-only. The
Fidelity Gate parses the XMP **string** directly (the exact string
about to be handed to `downloadXMP`), never touching the DOM/Blob
machinery.

## 14. Out-of-scope related code (found, not reused)

`core/color-match/candidate-xmp-codec.js` (`parseCandidateXMP`) is a
**separate, protected Reference Color Match feature** with its own
XMP dialect and its own codec — explicitly on the "do not modify"
list for P1D and structurally different from
`core/preset-engine`'s serializer (different attribute set, different
white-balance semantics). Not reused; noted here only so a future
reader does not mistake it for the P1D readback parser's source.

## 15. Session field for the Fidelity Report

`core/single-image/single-image-session.js` already declares an
**unused** `session.xmp = {content, readback, filename, status}`
field (dead — nothing reads or writes it anywhere in the codebase).
Per the project's additive-only rule, P1D does not repurpose this
dead field (its shape does not match the required Fidelity Report
contract) — a new `session.xmpFidelity` field is added instead,
alongside it, leaving `session.xmp` untouched.
