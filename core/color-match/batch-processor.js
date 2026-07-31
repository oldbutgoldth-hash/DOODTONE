/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUMIXA — Batch Processing Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Apply a single reference-derived color transfer preset to multiple target
 * images. Each image goes through the full pipeline:
 *   palette extraction → tone zone analysis → color transfer → preservation → XMP export
 *
 * Usage:
 *   import { processBatch } from './batch-processor.js';
 *   const results = await processBatch({ referenceImg, targetImages, intensity, mode, onProgress });
 */

import { extractPalette } from '../core/kmeans-engine/index.js';
import { analyzeZones } from '../core/color-match/tone-zone-analyzer.js';
import { buildColorTransferProfile } from '../core/color-match/color-transfer-engine.js';
import { applyPreservation } from '../core/color-match/preserve-engine.js';
import { buildFinalPreset } from '../core/decision-engine/index.js';
import { validateFinalPreset, quickSafetyClamp } from '../core/xmp-validator/index.js';
import { serializeXMP } from '../core/preset-engine/index.js';

/**
 * Process a batch of target images using a single reference image.
 *
 * @param {object} params
 * @param {HTMLImageElement} params.referenceImg — the reference image (analyzed once)
 * @param {HTMLImageElement[]} params.targetImages — array of target images to process
 * @param {number} [params.intensity=60] — 0–100 transfer strength
 * @param {string} [params.mode='Natural'] — transfer mode
 * @param {boolean} [params.preserveSkinTone=true] — enable skin protection
 * @param {boolean} [params.protectHighlights=true] — enable highlight protection
 * @param {boolean} [params.protectShadows=true] — enable shadow protection
 * @param {function} [params.onProgress] — callback(index, total, imageName, status)
 * @returns {Promise<Array<{name: string, xmp: string, status: string, error?: string}>>}
 */
export async function processBatch({
  referenceImg,
  targetImages,
  intensity = 60,
  mode = 'Natural',
  preserveSkinTone = true,
  protectHighlights = true,
  protectShadows = true,
  onProgress,
}) {
  if (!referenceImg || !targetImages?.length) {
    throw new Error('processBatch requires referenceImg and at least one targetImage');
  }

  // Analyze reference image once
  const refPalette = await extractPalette(referenceImg);
  const refZones = await analyzeZones(referenceImg);

  const results = [];
  const total = targetImages.length;

  for (let i = 0; i < total; i++) {
    const target = targetImages[i];
    const name = target.name || `image_${i + 1}`;

    try {
      onProgress?.(i, total, name, 'analyzing');

      // Analyze target
      const tgtPalette = await extractPalette(target);
      const tgtZones = await analyzeZones(target);

      // Build transfer profile
      const profile = buildColorTransferProfile({
        referencePalette: refPalette,
        referenceToneZones: refZones,
        targetToneZones: tgtZones,
        intensity,
        mode,
      });

      // Apply preservation
      const preserved = await applyPreservation(profile, target, {
        preserveSkinTone,
        protectHighlights,
        protectShadows,
      });

      onProgress?.(i, total, name, 'generating_xmp');

      // Build final preset
      const preset = buildFinalPreset(preserved, tgtPalette, tgtZones);

      // Validate and safety-clamp
      const validated = validateFinalPreset(preset, null);
      const clamped = quickSafetyClamp(validated.preset);

      // Serialize to XMP
      const xmp = serializeXMP(clamped, `${name} — LUMIXA ${mode} ${intensity}%`);

      results.push({ name, xmp, status: 'success' });
      onProgress?.(i, total, name, 'done');
    } catch (err) {
      results.push({ name, xmp: '', status: 'error', error: err.message });
      onProgress?.(i, total, name, 'error');
    }
  }

  return results;
}

/**
 * Download all XMP results as individual files.
 * @param {Array<{name: string, xmp: string, status: string}>} results
 */
export function downloadBatch(results) {
  const successes = results.filter(r => r.status === 'success' && r.xmp);
  for (const r of successes) {
    const baseName = r.name.replace(/\.[^.]+$/, '');
    const blob = new Blob([r.xmp], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.xmp`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * Get batch processing summary.
 * @param {Array<{name: string, status: string, error?: string}>} results
 * @returns {{ total: number, success: number, failed: number, errors: Array<{name: string, error: string}> }}
 */
export function getBatchSummary(results) {
  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const errors = results.filter(r => r.status === 'error').map(r => ({ name: r.name, error: r.error }));
  return { total: results.length, success, failed, errors };
}
