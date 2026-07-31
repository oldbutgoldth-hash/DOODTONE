/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUMIXA — High-Res Image Loader
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Safely loads large images (4000–8000px) for canvas processing without
 * hitting browser memory limits. Uses progressive downsampling:
 *   1. Load the full image
 *   2. If dimensions exceed safe limits, create a downscaled copy
 *   3. Return the safe-to-process canvas
 *
 * Usage:
 *   import { loadSafeImage, getImageInfo } from '../core/highres-loader.js';
 *   const safeImg = await loadSafeImage(file); // returns HTMLImageElement
 *   const info = getImageInfo(safeImg);
 */

const SAFE_MAX_DIM = 4000;      // Max dimension for full pipeline processing
const ANALYSIS_MAX_DIM = 200;   // Max dimension for palette/zone analysis (already in kmeans/tone-zone)
const CURVE_MAX_DIM = 400;      // Max dimension for curve/histogram analysis

/**
 * Get image info without loading into canvas.
 * @param {HTMLImageElement} img
 * @returns {{ width: number, height: number, megapixels: number, needsDownscale: boolean, scaleFactor: number }}
 */
export function getImageInfo(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const mp = (w * h) / 1_000_000;
  const maxDim = Math.max(w, h);
  const needsDownscale = maxDim > SAFE_MAX_DIM;
  const scaleFactor = needsDownscale ? SAFE_MAX_DIM / maxDim : 1;
  return { width: w, height: h, megapixels: Math.round(mp * 10) / 10, needsDownscale, scaleFactor };
}

/**
 * Load an image file safely, downsampling if necessary.
 * Returns an HTMLImageElement ready for pipeline processing.
 *
 * @param {File|HTMLImageElement} source — File object or existing image element
 * @param {number} [maxDim=SAFE_MAX_DIM] — maximum allowed dimension
 * @returns {Promise<HTMLImageElement>}
 */
export async function loadSafeImage(source, maxDim = SAFE_MAX_DIM) {
  let img;

  if (source instanceof HTMLImageElement && source.complete) {
    img = source;
  } else if (source instanceof File) {
    img = await _loadFromFile(source);
  } else if (source instanceof HTMLImageElement) {
    // Wait for load
    await new Promise((resolve, reject) => {
      if (source.complete) return resolve();
      source.onload = resolve;
      source.onerror = () => reject(new Error('Failed to load image'));
    });
    img = source;
  } else {
    throw new Error('Invalid source: expected File or HTMLImageElement');
  }

  const info = getImageInfo(img);
  if (!info.needsDownscale) return img;

  // Downscale for safe processing
  return _downscaleImage(img, maxDim);
}

/**
 * Create a downscaled copy of an image.
 * @private
 */
function _downscaleImage(img, maxDim) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, newW, newH);

  // Convert canvas back to an image element
  const downscaled = new Image();
  downscaled.src = canvas.toDataURL('image/png');
  return new Promise((resolve, reject) => {
    downscaled.onload = () => resolve(downscaled);
    downscaled.onerror = () => reject(new Error('Failed to create downscaled image'));
  });
}

/**
 * Load a file as an HTMLImageElement.
 * @private
 */
function _loadFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Create a preview-quality thumbnail for the UI.
 * @param {HTMLImageElement} img
 * @param {number} [maxDim=400]
 * @returns {string} data URL of the thumbnail
 */
export function createThumbnail(img, maxDim = 400) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, newW, newH);
  return canvas.toDataURL('image/jpeg', 0.85);
}
