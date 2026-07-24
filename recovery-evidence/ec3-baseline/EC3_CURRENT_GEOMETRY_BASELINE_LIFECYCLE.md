# EC3_CURRENT_GEOMETRY_BASELINE — Upload/Generation Lifecycle Snapshot

Captured before any Phase 3+ edits in this task. SHA-256 hashes for all files quoted below are recorded in `EC3_CURRENT_GEOMETRY_BASELINE.txt` in this same directory. Any Production change made later in this task must be diffed against the exact code quoted here, with an explicit reason.

## loadFile() — ui/app.js (as of baseline)

```js
function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;

  handleReset();
  state.currentRetainedFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('previewImg');
    if (!img) return;

    document.getElementById('uploadWrap').style.display  = 'none';
    document.getElementById('previewWrap').style.display = 'block';
    document.getElementById('sliders').style.display     = 'none';
    setAnalysisBox('loading', 'กำลังโหลดรูปภาพ…');

    img.onload = () => {
      state.imageLoaded = true;
      runAnalysis();
    };
    img.onerror = () => setAnalysisBox('error', 'ไม่สามารถโหลดรูปภาพได้');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
```

Ownership model: `file` is a plain function parameter, captured by value from the caller (`e => loadFile(e.target.files[0])` on `fileIn`/`fileIn2` change, or `loadFile(e.dataTransfer.files[0])` on drop). `state.currentRetainedFile` is the ONLY place the File is retained past this call — it is a raw module-level `state` object field (in-page-memory only, never persisted).

## handleReset() — ui/app.js (as of baseline)

Clears every `state.last*` analysis field, then:
```js
state.currentRetainedFile = null;
state.lastCanonicalSourceEvidence = null;
previewSourceGeometryNormalizer.releaseAll();
```
then hides UI sections, clears Visual Preview / Interactive Before-After / Observation controllers (`.clear()`/`.reset()`), and finally:
```js
const fi = document.getElementById('fileIn');   if (fi)  fi.value  = '';
const fi2= document.getElementById('fileIn2');  if (fi2) fi2.value = '';
```
`handleReset()` is called unconditionally at the top of every `loadFile()` call (new image import) and by the user-facing Reset button. It is NOT called by `handleReanalyze()`.

## previewImg.onload — ui/app.js (as of baseline)

Assigned fresh on every `loadFile()` call, inside `reader.onload`, immediately before `img.src` is set:
```js
img.onload = () => { state.imageLoaded = true; runAnalysis(); };
img.onerror = () => setAnalysisBox('error', '...');
img.src = e.target.result;
```

## runAnalysis() — ui/app.js (as of baseline)

```js
async function runAnalysis() {
  const img = document.getElementById('previewImg');
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    setAnalysisBox('error', 'รูปภาพยังโหลดไม่เสร็จ');
    return;
  }
  ...
  const renderGeneration = ++analysisRenderGeneration;
  ...
  try {
    ... [core analysis pipeline: histogram/skin/HSL/decision/etc.] ...
    try {
      ... [Visual Preview Comparison boundary — self-contained try/catch] ...
      const _canonicalDecode = await previewSourceGeometryNormalizer.decodeCanonicalSource(state.currentRetainedFile, renderGeneration, img);
      state.lastCanonicalSourceEvidence = _canonicalDecode.evidence;
      if (renderGeneration === analysisRenderGeneration) {
        visualPreviewComparisonController.render({ source: _canonicalDecode.source ?? img, ... })
          .then(vprState => { if (renderGeneration !== analysisRenderGeneration) return; ... })
          .catch(err => { ...caught, only affects Visual Preview section... });
      }
    } catch (vprErr) {
      console.warn('VisualPreviewComparison boundary failed (analysis unaffected):', vprErr);
    }
  } catch (err) {
    setAnalysisBox('error', ...); console.error('runAnalysis error:', err);
  }
}
```

Key finding confirmed by direct read: the Visual Preview / canonical-decode boundary is wrapped in its OWN try/catch, nested inside the outer analysis try/catch — a thrown/rejected `decodeCanonicalSource()` cannot reach the outer catch and cannot replace or hide the core analysis result. This rules out "decode throws → whole analysis result disappears" as the mechanism, at least for a single, non-concurrent upload.

## Current File/resource ownership (as of baseline)

- `state.currentRetainedFile`: set once per `loadFile()` call (after `handleReset()` clears the previous one), cleared by `handleReset()`. Never stored outside `state`.
- `ui/preview-source-geometry-normalizer-v2.js`'s `createPreviewSourceGeometryNormalizerV2()` closure holds `currentGenerationId` and `currentBitmap` — both **implicit, closure-owned mutable state**, not explicitly passed by the caller. `_releaseCurrentBitmap()` always closes whatever `currentBitmap` currently is, with no way for a caller to say "release generation N's bitmap specifically, even if a newer one already started."

## Generation lifecycle (as of baseline)

- `analysisRenderGeneration` (module-level counter in `ui/app.js`) increments once per `runAnalysis()` call; `renderGeneration` is captured locally at the top of that call.
- `decodeCanonicalSource(file, generationId, fallbackImage)` closes the PREVIOUS bitmap unconditionally at its own top, before decoding the new one, and separately discards+closes its OWN result if a newer generation started while its `createImageBitmap()` await was in flight.
- **Gap identified (not yet a proven browser-reproduced defect, but a real architectural risk under this exact lifecycle):** nothing prevents `decodeCanonicalSource()`'s unconditional `_releaseCurrentBitmap()` call (made when generation N+1 starts) from closing a bitmap that generation N's own `visualPreviewComparisonController.render({source: bitmap, ...})` call is still actively drawing from in its own async renderer chain (`isolated-visual-preview-renderer-v2.js`) — the two are not sequenced against each other. This is the specific gap Phase 3 asks to close ("current generation resources are released only after both Preview renders finish or the generation is cancelled").

This lifecycle record, and the hashes in `EC3_CURRENT_GEOMETRY_BASELINE.txt`, are the reference point (`EC3_CURRENT_GEOMETRY_BASELINE`) that every later Production edit in this task is diffed against.
