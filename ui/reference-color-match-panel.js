/**
 * LUMIXA Reference Color Match — EPIC 2E-N1..N5 complete candidate pipeline.
 *
 * Reference/Target analysis → photographic compensation → bounded Lightroom
 * candidate → matched preview/re-analysis → local evaluation record.
 * The main Production pipeline remains Legacy and cannot be mutated here.
 */
import { extractReferencePalette } from '../core/color-match/palette-extractor.js';
import { analyzeToneZones } from '../core/color-match/tone-zone-analyzer.js';
import { classifySkin } from '../core/skin-classifier/index.js';
import { analyzeImage } from '../core/histogram-engine/index.js';
import { buildReferenceColorIntelligence } from '../core/color-match/color-match-intelligence-bridge.js';
import { buildCoreColorMatchPipeline } from '../core/color-match/core-color-match-pipeline.js';
import { renderColorMatchCandidateToCanvas } from '../core/color-match/candidate-preview-renderer.js';
import {
  buildMatchedSignatureFromAnalysis,
  evaluateMatchedSignature,
  createColorMatchEvaluationRecord,
} from '../core/color-match/match-evaluation-engine.js';
import { createColorMatchEvaluationStore } from '../core/color-match/evaluation-store.js';
import { downloadXMP } from '../core/preset-engine/index.js';
import { evaluateLightroomRoundTrip } from '../core/color-match/lightroom-roundtrip-fidelity-engine.js';

const MODES = Object.freeze({ Natural: 1, Cinematic: 1.08, Vintage: 0.92, Soft: 0.78, Bold: 1.15 });
const DECISIONS = Object.freeze([
  ['NOT_REVIEWED', 'ยังไม่ได้ตรวจ'],
  ['MATCH_ACCEPTED', 'ผล Match ใช้งานได้'],
  ['MATCH_NEEDS_ADJUSTMENT', 'ต้องปรับเพิ่มเติม'],
  ['MATCH_REJECTED', 'ผล Match ยังใช้ไม่ได้'],
  ['NOT_SURE', 'ยังไม่แน่ใจ'],
]);
const ISSUE_CODES = Object.freeze([
  ['WB_MISMATCH', 'สมดุลแสงขาวยังไม่ใกล้'],
  ['TINT_MISMATCH', 'Tint ยังไม่ใกล้'],
  ['TONE_MISMATCH', 'ความสว่าง/คอนทราสต์ยังไม่ใกล้'],
  ['PALETTE_MISMATCH', 'สีหลักยังไม่ใกล้'],
  ['SKIN_UNNATURAL', 'สีผิวไม่เป็นธรรมชาติ'],
  ['HIGHLIGHT_DAMAGE', 'ไฮไลต์เสียรายละเอียด'],
  ['SHADOW_DAMAGE', 'เงามืดเสียรายละเอียด'],
  ['PREVIEW_XMP_MISMATCH', 'Preview กับ XMP ไม่สอดคล้อง'],
]);

const rcm = {
  referenceImg: null,
  targetImg: null,
  targetFile: null,
  targetMediaOverride: 'AUTO',
  lightroomResultImg: null,
  referenceEvidence: null,
  targetEvidence: null,
  matchedEvidence: null,
  previewMatchedSignature: null,
  lightroomResultEvidence: null,
  roundTripFidelity: null,
  referenceColorIntelligence: null,
  corePipeline: null,
  evaluation: null,
  previewMetrics: null,
  intensity: 60,
  mode: 'Natural',
  toggles: { preserveSkinTone: true, protectHighlights: true, protectShadows: true },
  generationId: null,
  candidateReadyForDownload: false,
  store: null,
  storedRecordCount: 0,
};

function $(id) { return document.getElementById(id); }
function signed(value, digits = 1) { const n = Number(value) || 0; return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function _setStatus(text) { const el = $('rcmStatus'); if (el) el.textContent = text; }

function _loadImageFile(file, onReady) {
  if (!file?.type?.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = event => {
    const img = new Image();
    img.onload = () => onReady(img);
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function _drawOriginal(img, canvasId, maxWidth = 640) {
  const canvas = $(canvasId);
  if (!canvas || !img) return;
  const width0 = img.naturalWidth || img.width;
  const height0 = img.naturalHeight || img.height;
  const scale = Math.min(1, maxWidth / Math.max(1, width0));
  canvas.width = Math.max(1, Math.round(width0 * scale));
  canvas.height = Math.max(1, Math.round(height0 * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
}

function _canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Matched preview image decode failed.'));
    img.src = canvas.toDataURL('image/png');
  });
}

async function _analyzeEvidence(img) {
  const [palette, toneZones, skinAnalysis, histogram] = await Promise.all([
    extractReferencePalette(img),
    analyzeToneZones(img),
    classifySkin(img),
    analyzeImage(img),
  ]);
  return { palette, toneZones, skinAnalysis, histogram };
}

function _renderPalette(palette) {
  const el = $('rcmPaletteSwatches');
  if (!el || !palette?.colors) return;
  el.innerHTML = palette.colors.map(color => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:0">
      <div style="width:100%;aspect-ratio:1;border-radius:3px;border:1px solid var(--border);background:${color.hex}" title="${color.hex} — ${escapeHtml(color.role)}"></div>
      <span style="font-family:var(--font-mono);font-size:8.5px;color:var(--text-dim);white-space:nowrap">${color.hex}</span>
      <span style="font-family:var(--font-mono);font-size:8px;color:var(--text-faint);text-transform:uppercase">${Math.round(color.weight * 100)}%</span>
    </div>`).join('');
}

function _zoneCardHtml(label, zone) {
  return `<div style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:10px;min-width:0">
    <div style="font-family:var(--font-mono);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:6px">${label}</div>
    <div style="width:100%;height:28px;border-radius:2px;background:${zone.avgColor.hex};border:1px solid var(--border);margin-bottom:6px"></div>
    <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim)">Sat ${zone.saturation}% · Warmth ${signed(zone.temperatureHint, 0)}</div>
  </div>`;
}
function _renderToneZones(zones) {
  const el = $('rcmToneZones');
  if (el && zones) el.innerHTML = _zoneCardHtml('Shadow', zones.shadow) + _zoneCardHtml('Midtone', zones.midtone) + _zoneCardHtml('Highlight', zones.highlight);
}

function _ensurePhotographerIntelSection() {
  let el = $('rcmPhotographerIntelSection');
  if (el) return el;
  const card = $('rcmToneZones')?.parentElement;
  if (!card) return null;
  el = document.createElement('div');
  el.id = 'rcmPhotographerIntelSection';
  el.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--border)';
  card.appendChild(el);
  return el;
}
function _renderPhotographerIntelligence(intel) {
  const el = _ensurePhotographerIntelSection();
  if (!el || !intel) return;
  const likely = intel.styleHints?.[0];
  const chip = (label, value) => `<span style="background:var(--surface-2);border:1px solid var(--border);border-radius:3px;padding:4px 10px;font-size:11px;color:var(--text)">${label}: <b style="color:var(--accent)">${escapeHtml(value)}</b></span>`;
  el.innerHTML = `<div style="font-family:var(--font-mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:10px">Photographer Intelligence</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">${chip('Mood', intel.colorMood)}${likely ? chip('Likely Style', likely.styleName) : ''}${chip('Reference Strength', Math.round(intel.confidence * 100) + '%')}</div>
    <div style="font-size:11.5px;color:var(--text-dim);line-height:1.6">${escapeHtml(intel.paletteSignature.summary)}</div>`;
}

function _ensureCoreMatchInspector() {
  let el = $('rcmCoreMatchInspector');
  if (el) return el;
  const reasons = $('rcmReasons');
  const card = reasons?.parentElement;
  if (!card) return null;
  el = document.createElement('section');
  el.id = 'rcmCoreMatchInspector';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'margin:0 0 16px;padding:14px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2)';
  card.insertBefore(el, reasons);
  return el;
}

const MATCH_LABELS = {
  INSUFFICIENT_EVIDENCE: 'หลักฐานยังไม่เพียงพอ',
  ALREADY_CLOSE: 'ภาพใกล้กันอยู่แล้ว',
  MATCH_ADJUSTMENT_NEEDED: 'ต้องปรับเพื่อให้ใกล้ภาพต้นแบบ',
  LARGE_ADJUSTMENT_REVIEW_REQUIRED: 'ต้องปรับมากและควรตรวจด้วยสายตา',
};
const EVAL_LABELS = {
  MATCH_CANDIDATE_STRONG: 'ผล Match ใกล้ภาพต้นแบบชัดเจน',
  MATCH_CANDIDATE_IMPROVED: 'ผล Match ดีขึ้น',
  MATCH_CANDIDATE_PARTIAL: 'ผล Match ดีขึ้นบางส่วน',
  MATCH_CANDIDATE_REGRESSION: 'ผล Match ถอยหลัง ต้องแก้ Engine',
  MATCH_CANDIDATE_PROTECTION_REGRESSION: 'ผล Match ทำให้สีขาวหรือผิวถอยหลัง',
};
const ROUNDTRIP_LABELS = {
  ROUND_TRIP_STRONG: 'Preview กับ Lightroom ใกล้เคียงมาก',
  ROUND_TRIP_ACCEPTABLE: 'Preview กับ Lightroom ใกล้เคียงในระดับใช้งานทดสอบได้',
  ROUND_TRIP_REVIEW_REQUIRED: 'Preview กับ Lightroom ยังมี Drift ที่ต้องตรวจ',
  ROUND_TRIP_REGRESSION: 'ผล Lightroom ถอยหลังหรือเดินคนละทิศกับ Preview',
};

function _renderCoreMatchInspector() {
  const el = _ensureCoreMatchInspector();
  if (!el) return;
  const pipeline = rcm.corePipeline;
  if (!pipeline?.analysis?.delta) {
    el.dataset.coreMatchStage = 'WAITING_FOR_REFERENCE_AND_TARGET';
    el.innerHTML = '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">Core Color Match N1–N5 — รอภาพต้นแบบและภาพเป้าหมาย</div>';
    return;
  }
  const { analysis, compensation, candidate } = pipeline;
  const delta = analysis.delta;
  const evaluation = rcm.evaluation;
  el.dataset.coreMatchStage = evaluation ? 'N5_EVALUATION_READY' : pipeline.stage;
  el.dataset.matchState = delta.matchState;
  el.dataset.compensationState = compensation.state;
  el.dataset.candidateState = candidate.candidateState;
  el.dataset.productionSource = 'legacy';
  el.dataset.productionWrite = 'false';
  el.dataset.xmpWriteAllowed = 'false';
  el.dataset.candidateXmpInMemoryOnly = 'true';
  el.dataset.evaluationStatus = evaluation?.status ?? 'PENDING';
  el.dataset.roundTripStatus = rcm.roundTripFidelity?.status ?? 'NOT_TESTED';
  const chip = (label, value) => `<span style="padding:5px 9px;border:1px solid var(--border);border-radius:3px;font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">${label}: <b style="color:var(--text)">${escapeHtml(value)}</b></span>`;
  const p = candidate.safePreset;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <div><div style="font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)">Core Color Match · N1 → N5</div>
      <div style="font-size:12px;color:var(--text);margin-top:4px">${MATCH_LABELS[delta.matchState] ?? delta.matchState}${evaluation ? ` · ${EVAL_LABELS[evaluation.status] ?? evaluation.status}` : ''}</div></div>
      <span style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint)">Candidate XMP เท่านั้น · Production ยังเป็น Legacy</span>
    </div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:8px 0 6px">N1 · SIGNATURE DIFFERENCE</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Match Need', `${delta.matchNeedScore.toFixed(1)}/100`)}${chip('Evidence', `${Math.round(delta.evidence.combinedConfidence * 100)}%`)}${chip('WB Δ', signed(delta.whiteBalance.warmth))}${chip('Tint Δ', signed(delta.whiteBalance.tint))}${chip('Palette', delta.color.paletteDistance.toFixed(2))}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">N2 · PHOTOGRAPHIC COMPENSATION</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Illuminant', `${Math.round(compensation.illuminant.illuminantConfidence * 100)}%`)}${chip('Object Bias', `${Math.round(compensation.objectColorBias.score * 100)}%`)}${chip('Skin Protect', compensation.skinProtection.active ? `${Math.round(compensation.skinProtection.protectionStrength * 100)}%` : 'ไม่พบผิว')}${chip('Highlight Risk', `${Math.round(compensation.dynamicRange.highlightRisk * 100)}%`)}${chip('White Protect', `${Math.round((compensation.targetProtection?.neutralWhite?.strength || 0) * 100)}%`)}${chip('Scene Channels', `${compensation.targetProtection?.sceneColor?.sharedCount || 0} shared`)}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">N3 · LIGHTROOM CANDIDATE</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Temp', signed(p.temp, 0))}${chip('Tint', signed(p.tint, 0))}${chip('Exposure', `${signed(p.exp / 100, 2)} EV`)}${chip('Contrast', signed(p.con, 0))}${chip('Vibrance', signed(p.vib, 0))}${chip('Safety', candidate.safetyAdjustments.length ? `Clamp ${candidate.safetyAdjustments.length}` : 'ผ่าน')}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">N4/N5 · PREVIEW & EVALUATION</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Pixel Changed', rcm.previewMetrics ? `${rcm.previewMetrics.changedPixelPct.toFixed(1)}%` : 'รอ Preview')}${chip('Fidelity', evaluation ? `${evaluation.improvement.fidelityScore.toFixed(1)}/100` : 'รอวิเคราะห์ After')}${chip('Need Before→After', evaluation ? `${evaluation.before.matchNeedScore.toFixed(1)} → ${evaluation.after.matchNeedScore.toFixed(1)}` : '—')}${chip('Records', rcm.storedRecordCount)}${chip('LR Round-trip', rcm.roundTripFidelity ? `${rcm.roundTripFidelity.fidelityScore.toFixed(1)}/100` : 'ยังไม่ทดสอบ')}</div>
    <div style="font-size:11px;line-height:1.55;color:var(--text-dim);margin-top:11px">ทุกค่ามาจาก Reference − Target Delta ผ่านการแยกสีของแสง/สีวัตถุ ป้องกันผิวและ Dynamic Range แล้ว Preview กับ Candidate XMP ใช้ Safe Preset ชุดเดียวกัน</div>`;
}

function _renderReasons() {
  const el = $('rcmReasons');
  const candidate = rcm.corePipeline?.candidate;
  if (!el || !candidate) return;
  const trace = candidate.reasonTrace.slice(0, 14).map(item => {
    const value = typeof item.value === 'object' ? JSON.stringify(item.value) : item.value;
    return `<li style="margin-bottom:5px"><b style="color:var(--text)">${escapeHtml(item.parameter)}</b>: ${escapeHtml(value)} <span style="color:var(--text-faint)">(${escapeHtml(item.sourceCodes.join(', '))})</span></li>`;
  });
  const evalText = rcm.evaluation
    ? `<li style="margin-bottom:5px"><b style="color:var(--text)">Match Fidelity</b>: ลด Match Need ${rcm.evaluation.improvement.overallReductionPct.toFixed(1)}% · WB ${rcm.evaluation.improvement.whiteBalanceReductionPct.toFixed(1)}% · Tone ${rcm.evaluation.improvement.toneReductionPct.toFixed(1)}% · Palette ${rcm.evaluation.improvement.paletteReductionPct.toFixed(1)}%</li>`
    : '';
  const roundTripText = rcm.roundTripFidelity
    ? `<li style="margin-bottom:5px"><b style="color:var(--text)">Lightroom Round-trip</b>: ${ROUNDTRIP_LABELS[rcm.roundTripFidelity.status] || rcm.roundTripFidelity.status} · Drift ${rcm.roundTripFidelity.drift.total.toFixed(1)} · Fidelity ${rcm.roundTripFidelity.fidelityScore.toFixed(1)}/100</li>`
    : '';
  el.innerHTML = trace.join('') + evalText + roundTripText;
}

function _ensureEvaluationHarness() {
  let el = $('rcmEvaluationHarness');
  if (el) return el;
  const status = $('rcmStatus');
  const card = status?.parentElement;
  if (!card) return null;
  el = document.createElement('section');
  el.id = 'rcmEvaluationHarness';
  el.style.cssText = 'margin:14px 0;padding:14px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2)';
  el.innerHTML = `
    <div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--accent);letter-spacing:.06em;margin-bottom:9px">N5 · COLOR MATCH EVALUATION HARNESS</div>
    <div id="rcmEvaluationSummary" style="font-size:11px;color:var(--text-dim);line-height:1.6;margin-bottom:10px">รอผล Preview และการวิเคราะห์ After</div>
    <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:5px">ผลการตรวจด้วยสายตา</label>
    <select id="rcmReviewerDecision" style="width:100%;padding:9px;background:var(--surface-1);color:var(--text);border:1px solid var(--border);border-radius:2px;margin-bottom:9px">${DECISIONS.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:5px">ปัญหาที่พบ</div>
    <div id="rcmIssueCodes" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px;margin-bottom:9px">${ISSUE_CODES.map(([value,label]) => `<label style="font-size:10.5px;color:var(--text-dim);display:flex;gap:6px;align-items:center"><input type="checkbox" value="${value}"> ${label}</label>`).join('')}</div>
    <textarea id="rcmEvaluationNotes" rows="3" placeholder="หมายเหตุจากการดูภาพ เช่น ผิวอุ่นเกินไป หรือ Highlight ใกล้ภาพต้นแบบขึ้น" style="width:100%;box-sizing:border-box;padding:9px;background:var(--surface-1);color:var(--text);border:1px solid var(--border);border-radius:2px;resize:vertical;margin-bottom:9px"></textarea>
    <div style="margin:12px 0;padding:12px;border:1px solid var(--border);background:var(--surface-1);border-radius:3px">
      <div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--accent);margin-bottom:7px">2E-O · LIGHTROOM ROUND-TRIP FIDELITY</div>
      <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:5px">ชนิดไฟล์เป้าหมายที่นำ XMP ไปใช้</label>
      <select id="rcmTargetMediaType" style="width:100%;padding:8px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);margin-bottom:8px"><option value="AUTO">ตรวจอัตโนมัติ</option><option value="RAW">RAW เช่น CR2/CR3/NEF/ARW</option><option value="RENDERED">JPEG/TIFF/PNG</option></select>
      <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:5px">นำ JPEG/TIFF ที่ Export จาก Lightroom หลังใช้ Candidate XMP กลับมาตรวจ</label>
      <input type="file" id="rcmLightroomResultFileIn" accept="image/jpeg,image/png,image/tiff,image/webp" style="width:100%;font-size:11px;color:var(--text-dim);margin-bottom:8px">
      <canvas id="rcmLightroomResultCanvas" style="width:100%;max-height:260px;object-fit:contain;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);display:none"></canvas>
      <div id="rcmRoundTripSummary" style="font-size:11px;color:var(--text-dim);line-height:1.55;margin-top:7px">ยังไม่ตรวจ Round-trip — Preview เป็นการประมาณ ไม่ใช่ Adobe RAW Render</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="rcmSaveEvaluationBtn" disabled style="flex:1;min-width:180px;padding:9px;border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);border-radius:2px;font-family:var(--font-mono);font-size:10px;font-weight:700;cursor:pointer">บันทึกผล Match</button><button id="rcmExportEvaluationBtn" style="flex:1;min-width:180px;padding:9px;border:1px solid var(--border-strong);background:var(--surface-1);color:var(--text);border-radius:2px;font-family:var(--font-mono);font-size:10px;font-weight:700;cursor:pointer">ส่งออก Evaluation JSON</button></div>`;
  card.insertBefore(el, status);
  $('rcmSaveEvaluationBtn')?.addEventListener('click', _saveEvaluation);
  $('rcmExportEvaluationBtn')?.addEventListener('click', _exportEvaluations);
  $('rcmTargetMediaType')?.addEventListener('change', async event => { rcm.targetMediaOverride = event.target.value; await _rebuildAndPreview(); });
  $('rcmLightroomResultFileIn')?.addEventListener('change', _handleLightroomResultFile);
  return el;
}

function _renderRoundTripSummary() {
  const el = $('rcmRoundTripSummary');
  if (!el) return;
  if (!rcm.roundTripFidelity) {
    el.textContent = 'ยังไม่ตรวจ Round-trip — Preview เป็นการประมาณ ไม่ใช่ Adobe RAW Render';
    el.dataset.roundTripStatus = 'NOT_TESTED';
    return;
  }
  const result = rcm.roundTripFidelity;
  el.dataset.roundTripStatus = result.status;
  el.textContent = `${ROUNDTRIP_LABELS[result.status] || result.status} · Fidelity ${result.fidelityScore.toFixed(1)}/100 · Preview↔Lightroom Drift ${result.drift.total.toFixed(1)} · WB ${result.drift.whiteBalance.toFixed(1)} · Tone ${result.drift.tone.toFixed(1)}`;
}

async function _handleLightroomResultFile(event) {
  const file = event.target.files?.[0];
  if (!file || !rcm.previewMatchedSignature || !rcm.corePipeline) {
    _setStatus('กรุณาสร้าง Candidate Preview ก่อนอัปโหลดผลจาก Lightroom');
    return;
  }
  _loadImageFile(file, async img => {
    try {
      rcm.lightroomResultImg = img;
      _drawOriginal(img, 'rcmLightroomResultCanvas');
      const canvas = $('rcmLightroomResultCanvas'); if (canvas) canvas.style.display = 'block';
      rcm.lightroomResultEvidence = await _analyzeEvidence(img);
      const lightroomSignature = buildMatchedSignatureFromAnalysis({
        ...rcm.lightroomResultEvidence,
        analysisGenerationId: rcm.generationId,
      });
      rcm.roundTripFidelity = evaluateLightroomRoundTrip({
        referenceSignature: rcm.corePipeline.analysis.referenceSignature,
        targetSignature: rcm.corePipeline.analysis.targetSignature,
        previewSignature: rcm.previewMatchedSignature,
        lightroomSignature,
        candidate: rcm.corePipeline.candidate,
        compatibilityProfile: rcm.corePipeline.candidate.compatibilityProfile,
      });
      _renderRoundTripSummary(); _renderCoreMatchInspector(); _renderReasons();
      _setStatus(`✓ ตรวจ Lightroom Round-trip แล้ว · Fidelity ${rcm.roundTripFidelity.fidelityScore.toFixed(1)}/100 · Production ยังเป็น Legacy`);
    } catch (error) {
      rcm.roundTripFidelity = null; _renderRoundTripSummary();
      _setStatus(`ตรวจ Round-trip ไม่สำเร็จ: ${error.message}`);
    }
  });
}

function _renderEvaluationHarness() {
  _ensureEvaluationHarness();
  const summary = $('rcmEvaluationSummary');
  const save = $('rcmSaveEvaluationBtn');
  if (!summary || !save) return;
  _renderRoundTripSummary();
  if (!rcm.evaluation) {
    summary.textContent = 'รอผล Preview และการวิเคราะห์ After';
    save.disabled = true;
    return;
  }
  const e = rcm.evaluation;
  summary.textContent = `${EVAL_LABELS[e.status] ?? e.status} · Fidelity ${e.improvement.fidelityScore.toFixed(1)}/100 · Match Need ${e.before.matchNeedScore.toFixed(1)} → ${e.after.matchNeedScore.toFixed(1)} · XMP/Preview ใช้ Safe Preset ชุดเดียวกัน`;
  save.disabled = false;
}

async function _saveEvaluation() {
  if (!rcm.evaluation || !rcm.corePipeline) { _setStatus('ยังไม่มีผล Match สำหรับบันทึก'); return; }
  const reviewerDecision = $('rcmReviewerDecision')?.value || 'NOT_REVIEWED';
  if (reviewerDecision === 'NOT_REVIEWED') { _setStatus('กรุณาเลือกผลการตรวจด้วยสายตาก่อนบันทึก'); return; }
  const issueCodes = [...document.querySelectorAll('#rcmIssueCodes input:checked')].map(input => input.value);
  const notes = $('rcmEvaluationNotes')?.value || '';
  const record = createColorMatchEvaluationRecord({
    analysis: rcm.corePipeline.analysis,
    compensation: rcm.corePipeline.compensation,
    candidate: rcm.corePipeline.candidate,
    evaluation: rcm.evaluation,
    roundTripFidelity: rcm.roundTripFidelity,
    reviewerDecision,
    issueCodes,
    notes,
  });
  await rcm.store.save(record);
  rcm.storedRecordCount = (await rcm.store.list()).length;
  _renderCoreMatchInspector();
  _setStatus(`✓ บันทึกผล Color Match แล้ว · Evaluation Records ${rcm.storedRecordCount}`);
}

async function _exportEvaluations() {
  const records = await rcm.store.list();
  const text = JSON.stringify({ kind: 'LUMIXA_COLOR_MATCH_EVALUATION_DATASET', schemaVersion: 1, exportedAt: new Date().toISOString(), recordCount: records.length, records }, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'LUMIXA-Color-Match-Evaluation.json'; a.click();
  URL.revokeObjectURL(url);
  _setStatus(`✓ ส่งออก Evaluation ${records.length} รายการแล้ว`);
}

async function analyzeReference() {
  if (!rcm.referenceImg) { _setStatus('กรุณาอัปโหลดภาพต้นแบบก่อน'); return; }
  _setStatus('กำลังวิเคราะห์ภาพต้นแบบ…');
  rcm.referenceEvidence = await _analyzeEvidence(rcm.referenceImg);
  _renderPalette(rcm.referenceEvidence.palette);
  _renderToneZones(rcm.referenceEvidence.toneZones);
  _drawOriginal(rcm.referenceImg, 'rcmRefCanvas');
  rcm.referenceColorIntelligence = buildReferenceColorIntelligence({
    palette: rcm.referenceEvidence.palette,
    toneZones: rcm.referenceEvidence.toneZones,
    transferProfile: null,
    preserveReport: null,
  });
  _renderPhotographerIntelligence(rcm.referenceColorIntelligence);
  _setStatus(`✓ วิเคราะห์ภาพต้นแบบแล้ว · สีหลัก ${rcm.referenceEvidence.palette.colors.length} สี · Skin ${rcm.referenceEvidence.skinAnalysis.detected ? 'พบ' : 'ไม่พบ'}`);
  await _rebuildAndPreview();
}

function _effectiveIntensity() {
  const preserveFactor = (rcm.toggles.protectHighlights && rcm.toggles.protectShadows) ? 0.96 : 1;
  const skinFactor = rcm.toggles.preserveSkinTone ? 1 : 1.08;
  return Math.max(0, Math.min(100, rcm.intensity * (MODES[rcm.mode] || 1) * preserveFactor * skinFactor));
}

async function _rebuildAndPreview() {
  if (!rcm.referenceEvidence || !rcm.targetImg) return;
  rcm.candidateReadyForDownload = false;
  $('rcmGenerateBtn')?.setAttribute('disabled', 'true');
  $('rcmDownloadBtn')?.setAttribute('disabled', 'true');
  $('rcmSaveAfterBtn')?.setAttribute('disabled', 'true');
  if ($('rcmAfterUpdating')) $('rcmAfterUpdating').style.opacity = '1';
  _setStatus('กำลังวิเคราะห์ Target และสร้าง Core Color Match N1–N5…');

  if (!rcm.targetEvidence) rcm.targetEvidence = await _analyzeEvidence(rcm.targetImg);
  rcm.corePipeline = buildCoreColorMatchPipeline({
    reference: rcm.referenceEvidence,
    target: rcm.targetEvidence,
    analysisGenerationId: rcm.generationId,
    intensity: _effectiveIntensity(),
    candidateName: 'LUMIXA-Core-Color-Match-Candidate',
    protectionOptions: { ...rcm.toggles },
    targetMediaContext: {
      fileName: rcm.targetFile?.name || '',
      mimeType: rcm.targetFile?.type || '',
      mediaType: rcm.targetMediaOverride === 'AUTO' ? null : rcm.targetMediaOverride,
    },
  });
  _drawOriginal(rcm.targetImg, 'rcmBeforeCanvas');
  const afterCanvas = $('rcmAfterCanvas');
  rcm.previewMetrics = renderColorMatchCandidateToCanvas({
    image: rcm.targetImg,
    canvas: afterCanvas,
    preset: rcm.corePipeline.candidate.safePreset,
  });

  const matchedImg = await _canvasToImage(afterCanvas);
  rcm.matchedEvidence = await _analyzeEvidence(matchedImg);
  const matchedSignature = buildMatchedSignatureFromAnalysis({
    ...rcm.matchedEvidence,
    analysisGenerationId: rcm.generationId,
  });
  rcm.previewMatchedSignature = matchedSignature;
  rcm.evaluation = evaluateMatchedSignature({
    referenceSignature: rcm.corePipeline.analysis.referenceSignature,
    targetSignature: rcm.corePipeline.analysis.targetSignature,
    matchedSignature,
    previewMetrics: rcm.previewMetrics,
    candidate: rcm.corePipeline.candidate,
  });

  _renderCoreMatchInspector();
  _renderReasons();
  _renderEvaluationHarness();
  if ($('rcmAfterUpdating')) $('rcmAfterUpdating').style.opacity = '0';
  const blocked = rcm.corePipeline.candidate.candidateState === 'BLOCKED';
  if (!blocked) {
    $('rcmGenerateBtn')?.removeAttribute('disabled');
    $('rcmSaveAfterBtn')?.removeAttribute('disabled');
  }
  _setStatus(blocked
    ? 'ระบบบล็อก Candidate เพราะหลักฐานไม่เพียงพอ — ไม่สร้าง XMP'
    : `✓ Core Color Match พร้อมตรวจ · Fidelity ${rcm.evaluation.improvement.fidelityScore.toFixed(1)}/100 · Production ยังเป็น Legacy`);
}

function generateXMP() {
  const candidate = rcm.corePipeline?.candidate;
  if (!candidate || candidate.candidateState === 'BLOCKED') { _setStatus('Candidate ยังไม่พร้อมสร้าง XMP'); return; }
  rcm.candidateReadyForDownload = true;
  $('rcmDownloadBtn')?.removeAttribute('disabled');
  $('rcmDownloadBtn').dataset.ready = '1';
  _setStatus(`✓ Candidate XMP สร้างในหน่วยความจำแล้ว (${candidate.candidateXmpLength} ตัวอักษร) · ไม่กระทบ Production XMP`);
}
function downloadXMPFile() {
  const candidate = rcm.corePipeline?.candidate;
  if (!candidate || !rcm.candidateReadyForDownload) { _setStatus('กรุณากดสร้าง Candidate XMP ก่อน'); return; }
  downloadXMP(candidate.candidateXmp, 'LUMIXA-Core-Color-Match-Candidate');
  _setStatus('✓ ดาวน์โหลด Candidate XMP แล้ว · Production Pipeline ยังใช้ Legacy');
}
function saveAfterImage() {
  const canvas = $('rcmAfterCanvas');
  if (!canvas || !rcm.corePipeline) { _setStatus('ยังไม่มีภาพ After'); return; }
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'LUMIXA-Core-Color-Match-After.png'; a.click();
    URL.revokeObjectURL(url);
    _setStatus('✓ บันทึกภาพ After แล้ว');
  }, 'image/png');
}

function _resetPairState() {
  rcm.targetEvidence = null;
  rcm.matchedEvidence = null;
  rcm.previewMatchedSignature = null;
  rcm.lightroomResultImg = null;
  rcm.lightroomResultEvidence = null;
  rcm.roundTripFidelity = null;
  rcm.corePipeline = null;
  rcm.evaluation = null;
  rcm.previewMetrics = null;
  rcm.candidateReadyForDownload = false;
  _renderCoreMatchInspector();
  _renderEvaluationHarness();
}

export async function initReferenceColorMatchPanel() {
  const refInput = $('rcmRefFileIn');
  const tgtInput = $('rcmTargetFileIn');
  if (!refInput || !tgtInput) return;
  rcm.store = await createColorMatchEvaluationStore();
  rcm.storedRecordCount = (await rcm.store.list()).length;
  _renderCoreMatchInspector();
  _renderEvaluationHarness();
  if ($('rcmTargetMediaType')) $('rcmTargetMediaType').value = rcm.targetMediaOverride;

  refInput.addEventListener('change', event => {
    _loadImageFile(event.target.files[0], img => {
      rcm.referenceImg = img;
      rcm.referenceEvidence = null;
      rcm.referenceColorIntelligence = null;
      rcm.generationId = `rcm-${Date.now()}`;
      _resetPairState();
      _drawOriginal(img, 'rcmRefCanvas');
      if ($('rcmPaletteSwatches')) $('rcmPaletteSwatches').innerHTML = '';
      if ($('rcmToneZones')) $('rcmToneZones').innerHTML = '';
      if ($('rcmReasons')) $('rcmReasons').innerHTML = '';
      _setStatus('ภาพต้นแบบโหลดแล้ว — กดวิเคราะห์ภาพต้นแบบ');
    });
  });
  tgtInput.addEventListener('change', event => {
    rcm.targetFile = event.target.files[0] || null;
    _loadImageFile(rcm.targetFile, async img => {
      rcm.targetImg = img;
      rcm.generationId = `rcm-${Date.now()}`;
      _resetPairState();
      _drawOriginal(img, 'rcmBeforeCanvas');
      await _rebuildAndPreview();
    });
  });

  $('rcmAnalyzeBtn')?.addEventListener('click', analyzeReference);
  $('rcmGenerateBtn')?.addEventListener('click', generateXMP);
  $('rcmDownloadBtn')?.addEventListener('click', downloadXMPFile);
  $('rcmSaveAfterBtn')?.addEventListener('click', saveAfterImage);

  const syncIntensity = value => {
    if ($('rcmIntensityValue')) $('rcmIntensityValue').textContent = value;
    if ($('rcmAfterIntensityValue')) $('rcmAfterIntensityValue').textContent = value;
    if ($('rcmIntensitySlider')) $('rcmIntensitySlider').value = value;
    if ($('rcmAfterIntensitySlider')) $('rcmAfterIntensitySlider').value = value;
  };
  const onIntensity = async event => { rcm.intensity = +event.target.value; syncIntensity(rcm.intensity); await _rebuildAndPreview(); };
  $('rcmIntensitySlider')?.addEventListener('input', onIntensity);
  $('rcmAfterIntensitySlider')?.addEventListener('input', onIntensity);
  $('rcmModeSelect')?.addEventListener('change', async event => { rcm.mode = event.target.value; await _rebuildAndPreview(); });
  for (const key of Object.keys(rcm.toggles)) $('rcmToggle_' + key)?.addEventListener('change', async event => { rcm.toggles[key] = event.target.checked; await _rebuildAndPreview(); });

  const modeSelect = $('rcmModeSelect');
  if (modeSelect) modeSelect.innerHTML = Object.keys(MODES).map(mode => `<option value="${mode}">${mode}</option>`).join('');
  $('rcmGenerateBtn')?.setAttribute('disabled', 'true');
  $('rcmDownloadBtn')?.setAttribute('disabled', 'true');
  $('rcmSaveAfterBtn')?.setAttribute('disabled', 'true');
}
