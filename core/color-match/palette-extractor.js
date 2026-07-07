/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Palette Extractor (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately thin: core/kmeans-engine already performs client-side k-means
 * clustering (k-means++ seeding, Lloyd's algorithm, up to 6000 sampled
 * pixels) and its result already carries every field this EPIC's Palette
 * Extractor requirement asks for — hex, rgb, hsl, luminance, and a
 * population fraction usable as "weight". Re-implementing clustering here
 * would directly violate "Do not duplicate existing engines if equivalent
 * logic already exists" — so this module ONLY adapts field names/shape for
 * the Reference Color Match UI and adds no new pixel analysis.
 *
 * kmeans-engine's own K constant is fixed at 8, which already sits inside
 * this EPIC's requested 5–12 dominant colours — nothing to adjust there.
 */
import { extractPalette } from '../kmeans-engine/index.js';

/**
 * Extracts the dominant palette from a decoded <img> element.
 * @param {HTMLImageElement} img
 * @returns {Promise<{ colors: Array<{hex:string, rgb:{r,g,b}, hsl:{h,s,l}, luminance:number, weight:number, role:string, rank:number}>, dominant: object }>}
 */
export async function extractReferencePalette(img) {
  const raw = await extractPalette(img); // reuse existing k-means clustering — no re-implementation
  const adapt = c => c && ({
    hex: c.hex, rgb: { r: c.r, g: c.g, b: c.b }, hsl: { ...c.hsl },
    luminance: c.luminance, weight: +c.population.toFixed(4), // "population" renamed to this EPIC's requested "weight"
    role: c.role, rank: c.rank,
  });
  return {
    colors: raw.colors.map(adapt),
    dominant: adapt(raw.dominant),
    shadow: adapt(raw.shadow),
    highlight: adapt(raw.highlight),
    confidence: raw.confidence,
  };
}
