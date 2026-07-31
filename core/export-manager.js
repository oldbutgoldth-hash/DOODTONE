/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUMIXA — Export Manager
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Multiple export options for LUMIXA presets:
 *   - .xmp file download (Lightroom/Camera Raw/Capture One)
 *   - Copy XMP to clipboard
 *   - Download as .lrtemplate (older Lightroom versions)
 *   - Export diagnostic report
 *
 * Usage:
 *   import { exportXMP, copyXMPToClipboard, exportDiagnostics } from '../core/export-manager.js';
 *   await exportXMP(xmpString, 'my-preset');
 *   await copyXMPToClipboard(xmpString);
 */

/**
 * Download XMP as a .xmp file.
 * @param {string} xmpString — serialized XMP content
 * @param {string} [filename='lumixa-preset'] — base filename (without extension)
 * @returns {{ ok: boolean, error?: string }}
 */
export async function exportXMP(xmpString, filename = 'lumixa-preset') {
  try {
    const safeName = _sanitizeFilename(filename);
    const blob = new Blob([xmpString], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.xmp`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Copy XMP content to clipboard.
 * @param {string} xmpString
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function copyXMPToClipboard(xmpString) {
  try {
    await navigator.clipboard.writeText(xmpString);
    return { ok: true };
  } catch {
    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = xmpString;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

/**
 * Export transfer diagnostics as a JSON report.
 * Useful for debugging and support.
 *
 * @param {object} diagnostics — collected diagnostic data from the pipeline
 * @param {string} [filename='lumixa-diagnostics']
 * @returns {{ ok: boolean, error?: string }}
 */
export async function exportDiagnostics(diagnostics, filename = 'lumixa-diagnostics') {
  try {
    const report = {
      generatedAt: new Date().toISOString(),
      version: '1.5.0',
      userAgent: navigator.userAgent,
      ...diagnostics,
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${_sanitizeFilename(filename)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Generate a shareable preset summary (text format).
 * @param {object} profile — the color transfer profile
 * @param {string} mode
 * @param {number} intensity
 * @returns {string}
 */
export function generatePresetSummary(profile, mode, intensity) {
  const lines = [
    `LUMIXA Preset Summary`,
    `Mode: ${mode} | Intensity: ${intensity}%`,
    ``,
    `White Balance:`,
    `  Temperature: ${profile.wb?.temp ?? 0 > 0 ? '+' : ''}${profile.wb?.temp ?? 0}`,
    `  Tint: ${profile.wb?.tint ?? 0 > 0 ? '+' : ''}${profile.wb?.tint ?? 0}`,
    ``,
    `Tone:`,
    `  Exposure: ${profile.tone?.exposure ?? 0 > 0 ? '+' : ''}${profile.tone?.exposure ?? 0}`,
    `  Contrast: ${profile.tone?.contrast ?? 0 > 0 ? '+' : ''}${profile.tone?.contrast ?? 0}`,
    `  Highlights: ${profile.tone?.highlights ?? 0 > 0 ? '+' : ''}${profile.tone?.highlights ?? 0}`,
    `  Shadows: ${profile.tone?.shadows ?? 0 > 0 ? '+' : ''}${profile.tone?.shadows ?? 0}`,
    `  Whites: ${profile.tone?.whites ?? 0 > 0 ? '+' : ''}${profile.tone?.whites ?? 0}`,
    `  Blacks: ${profile.tone?.blacks ?? 0 > 0 ? '+' : ''}${profile.tone?.blacks ?? 0}`,
    ``,
    `Presence:`,
    `  Vibrance: ${profile.presence?.vibrance ?? 0 > 0 ? '+' : ''}${profile.presence?.vibrance ?? 0}`,
    `  Saturation: ${profile.presence?.saturation ?? 0 > 0 ? '+' : ''}${profile.presence?.saturation ?? 0}`,
  ];

  if (profile.detail) {
    lines.push('', 'Detail:');
    lines.push(`  Clarity: ${profile.detail.clarity ?? 0 > 0 ? '+' : ''}${profile.detail.clarity ?? 0}`);
    lines.push(`  Dehaze: ${profile.detail.dehaze ?? 0 > 0 ? '+' : ''}${profile.detail.dehaze ?? 0}`);
    lines.push(`  Texture: ${profile.detail.texture ?? 0 > 0 ? '+' : ''}${profile.detail.texture ?? 0}`);
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 100);
}
