/**
 * ui/preview-source-geometry-normalizer-v2.js
 *
 * DEPLOY GEOMETRY R1 — Phase B: canonical image decode + EXIF
 * orientation handling for the Visual Preview Comparison pipeline.
 *
 * SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 3 rewrite of this
 * module's resource lifecycle. The R1 version tracked exactly one
 * "current" bitmap via implicit closure-mutable state
 * (`currentGenerationId`/`currentBitmap`) and closed the PREVIOUS
 * bitmap unconditionally and immediately whenever a new generation's
 * decode began — with no way to know whether that previous
 * generation's own Preview render (Legacy/V2 canvas draw, which
 * consumes the bitmap asynchronously via `visualPreviewComparison
 * Controller.render({source: bitmap, ...})`) had actually finished
 * consuming it yet. Phase 3 requires: "Current generation resources
 * are released only after both Preview renders finish or the
 * generation is cancelled" — this rewrite makes that literally true by
 * construction, via an explicit per-generation resource map plus an
 * explicit pending-render refcount, instead of a single implicit
 * "current" slot.
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
 * DECODE CONTRACT (Phase B2, unchanged from R1):
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
 *     scope (the QA-side fixture verification uses its own independent
 *     parser in qa/helpers/exif-orientation-reader.mjs — never
 *     imported here). Nothing downstream may guess this value — only
 *     the decoded (already-corrected) geometry is ever relied upon.
 *
 * PRIVACY (Phase B1, unchanged from R1): this module never persists
 * anything anywhere — no localStorage/sessionStorage/IndexedDB, no
 * Network calls. It never reads `file.name`/`file.path`/
 * webkitRelativePath, and no filename or path ever appears in any
 * object this module returns. The `evidence` object below is the ONLY
 * externally observable output — bounded primitives only (numbers,
 * strings, booleans), never raw pixels, ImageBitmap/canvas references,
 * or EXIF blocks.
 *
 * RESOURCE LIFECYCLE (Phase 3, this rewrite):
 *   - Each decoded bitmap is stored keyed by its own generationId in an
 *     internal Map, alongside an explicit `pendingRenders` counter.
 *   - `markRenderStarted(generationId)` / `markRenderSettled(generationId)`
 *     are called by the caller (ui/app.js) immediately before invoking
 *     the Preview render for that generation, and in BOTH its
 *     `.then()` and `.catch()` — i.e. every settle path, success or
 *     failure — never only the success path.
 *   - A generation's bitmap is only ever closed when BOTH: (a) it is
 *     no longer the newest generation this module has decoded, AND
 *     (b) its `pendingRenders` counter is exactly 0 (no in-flight
 *     render is still consuming it). This is checked every time a
 *     newer decode completes AND every time a render settles — so a
 *     generation superseded WHILE its render is still in flight is
 *     released the moment that render settles, not before.
 *   - `releaseGeneration(generationId)` remains available for an
 *     explicit cancel (e.g. Reset during an in-flight decode) — this
 *     one unconditionally closes that generation's bitmap regardless
 *     of pendingRenders, since Reset means "abandon this generation
 *     entirely", matching Phase 3's "or the generation is cancelled"
 *     clause.
 *   - `releaseAll()` unconditionally closes every tracked generation's
 *     bitmap (Reset / new image / teardown).
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

function _closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') {
    try { bitmap.close(); } catch { /* already closed, or unsupported in this environment — safe to ignore */ }
  }
}

/**
 * Creates a normalizer instance. One instance is intended to be shared
 * for the lifetime of the page (module-level singleton in ui/app.js).
 */
export function createPreviewSourceGeometryNormalizerV2() {
  // generationId -> { bitmap: ImageBitmap|null, pendingRenders: number }
  const generations = new Map();
  let newestGenerationId = null;

  /**
   * Releases every generation OTHER than the newest one whose
   * pendingRenders is exactly 0. Called after every decode and after
   * every render-settle so a superseded generation is released the
   * instant it is safe to do so — never eagerly while a render might
   * still be reading from it.
   */
  function _sweepReleasable() {
    for (const [genId, entry] of generations.entries()) {
      if (genId === newestGenerationId) continue;
      if (entry.pendingRenders > 0) continue;
      _closeBitmap(entry.bitmap);
      generations.delete(genId);
    }
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
    // Phase 3: register this as the newest generation BEFORE the async
    // decode begins, and immediately sweep — any older generation with
    // zero pending renders is released now; one with a still-pending
    // render is left untouched until that render settles.
    newestGenerationId = generationId;
    generations.set(generationId, { bitmap: null, pendingRenders: 0 });
    _sweepReleasable();

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
        // Phase 3 (was Phase B4): if a NEWER decode has started while
        // this one was in flight, this result is stale — release it
        // immediately and report nothing, rather than ever letting it
        // commit into a newer generation. The entry for THIS
        // generationId may also have already been deleted by a
        // newer decode's sweep — check both.
        if (generationId !== newestGenerationId || !generations.has(generationId)) {
          _closeBitmap(bitmap);
          generations.delete(generationId);
          return { source: null, evidence: _emptyEvidence(generationId, 'stale-discarded') };
        }
        generations.set(generationId, { bitmap, pendingRenders: 0 });
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
   * Phase 3: call immediately BEFORE invoking the Preview render for
   * this generation's decoded source. A no-op (never throws) if the
   * generation is unknown (already released/cancelled) — the caller's
   * own generation-token check is expected to have already skipped
   * calling render() in that case; this is defense-in-depth only.
   */
  function markRenderStarted(generationId) {
    const entry = generations.get(generationId);
    if (entry) entry.pendingRenders += 1;
  }

  /**
   * Phase 3: call in BOTH the `.then()` and `.catch()` of the Preview
   * render promise for this generation — every settle path, success or
   * failure. Decrements the pending-render count and sweeps, so a
   * superseded generation whose render just finished is released
   * immediately, and a still-current generation is simply left alone.
   */
  function markRenderSettled(generationId) {
    const entry = generations.get(generationId);
    if (entry) entry.pendingRenders = Math.max(0, entry.pendingRenders - 1);
    _sweepReleasable();
  }

  /**
   * Explicit cancel — unconditionally releases ONE generation's
   * bitmap regardless of pendingRenders (Reset during an in-flight
   * decode/render counts as "the generation is cancelled", not
   * "finished"). A no-op if the given generation is already released.
   */
  function releaseGeneration(generationId) {
    const entry = generations.get(generationId);
    if (!entry) return;
    _closeBitmap(entry.bitmap);
    generations.delete(generationId);
  }

  /** Releases every tracked generation's resource unconditionally (Reset / new image / teardown). */
  function releaseAll() {
    for (const entry of generations.values()) _closeBitmap(entry.bitmap);
    generations.clear();
    newestGenerationId = null;
  }

  return { decodeCanonicalSource, markRenderStarted, markRenderSettled, releaseGeneration, releaseAll };
}
