LUMIXA AI v1.4.0 — EPIC 2E-N1
CORE COLOR MATCH: REFERENCE/TARGET SIGNATURE ENGINE

PURPOSE
Build a deterministic and directly comparable visual signature for one
Reference image and one Target image, then calculate a semantic difference
(delta) before any Lightroom Mapping or XMP generation is allowed.

WHAT N1 ADDS
- Shared Reference/Target Signature Schema v1
- White-balance signature by shadow/midtone/highlight zones
- Tone signature: shadow, midtone, highlight, contrast and tonal span
- Palette signature across Lightroom-style colour families
- Optional skin/style/capture-risk evidence slots
- Evidence coverage/confidence gate
- Semantic delta with circular hue handling
- Match Need score and stable reason/risk codes
- Shadow-only Core Match Inspector in Reference Color Match

SAFETY BOUNDARY
- Production source remains Legacy
- Production write is false
- Lightroom Mapping is not permitted by N1
- XMP write is not permitted by N1
- No raw image, Base64, Blob URL, file name, local path or pixel buffer is
  stored in the Signature/Delta result

RUN QA ON WINDOWS
1. Extract the ZIP into a new folder.
2. Run RUN_LUMIXA_2E_N1_QA_WINDOWS_KEEP_OPEN.bat
3. Wait for: EPIC 2E-N1 RESULT: FINAL_PASS

NEXT DEVELOPMENT PHASE
EPIC 2E-N2 — Photographic Compensation and Match Delta Translation.
N2 will convert N1 evidence into bounded Lightroom recommendations while
separating illuminant cast, object-colour bias, skin protection, capture
headroom and creative style intent. It still must remain non-Production until
Preview/XMP fidelity is proven.
