/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH PANEL (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standalone controller for the Reference Color Match feature — deliberately
 * a SEPARATE module from ui/app.js, with its own local state object, so the
 * main analyse→map→validate→export pipeline in ui/app.js is completely
 * unaffected by this feature (per "Do not break existing pipeline").
 *
 * The only cross-module dependency is calling into core/color-match/*,
 * which itself wraps existing core engines (kmeans, histogram, skin
 * classifier, preset-engine, xmp-validator) rather than duplicating them.
 */
import { extractReferencePalette } from '../core/color-match/palette-extractor.js';
import { analyzeToneZones } from '../core/color-match/tone-zone-analyzer.js';
import { buildColorTransferProfile, AVAILABLE_MODES } from '../core/color-match/color-transfer-engine.js';
import { applyPreservation } from '../core/color-match/preserve-engine.js';
import { generateReferenceMatchXMP, downloadReferenceMatchXMP } from '../core/color-match/reference-xmp-generator.js';
import { buildReferenceColorIntelligence } from '../core/color-match/color-match-intelligence-bridge.js';

// Local, self-contained state — intentionally not shared with ui/app.js's own `state`.
const rcm = {
  referenceImg: null, targetImg: null,
  referencePalette: null, referenceToneZones: null, targetToneZones: null,
  rawProfile: null, finalProfile: null,
  intensity: 60, mode: 'Natural',
  toggles: { preserveSkinTone: true, protectHighlights: true, protectShadows: true },
  referenceColorIntelligence: null, // EPIC 1.3
};

function $(id) { return document.getElementById(id); }

// ─── Image loading (independent of ui/app.js's own loadFile/handleReset) ──
function _loadImageFile(file, onReady) {
  if (!file?.type?.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => onReady(img);
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Palette / tone-zone display ──────────────────────────────────────────
function _renderPalette(palette) {
  const el = $('rcmPaletteSwatches');
  if (!el) return;
  el.innerHTML = palette.colors.map(c => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0">
      <div style="width:100%;aspect-ratio:1;border-radius:3px;border:1px solid var(--border);background:${c.hex}" title="${c.hex} — ${c.role}"></div>
      <span style="font-family:var(--font-mono);font-size:8.5px;color:var(--text-dim);white-space:nowrap">${c.hex}</span>
      <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-faint);text-transform:uppercase">${Math.round(c.weight*100)}%</span>
    </div>`).join('');
}

function _zoneCardHtml(label, zone) {
  return `
    <div style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px;min-width:0">
      <div style="font-family:var(--font-mono);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:6px">${label}</div>
      <div style="width:100%;height:28px;border-radius:2px;background:${zone.avgColor.hex};border:1px solid var(--border);margin-bottom:6px"></div>
      <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim)">Sat ${zone.saturation}% · Warmth ${zone.temperatureHint > 0 ? '+' : ''}${zone.temperatureHint}</div>
    </div>`;
}

function _renderToneZones(zones) {
  const el = $('rcmToneZones');
  if (!el) return;
  el.innerHTML = _zoneCardHtml('Shadow', zones.shadow) + _zoneCardHtml('Midtone', zones.midtone) + _zoneCardHtml('Highlight', zones.highlight);
}

// ─── EPIC 1.3: Photographer Intelligence section (compact, JS-injected) ───
// Deliberately built via createElement rather than adding markup to
// index.html (index.html is outside this EPIC's allowed directories) —
// reuses the exact same CSS custom properties/typography the rest of the
// panel already uses, so it never needs its own layout/responsive rules.
function _ensurePhotographerIntelSection() {
  let el = $('rcmPhotographerIntelSection');
  if (el) return el;
  const toneZonesEl = $('rcmToneZones');
  const card = toneZonesEl?.parentElement; // the existing "Extracted Palette / Tone Zones" card
  if (!card) return null;
  el = document.createElement('div');
  el.id = 'rcmPhotographerIntelSection';
  el.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--border)';
  card.appendChild(el);
  return el;
}

function _renderPhotographerIntelligence(rci) {
  const el = _ensurePhotographerIntelSection();
  if (!el || !rci) return;
  const likely = rci.styleHints?.[0];
  const chip = (label, value) => `<span style="background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:4px 10px;font-size:11px;color:var(--text)">${label}: <b style="color:var(--accent)">${value}</b></span>`;
  el.innerHTML = `
    <div style="font-family:var(--font-mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:10px">Photographer Intelligence</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      ${chip('Mood', rci.colorMood)}
      ${likely ? chip('Likely Style', likely.styleName) : ''}
      ${chip('Reference Strength', Math.round(rci.confidence * 100) + '%')}
    </div>
    <div style="font-size:11.5px;color:var(--text-dim);line-height:1.6">
      <div>Palette signature: ${rci.paletteSignature.summary}</div>
      <div>Supporting evidence: ${(rci.styleHints ?? []).map(h => `${h.styleName} (${Math.round(h.matchScore*100)}%)`).join(', ') || 'none'}</div>
      ${rci.risks.length ? `<div style="color:var(--warn,#c9a24b);margin-top:4px">⚠ ${rci.risks.join(' ')}</div>` : ''}
    </div>`;
}

// ─── Approximate before/after canvas preview ──────────────────────────────
// NOTE: this is an approximate, fast, browser-only preview of the transfer
// profile's effect — it is NOT a colour-accurate simulation of Lightroom's
// actual RAW processing pipeline (that would require a much heavier
// colour-managed rendering path, explicitly out of scope per "no heavy
// dependency"). Its purpose is to give the photographer a quick visual
// sense of direction/intensity before committing to a download.
function _renderPreview(img, canvasId, profile) {
  const canvas = $(canvasId);
  if (!canvas || !img) return;
  const MAX_W = 480;
  const scale = Math.min(1, MAX_W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  if (!profile) return; // "before" — untouched draw only

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const expFactor = 1 + profile.tone.exposure / 200;
  const conFactor = 1 + profile.tone.contrast / 150;
  const vibFactor = 1 + profile.presence.vibrance / 200;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    // White balance (simple channel-shift approximation)
    r += profile.wb.temp * 0.5; b -= profile.wb.temp * 0.5;
    g += profile.wb.tint * 0.3; r -= profile.wb.tint * 0.15; b -= profile.wb.tint * 0.15;
    // Exposure + contrast (pivoted at mid-grey)
    r *= expFactor; g *= expFactor; b *= expFactor;
    r = 128 + (r - 128) * conFactor; g = 128 + (g - 128) * conFactor; b = 128 + (b - 128) * conFactor;
    // Vibrance-style saturation nudge (scale distance from the pixel's own grey level)
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * vibFactor; g = avg + (g - avg) * vibFactor; b = avg + (b - avg) * vibFactor;

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(imageData, 0, 0);
}

// ─── Core actions ──────────────────────────────────────────────────────────
async function analyzeReference() {
  if (!rcm.referenceImg) { _setStatus('กรุณาอัปโหลดภาพอ้างอิงก่อน'); return; }
  _setStatus('กำลังวิเคราะห์ภาพอ้างอิง…');
  rcm.referencePalette = await extractReferencePalette(rcm.referenceImg);
  rcm.referenceToneZones = await analyzeToneZones(rcm.referenceImg);
  _renderPalette(rcm.referencePalette);
  _renderToneZones(rcm.referenceToneZones);
  _renderPreview(rcm.referenceImg, 'rcmRefCanvas', null);

  // EPIC 1.3: Reference Color Intelligence — computed from the same
  // palette/tone-zone data already extracted above, no new analysis.
  rcm.referenceColorIntelligence = buildReferenceColorIntelligence({
    palette: rcm.referencePalette, toneZones: rcm.referenceToneZones,
    transferProfile: null, preserveReport: null,
  });
  _renderPhotographerIntelligence(rcm.referenceColorIntelligence);

  _setStatus(`✓ วิเคราะห์ภาพอ้างอิงเสร็จแล้ว — ${rcm.referencePalette.colors.length} สีหลัก, ความเชื่อมั่นพาเลท ${Math.round((rcm.referencePalette.confidence ?? 0)*100)}%`);
  await _rebuildAndPreview();
}

async function _rebuildAndPreview() {
  if (!rcm.referenceToneZones || !rcm.targetImg) return;

  // Reset immediately — before the (async) recompute below finishes —
  // so Generate/Download can never act on a profile that belonged to a
  // PREVIOUS Intensity/Mode/toggle setting. This is the "รีเซต" the
  // panel now performs on every parameter change, not just a rebuild.
  rcm.finalProfile = null;
  rcm.rawProfile = null;
  $('rcmGenerateBtn')?.setAttribute('disabled', 'true');
  $('rcmDownloadBtn')?.setAttribute('disabled', 'true');
  $('rcmSaveAfterBtn')?.setAttribute('disabled', 'true');
  const updatingEl = $('rcmAfterUpdating');
  if (updatingEl) updatingEl.style.opacity = '1';

  if (!rcm.targetToneZones) rcm.targetToneZones = await analyzeToneZones(rcm.targetImg);

  // Full re-analysis of the transfer profile for the CURRENT Intensity/
  // Mode/toggle values — this is the "re-analysis" the panel now performs
  // on every Intensity change, not only on first load.
  rcm.rawProfile = buildColorTransferProfile({
    referencePalette: rcm.referencePalette, referenceToneZones: rcm.referenceToneZones,
    targetToneZones: rcm.targetToneZones, intensity: rcm.intensity, mode: rcm.mode,
  });
  rcm.finalProfile = await applyPreservation(rcm.rawProfile, rcm.targetImg, rcm.toggles);

  _renderPreview(rcm.targetImg, 'rcmBeforeCanvas', null);
  _renderPreview(rcm.targetImg, 'rcmAfterCanvas', rcm.finalProfile); // "After" now reflects the CURRENT Intensity/Mode before any Generate/Download is possible
  _renderReasons(rcm.finalProfile);

  if (updatingEl) updatingEl.style.opacity = '0';
  $('rcmGenerateBtn')?.removeAttribute('disabled');
  $('rcmDownloadBtn')?.removeAttribute('disabled');
  $('rcmSaveAfterBtn')?.removeAttribute('disabled');
}

function _renderReasons(profile) {
  const el = $('rcmReasons');
  if (!el) return;
  const all = [...(profile.reasons ?? []), ...(profile.preservationNotes ?? [])];
  el.innerHTML = all.map(r => `<li style="margin-bottom:4px">${r}</li>`).join('');
}

function _setStatus(text) {
  const el = $('rcmStatus');
  if (el) el.textContent = text;
}

function generateXMP() {
  if (!rcm.finalProfile) { _setStatus('กรุณาวิเคราะห์และเชื่อมภาพก่อนสร้าง XMP'); return; }
  const { xmp, safetyAdjustments } = generateReferenceMatchXMP(rcm.finalProfile, 'LUMIXA-Reference-Match');
  $('rcmDownloadBtn').dataset.ready = '1';
  _setStatus(`✓ สร้าง XMP สำเร็จ${safetyAdjustments.length ? ` (ปรับความปลอดภัย ${safetyAdjustments.length} จุด)` : ''} — พร้อมดาวน์โหลด`);
  return xmp;
}

function downloadXMPFile() {
  if (!rcm.finalProfile) { _setStatus('กรุณาสร้าง XMP ก่อนดาวน์โหลด'); return; }
  downloadReferenceMatchXMP(rcm.finalProfile, 'LUMIXA-Reference-Match');
}

/**
 * Saves the current "After" canvas (the target image with the reference
 * colour transfer applied, per the current Intensity/Mode/Preserve
 * settings) as a downloadable PNG. Pure browser Canvas API — no new
 * dependency, no core engine involvement, since this is an image export,
 * not an XMP preset export (which downloadXMPFile()/reference-xmp-
 * generator.js already handle via the existing preset-engine).
 */
function saveAfterImage() {
  const canvas = $('rcmAfterCanvas');
  if (!canvas || !rcm.finalProfile) { _setStatus('กรุณาปรับค่าให้ภาพ After พร้อมก่อนบันทึก'); return; }
  canvas.toBlob((blob) => {
    if (!blob) { _setStatus('ไม่สามารถบันทึกภาพ After ได้'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'LUMIXA-Reference-Match-After.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _setStatus('✓ บันทึกภาพ After แล้ว (LUMIXA-Reference-Match-After.png)');
  }, 'image/png');
}

// ─── Wiring ────────────────────────────────────────────────────────────────
export function initReferenceColorMatchPanel() {
  const refInput = $('rcmRefFileIn');
  const tgtInput = $('rcmTargetFileIn');
  if (!refInput || !tgtInput) return; // panel not present in this build — no-op

  refInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    _loadImageFile(file, (img) => {
      rcm.referenceImg = img;
      // Show the newly-selected reference image immediately — don't wait
      // for "Analyze Reference" to be clicked. Also clear any previously
      // computed palette/tone-zone/profile data since they belonged to
      // the OLD reference image and would otherwise silently stay stale.
      rcm.referencePalette = null; rcm.referenceToneZones = null;
      rcm.rawProfile = null; rcm.finalProfile = null;
      _renderPreview(img, 'rcmRefCanvas', null);
      if ($('rcmPaletteSwatches')) $('rcmPaletteSwatches').innerHTML = '';
      if ($('rcmToneZones')) $('rcmToneZones').innerHTML = '';
      if ($('rcmReasons')) $('rcmReasons').innerHTML = '';
      _setStatus('ภาพอ้างอิงโหลดแล้ว — กด "วิเคราะห์ภาพอ้างอิง"');
    });
  });
  tgtInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    _loadImageFile(file, async (img) => {
      rcm.targetImg = img; rcm.targetToneZones = null;
      _renderPreview(img, 'rcmBeforeCanvas', null);
      await _rebuildAndPreview();
    });
  });

  $('rcmAnalyzeBtn')?.addEventListener('click', analyzeReference);
  $('rcmGenerateBtn')?.addEventListener('click', generateXMP);
  $('rcmDownloadBtn')?.addEventListener('click', downloadXMPFile);
  $('rcmSaveAfterBtn')?.addEventListener('click', saveAfterImage);

  // Two Intensity sliders control the SAME rcm.intensity value — the
  // original one in the shared Controls card, and a second one placed
  // directly beside the After canvas for quick, colocated access. Neither
  // is a separate "preview-only" concept: both drive the one profile that
  // is later used for the After preview AND the exported XMP, so what the
  // photographer sees always matches what they download.
  const _syncIntensityUI = (value) => {
    $('rcmIntensityValue').textContent = value;
    $('rcmAfterIntensityValue').textContent = value;
    if ($('rcmIntensitySlider')) $('rcmIntensitySlider').value = value;
    if ($('rcmAfterIntensitySlider')) $('rcmAfterIntensitySlider').value = value;
  };
  const _onIntensityInput = async (e) => {
    rcm.intensity = +e.target.value;
    _syncIntensityUI(rcm.intensity);
    await _rebuildAndPreview();
  };
  $('rcmIntensitySlider')?.addEventListener('input', _onIntensityInput);
  $('rcmAfterIntensitySlider')?.addEventListener('input', _onIntensityInput);

  $('rcmModeSelect')?.addEventListener('change', async (e) => {
    rcm.mode = e.target.value;
    await _rebuildAndPreview();
  });

  for (const key of Object.keys(rcm.toggles)) {
    $(`rcmToggle_${key}`)?.addEventListener('change', async (e) => {
      rcm.toggles[key] = e.target.checked;
      await _rebuildAndPreview();
    });
  }

  // Populate mode selector options from the engine's own AVAILABLE_MODES —
  // never hard-coded twice.
  const modeSelect = $('rcmModeSelect');
  if (modeSelect && modeSelect.options.length === 0) {
    modeSelect.innerHTML = AVAILABLE_MODES.map(m => `<option value="${m}">${m}</option>`).join('');
  }
}
