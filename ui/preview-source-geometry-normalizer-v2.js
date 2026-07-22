/**
 * ui/preview-source-geometry-normalizer-v2.js
 *
 * DEPLOY GEOMETRY R1 — Phase B: canonical image decode + EXIF
 * orientation handling for the Visual Preview Comparison pipeline.
 *
 * Produces exactly ONE canonical decoded source per analysis
 * generation, shared identically by BOTH the Legacy and Controlled V2
 * render paths (this is what makes Phase C3's "same canonical source"
 * requirement true by construction — the caller passes the SAME
 * returned `source` object into visualPreviewComparisonController's
 * single `render({ source, ... })` call, which itself reuses that one
 * object for both the Legacy and V2 isolated-renderer calls). Neither
 * side ever decodes or infers orientation independently.
 *
 * DECODE CONTRACT (Phase B2):
 *   - Preferred: createImageBitmap(file, { imageOrientation: 'from-image',
 *     premultiplyAlpha: 'default', colorSpaceConversion: 'default' }).
 *   - Safe, feature-detected fallback: an already-decoded
 *     HTMLImageElement (modern browsers apply
 *     `image-orientation: from-image` to <img> by default, so
 *     naturalWidth/naturalHeight/drawImage already reflect
 *     EXIF-corrected geometry). NEVER manually rotate a source the
 *     browser already decoded with EXIF orientation applied — doing so
 *     would double-rotate the image.
 *   - `encodedOrientation` is intentionally always reported as `null`:
 *     reading the raw EXIF Orientation tag safely requires a dedicated
 *     EXIF-parsing dependency, which is out of this task's allowed
 *     scope. Nothing downstream may guess this value — only the
 *     decoded (already-corrected) geometry is ever relied upon.
 *
 * PRIVACY (Phase B1): this module never persists anything anywhere —
 * no localStorage/sessionStorage/IndexedDB, no Network calls. It never
 * reads `file.name`/`file.path`/webkitRelativePath, and no filename or
 * path ever appears in any object this module returns. The `evidence`
 * object below is the ONLY externally observable output — bounded
 * primitives only (numbers, strings, booleans), never raw pixels,
 * ImageBitmap/canvas references, or EXIF blocks.
 *
 * RESOURCE LIFECYCLE (Phase B4): each new generation releases the
 * previous generation's decoded ImageBitmap (via `.close()`) before
 * decoding the new one. If a newer decode starts while an older one is
 * still in flight, the older result is discarded and immediately
 * closed the moment it resolves — a stale generation can never commit
 * its geometry/pixels into a newer one.
 */

function _isFiniteDim(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function _safeGenerationId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return null;
}

function _emptyEvidence(generationId, decodePath) {
  return {
    generationId: _safeGenerationId(generationId),
    decodePath,
    encodedOrientation: null,
    orientationAppliedByDecoder: false,
    canonicalWidth: null,
    canonicalHeight: null,
    sourceAspectRatio: null,
    decodeComplete: false,
  };
}

/**
 * Creates a normalizer instance. One instance is intended to be shared
 * for the lifetime of the page (module-level singleton in ui/app.js),
 * tracking exactly one "current" decoded resource at a time.
 */
export function createPreviewSourceGeometryNormalizerV2() {
  let currentGenerationId = null;
  // Retained ONLY so it can be released later via .close() — never
  // re-exposed to any caller, never read for pixels here.
  let currentBitmap = null;

  function _releaseCurrentBitmap() {
    if (currentBitmap && typeof currentBitmap.close === 'function') {
      try { currentBitmap.close(); } catch { /* already closed, or unsupported in this environment — safe to ignore */ }
    }
    currentBitmap = null;
  }

  /**
   * Decodes the canonical source for one analysis generation.
   *
   * @param {File|Blob|null} file - the just-selected File/Blob. Never stored beyond this call by this module.
   * @param {number|string|null} generationId - the caller's own generation counter (e.g. analysisRenderGeneration).
   * @param {HTMLImageElement|null} [fallbackImage] - an already-decoded <img> to use if createImageBitmap is unavailable or fails.
   * @returns {Promise<{ source: (ImageBitmap|HTMLImageElement|null), evidence: object }>}
   */
  async function decodeCanonicalSource(file, generationId, fallbackImage = null) {
    // Phase B4: release the previous generation's bitmap BEFORE
    // starting a new decode — a new generation must never leave the
    // prior generation's decoded pixel buffer alive in memory.
    _releaseCurrentBitmap();
    currentGenerationId = generationId;

    let source = null;
    let decodePath = 'unavailable';
    let canonicalWidth = null;
    let canonicalHeight = null;

    if (typeof createImageBitmap === 'function' && file) {
      try {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: 'from-image',
          premultiplyAlpha: 'default',
          colorSpaceConversion: 'default',
        });
        // Phase B4: if a NEWER decode has started while this one was
        // in flight, this result is stale — release it immediately and
        // report nothing, rather than ever letting it commit into a
        // newer generation.
        if (generationId !== currentGenerationId) {
          try { bitmap.close(); } catch { /* ignore */ }
          return { source: null, evidence: _emptyEvidence(generationId, 'stale-discarded') };
        }
        currentBitmap = bitmap;
        source = bitmap;
        decodePath = 'createImageBitmap';
        canonicalWidth = bitmap.width;
        canonicalHeight = bitmap.height;
      } catch {
        source = null; // fall through to the HTMLImageElement fallback below
      }
    }

    if (!source && fallbackImage) {
      // Safe, feature-detected fallback — never manually rotates;
      // relies entirely on the browser's own default EXIF-aware <img>
      // decode already having happened (img.onload already fired).
      const w = fallbackImage.naturalWidth ?? fallbackImage.width ?? null;
      const h = fallbackImage.naturalHeight ?? fallbackImage.height ?? null;
      if (_isFiniteDim(w) && _isFiniteDim(h)) {
        source = fallbackImage;
        decodePath = 'html-image-element-fallback';
        canonicalWidth = w;
        canonicalHeight = h;
      }
    }

    const decodeComplete = _isFiniteDim(canonicalWidth) && _isFiniteDim(canonicalHeight) && !!source;
    const sourceAspectRatio = decodeComplete ? canonicalWidth / canonicalHeight : null;

    return {
      source,
      evidence: {
        generationId: _safeGenerationId(generationId),
        decodePath,
        encodedOrientation: null,
        orientationAppliedByDecoder: decodePath === 'createImageBitmap' || decodePath === 'html-image-element-fallback',
        canonicalWidth,
        canonicalHeight,
        sourceAspectRatio,
        decodeComplete,
      },
    };
  }

  /**
   * Phase B4 explicit release hook for cancel/reset — a no-op if the
   * given generation is no longer the one currently held (i.e. it was
   * already superseded and released by a later decodeCanonicalSource()
   * call).
   */
  function releaseGeneration(generationId) {
    if (generationId === currentGenerationId) _releaseCurrentBitmap();
  }

  /** Releases any held resource unconditionally (Reset / new image / teardown). */
  function releaseAll() {
    currentGenerationId = null;
    _releaseCurrentBitmap();
  }

  return { decodeCanonicalSource, releaseGeneration, releaseAll };
}
