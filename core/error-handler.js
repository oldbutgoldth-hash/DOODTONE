/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUMIXA — Error Handling & User Feedback System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralized error handling for the color transfer pipeline.
 * Catches common failure modes and provides actionable user-friendly
 * messages instead of cryptic technical errors.
 *
 * Usage:
 *   import { withErrorHandling, showErrorToast, validateImage } from './error-handler.js';
 *   const result = await withErrorHandling(() => processImage(img), 'Color Transfer');
 */

const MAX_IMAGE_DIMENSION = 8192; // 8K — beyond this, canvas operations may fail
const MAX_FILE_SIZE_MB = 50;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/bmp']);

/**
 * Error categories for user-friendly display.
 */
export const ErrorCategory = {
  VALIDATION: 'validation',
  MEMORY: 'memory',
  ENGINE: 'engine',
  EXPORT: 'export',
  UNKNOWN: 'unknown',
};

/**
 * User-friendly error messages mapped from error types.
 * Each entry: { title, message, suggestion, category }
 */
const ERROR_MAP = {
  // Validation errors
  'invalid-image': {
    title: 'Invalid Image',
    message: 'The file could not be read as an image.',
    suggestion: 'Try exporting from your editor as JPEG, PNG, or WebP.',
    category: ErrorCategory.VALIDATION,
  },
  'file-too-large': {
    title: 'File Too Large',
    message: `The image exceeds ${MAX_FILE_SIZE_MB}MB.`,
    suggestion: 'Resize or compress the image before uploading.',
    category: ErrorCategory.VALIDATION,
  },
  'unsupported-format': {
    title: 'Unsupported Format',
    message: 'This image format is not supported.',
    suggestion: 'Convert to JPEG, PNG, or WebP and try again.',
    category: ErrorCategory.VALIDATION,
  },
  'image-too-large': {
    title: 'Image Too Large',
    message: `The image exceeds ${MAX_IMAGE_DIMENSION}px on one side.`,
    suggestion: 'Resize to under 8000px on the longest side.',
    category: ErrorCategory.VALIDATION,
  },

  // Memory errors
  'canvas-memory': {
    title: 'Out of Memory',
    message: 'The browser ran out of memory while processing this image.',
    suggestion: 'Close other tabs, or use a smaller image (under 4000px recommended).',
    category: ErrorCategory.MEMORY,
  },
  'canvas-too-large': {
    title: 'Canvas Too Large',
    message: 'The image is too large for browser canvas processing.',
    suggestion: 'Resize to under 4000px on the longest side.',
    category: ErrorCategory.MEMORY,
  },

  // Engine errors
  'palette-extraction': {
    title: 'Palette Analysis Failed',
    message: 'Could not extract color palette from the image.',
    suggestion: 'Try a different image — this can happen with very low-contrast or single-color images.',
    category: ErrorCategory.ENGINE,
  },
  'tone-analysis': {
    title: 'Tone Analysis Failed',
    message: 'Could not analyze the tonal distribution.',
    suggestion: 'Try a different image with more tonal variation.',
    category: ErrorCategory.ENGINE,
  },
  'transfer-failed': {
    title: 'Transfer Failed',
    message: 'The color transfer calculation encountered an error.',
    suggestion: 'Try a different mode (Natural is the most stable) or lower the intensity.',
    category: ErrorCategory.ENGINE,
  },
  'xmp-generation': {
    title: 'Preset Generation Failed',
    message: 'Could not generate the XMP preset file.',
    suggestion: 'This is rare — try refreshing the page and starting over.',
    category: ErrorCategory.ENGINE,
  },

  // Export errors
  'download-blocked': {
    title: 'Download Blocked',
    message: 'The browser blocked the file download.',
    suggestion: 'Allow downloads for this site in your browser settings.',
    category: ErrorCategory.EXPORT,
  },

  // Unknown
  'unknown': {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred.',
    suggestion: 'Try refreshing the page. If the problem persists, try a different image.',
    category: ErrorCategory.UNKNOWN,
  },
};

/**
 * Classify an error into a known category.
 */
function classifyError(error) {
  const msg = (error?.message || String(error)).toLowerCase();

  if (msg.includes('out of memory') || msg.includes('canvas memory') || msg.includes('allocation'))
    return 'canvas-memory';
  if (msg.includes('canvas') && (msg.includes('too large') || msg.includes('size')))
    return 'canvas-too-large';
  if (msg.includes('invalid') && msg.includes('image'))
    return 'invalid-image';
  if (msg.includes('palette') || msg.includes('kmeans') || msg.includes('cluster'))
    return 'palette-extraction';
  if (msg.includes('tone') || msg.includes('zone') || msg.includes('cdf'))
    return 'tone-analysis';
  if (msg.includes('transfer') || msg.includes('profile') || msg.includes('delta'))
    return 'transfer-failed';
  if (msg.includes('xmp') || msg.includes('preset') || msg.includes('serialize'))
    return 'xmp-generation';
  if (msg.includes('download') || msg.includes('blob') || msg.includes('url'))
    return 'download-blocked';
  if (msg.includes('securityerror') || msg.includes('not a function') || msg.includes('cannot read'))
    return 'invalid-image';

  return 'unknown';
}

/**
 * Format a user-friendly error from any error type.
 * @param {Error|any} error
 * @param {string} [context] — what operation was being performed
 * @returns {{ title: string, message: string, suggestion: string, category: string, original: string }}
 */
export function formatError(error, context = '') {
  const key = classifyError(error);
  const info = ERROR_MAP[key] || ERROR_MAP.unknown;
  return {
    ...info,
    title: context ? `${info.title} — ${context}` : info.title,
    original: error?.message || String(error),
  };
}

/**
 * Validate an image file before processing.
 * @param {File} file
 * @returns {{ valid: boolean, error?: { title: string, message: string, suggestion: string } }}
 */
export function validateImageFile(file) {
  if (!file) return { valid: false, error: ERROR_MAP['invalid-image'] };
  if (!SUPPORTED_TYPES.has(file.type)) return { valid: false, error: ERROR_MAP['unsupported-format'] };
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) return { valid: false, error: ERROR_MAP['file-too-large'] };
  return { valid: true };
}

/**
 * Validate an HTMLImageElement's dimensions.
 * @param {HTMLImageElement} img
 * @returns {{ valid: boolean, error?: { title: string, message: string, suggestion: string } }}
 */
export function validateImageDimensions(img) {
  const maxDim = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (maxDim > MAX_IMAGE_DIMENSION) return { valid: false, error: ERROR_MAP['image-too-large'] };
  return { valid: true };
}

/**
 * Wrap an async operation with error handling.
 * Returns { ok: true, result } or { ok: false, error }.
 *
 * @param {() => Promise<any>} fn
 * @param {string} context — what operation is being performed
 * @returns {Promise<{ok: true, result: any} | {ok: false, error: object}>}
 */
export async function withErrorHandling(fn, context = '') {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (err) {
    const error = formatError(err, context);
    console.error(`[LUMIXA] ${error.title}:`, error.original);
    return { ok: false, error };
  }
}

/**
 * Show a non-blocking error toast in the UI.
 * Auto-dismisses after 8 seconds.
 *
 * @param {{ title: string, message: string, suggestion: string, category: string }} error
 * @param {HTMLElement} [container] — parent element; defaults to document.body
 */
export function showErrorToast(error, container) {
  const parent = container || document.body;
  const existing = parent.querySelector('.lx-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'lx-error-toast';
  toast.setAttribute('style', `
    position: fixed; bottom: 24px; right: 24px; z-index: 10000;
    max-width: 420px; padding: 20px 24px; border-radius: 12px;
    background: #2a1a1a; border: 1px solid #c17361; color: #f2e8d8;
    font-family: 'Public Sans', system-ui, sans-serif; font-size: 14px;
    box-shadow: 0 12px 40px rgba(0,0,0,.5);
    animation: lumixa-fade-in .3s ease;
  `);

  const categoryColors = {
    [ErrorCategory.VALIDATION]: '#d99a4e',
    [ErrorCategory.MEMORY]: '#c17361',
    [ErrorCategory.ENGINE]: '#c17361',
    [ErrorCategory.EXPORT]: '#d99a4e',
    [ErrorCategory.UNKNOWN]: '#c17361',
  };

  const accentColor = categoryColors[error.category] || '#c17361';

  toast.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:12px;">
      <span style="font-size:20px; color:${accentColor}; flex-shrink:0;">⚠</span>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; margin-bottom:4px; color:${accentColor};">${escapeHtml(error.title)}</div>
        <div style="color:#b9a582; margin-bottom:8px;">${escapeHtml(error.message)}</div>
        <div style="color:#7d6c52; font-size:13px;">💡 ${escapeHtml(error.suggestion)}</div>
      </div>
      <button onclick="this.closest('.lx-error-toast').remove()" style="
        background:none; border:none; color:#7d6c52; cursor:pointer; font-size:18px;
        padding:0 0 0 8px; flex-shrink:0; line-height:1;
      ">✕</button>
    </div>
  `;

  parent.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}

/**
 * Show a success toast.
 */
export function showSuccessToast(message, container) {
  const parent = container || document.body;
  const existing = parent.querySelector('.lx-success-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'lx-success-toast';
  toast.setAttribute('style', `
    position: fixed; bottom: 24px; right: 24px; z-index: 10000;
    max-width: 360px; padding: 16px 20px; border-radius: 12px;
    background: #1a2a1a; border: 1px solid #93ac84; color: #f2e8d8;
    font-family: 'Public Sans', system-ui, sans-serif; font-size: 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    animation: lumixa-fade-in .3s ease;
  `);

  toast.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="font-size:18px; color:#93ac84;">✓</span>
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  parent.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

/**
 * Show a loading overlay on a container element.
 * Returns a hide() function to remove it.
 *
 * @param {HTMLElement} container
 * @param {string} [message='Processing...']
 * @returns {() => void} hide function
 */
export function showLoading(container, message = 'Processing...') {
  const overlay = document.createElement('div');
  overlay.className = 'lx-loading-overlay';
  overlay.setAttribute('style', `
    position: absolute; inset: 0; z-index: 1000;
    background: rgba(21,17,12,.8); backdrop-filter: blur(4px);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; border-radius: inherit;
  `);

  overlay.innerHTML = `
    <div style="
      width: 40px; height: 40px; border: 3px solid #3a2f22; border-top-color: #c9a24b;
      border-radius: 50%; animation: lumixa-spin 1s linear infinite;
    "></div>
    <div style="color: #b9a582; font-size: 14px; font-weight: 500;">${escapeHtml(message)}</div>
  `;

  // Ensure parent has relative positioning
  const prevPos = getComputedStyle(container).position;
  if (prevPos === 'static') container.style.position = 'relative';
  container.appendChild(overlay);

  return () => {
    if (overlay.parentNode) overlay.remove();
    if (prevPos === 'static') container.style.position = prevPos;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
