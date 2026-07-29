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
import { buildPerceptualPixelTransfer } from '../core/color-match/perceptual-pixel-transfer-engine.js';
import { analyzeWhiteBalance } from '../core/whitebalance-engine/index.js';
import { generateBasicPanel } from '../core/basic-panel-engine/index.js';
import { generateToneCurves } from '../core/tone-curve-ai-engine/index.js';
import { analyzeHSL } from '../core/hsl-analyzer-engine/index.js';
import { analyzeColorGrading } from '../core/colorgrading-ai-engine/index.js';
import { analyzeCalibration } from '../core/calibration-engine/index.js';
import { analyzeImageCore } from '../core/image-analysis-core/index.js';
import { analyzeSkinTone } from '../core/skintone-engine/index.js';
import { generateHarmonies } from '../core/color-harmony-engine/index.js';


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
  targetBaseTemperatureK: null,
  targetBaseTint: null,
  targetProfileName: '',
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
  pixelTransfer: null,
  pixelTransferKey: null,
  workflow: { id: 'REFERENCE_COLOR_MATCH_BETA', previewState: 'WAITING_FOR_IMAGES', previewError: null },
};

function $(id) { return document.getElementById(id); }
function signed(value, digits = 1) { const n = Number(value) || 0; return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function _setStatus(text) { const el = $('rcmStatus'); if (el) el.textContent = text; }

function _setMatchedPreviewState(state, message = '', errorCode = '') {
  rcm.workflow.previewState = state;
  rcm.workflow.previewError = errorCode || null;
  const box = $('rcmMatchedPreviewState');
  if (!box) return;
  const labels = {
    WAITING_FOR_IMAGES: 'รอภาพ Reference และ Target',
    REFERENCE_ANALYSIS_PENDING: 'กำลังวิเคราะห์ภาพต้นแบบ',
    TARGET_ANALYSIS_PENDING: 'กำลังวิเคราะห์ภาพ Target',
    PAIRWISE_FUSION_PENDING: 'กำลังรวมผล Core แบบ Pairwise',
    RENDERING: 'กำลังสร้าง Target Matched Preview',
    READY: 'Target Matched Preview พร้อมแล้ว',
    ERROR: 'สร้าง Target Matched Preview ไม่สำเร็จ',
  };
  box.dataset.state = state;
  box.style.display = state === 'READY' ? 'none' : 'flex';
  box.innerHTML = `<div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:${state === 'ERROR' ? 'var(--danger,#ff6b6b)' : 'var(--accent)'}">${escapeHtml(labels[state] || state)}</div>${message ? `<div style="font-size:11px;color:var(--text-dim);line-height:1.45;margin-top:4px">${escapeHtml(message)}</div>` : ''}${errorCode ? `<div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-top:4px">${escapeHtml(errorCode)}</div>` : ''}`;
}

function _clearMatchedCanvas() {
  const canvas = $('rcmAfterCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = Math.max(1, canvas.width || 1);
  canvas.height = Math.max(1, canvas.height || 1);
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

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

function _sliderValue(result) {
  if (Number.isFinite(Number(result))) return Number(result);
  for (const key of ['value','adjustment','slider','amount']) if (Number.isFinite(Number(result?.[key]))) return Number(result[key]);
  return 0;
}
function _curvePoints(curve) {
  const points = curve?.points || curve;
  if (!Array.isArray(points)) return null;
  return points.map(p => ({ x: Number(p.x ?? p.input ?? 0), y: Number(p.y ?? p.output ?? 0) }));
}
function _adaptHsl(result) {
  const channels = {};
  for (const name of ['red','orange','yellow','green','aqua','blue','purple','magenta']) {
    const c = result?.channels?.[name] || result?.[name] || {};
    channels[name] = { hue:_sliderValue(c.hue), saturation:_sliderValue(c.saturation ?? c.sat), luminance:_sliderValue(c.luminance ?? c.lum) };
  }
  return channels;
}
function _adaptGrading(result) {
  const z = name => result?.[name] || {};
  return {
    shadows:{hue:_sliderValue(z('shadows').hue),saturation:_sliderValue(z('shadows').sat ?? z('shadows').saturation),luminance:_sliderValue(z('shadows').luminance)},
    midtones:{hue:_sliderValue(z('midtones').hue),saturation:_sliderValue(z('midtones').sat ?? z('midtones').saturation),luminance:_sliderValue(z('midtones').luminance)},
    highlights:{hue:_sliderValue(z('highlights').hue),saturation:_sliderValue(z('highlights').sat ?? z('highlights').saturation),luminance:_sliderValue(z('highlights').luminance)},
    blending:_sliderValue(result?.blending ?? 50),
  };
}
const CORE_ANALYSIS_TIMEOUT_MS = 45000;

function _nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function _runCoreAnalysisStep({ phase, label, task, required = true, fallback = null, timeoutMs = CORE_ANALYSIS_TIMEOUT_MS }) {
  _setStatus(`${phase}: ${label}…`);
  _setMatchedPreviewState(
    phase === 'REFERENCE' ? 'REFERENCE_ANALYSIS_PENDING' :
    phase === 'TARGET' ? 'TARGET_ANALYSIS_PENDING' : 'PAIRWISE_FUSION_PENDING',
    `${label} · ระบบกำลังประมวลผลทีละโมดูลเพื่อไม่ให้หน้าเว็บค้าง`
  );
  await _nextPaint();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${label} ใช้เวลานานเกิน ${timeoutMs / 1000} วินาที`), {
          code: `CORE_TIMEOUT_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
        })), timeoutMs);
      }),
    ]);
    return result;
  } catch (error) {
    console.error(`[LUMIXA][${phase}][${label}]`, error);
    if (required) throw error;
    return fallback;
  } finally {
    clearTimeout(timer);
    await _nextPaint();
  }
}

async function _analyzeEvidence(img, { phase = 'ANALYSIS' } = {}) {
  // Run canvas-heavy engines in controlled stages. Running all 11 engines in one
  // Promise.all can starve the browser main thread and leave the preview overlay
  // permanently stuck at “analysing reference”.
  const palette = await _runCoreAnalysisStep({ phase, label: 'Colour Palette · K-Means', task: () => extractReferencePalette(img) });
  const toneZones = await _runCoreAnalysisStep({ phase, label: 'Tone Zone Analyzer', task: () => analyzeToneZones(img) });
  const skinAnalysis = await _runCoreAnalysisStep({ phase, label: 'Skin Classification', task: () => classifySkin(img), required: false, fallback: { detected: false, coveragePct: 0 } });
  const histogram = await _runCoreAnalysisStep({ phase, label: 'Histogram & Metrics', task: () => analyzeImage(img) });

  const category = skinAnalysis?.detected ? 'Portrait' : 'General';
  const whiteBalance = await _runCoreAnalysisStep({ phase, label: 'White Balance Pro', task: () => analyzeWhiteBalance(img,{category,skinPct:skinAnalysis?.coveragePct || 0}), required: false, fallback: {} });
  const toneCurve = await _runCoreAnalysisStep({ phase, label: 'Tone Curve AI', task: () => generateToneCurves(img,histogram), required: false, fallback: {} });
  const hsl = await _runCoreAnalysisStep({ phase, label: 'HSL Analyzer Pro', task: () => analyzeHSL(img,{category}), required: false, fallback: {} });
  const grading = await _runCoreAnalysisStep({ phase, label: 'Color Grading AI', task: () => analyzeColorGrading(img,{category}), required: false, fallback: {} });
  const calibration = await _runCoreAnalysisStep({ phase, label: 'Calibration Engine', task: () => analyzeCalibration(img,{category,skinPct:skinAnalysis?.coveragePct || 0}), required: false, fallback: {} });
  // Image Analysis Core is intentionally excluded from the critical preview path.
  // It is a comprehensive reporting engine and can monopolise the browser main thread
  // on large photographs. Pairwise preview already has the fast evidence required from
  // palette, tone zones, histogram, WB, tone curve, HSL, grading and calibration.
  // Keep an explicit deferred record so the contribution ledger stays honest.
  const imageCore = {
    deferred: true,
    source: 'REFERENCE_COLOR_MATCH_FAST_PATH',
    confidence: 0,
    warnings: ['Image Analysis Core deferred; it does not block Target Matched Preview.'],
  };
  // Skin Tone Detection Pro is intentionally NOT awaited in the critical preview path.
  // The fast Skin Classification result already supplies the safety constraint required
  // for pairwise fusion. A slow/buggy optional skin profiler must never block Reference,
  // Target, or Matched Preview generation.
  const skinTone = {
    detected: Boolean(skinAnalysis?.detected),
    coveragePct: Number(skinAnalysis?.coveragePct || 0),
    confidence: Number(skinAnalysis?.confidence || (skinAnalysis?.detected ? 0.55 : 0.2)),
    deferred: true,
    source: 'FAST_SKIN_CLASSIFICATION_FALLBACK',
    warnings: ['Skin Tone Detection Pro deferred; preview uses fast skin classification safety evidence.'],
  };

  const basic = generateBasicPanel(histogram);
  const coreOutputs = {
    whiteBalancePro:{confidence:whiteBalance?.consensus?.confidence ?? .5,recommendedAdjustments:{temperature:whiteBalance?.consensus?.temperature ?? 0,tint:whiteBalance?.consensus?.tint ?? 0},evidence:whiteBalance},
    lightroomBasicPanel:{confidence:basic?.confidence ?? .5,recommendedAdjustments:{exposure:_sliderValue(basic.exposure),contrast:_sliderValue(basic.contrast),highlights:_sliderValue(basic.highlights),shadows:_sliderValue(basic.shadows),whites:_sliderValue(basic.whites),blacks:_sliderValue(basic.blacks)},evidence:basic},
    toneCurveAI:{confidence:toneCurve?.confidence ?? .5,recommendedAdjustments:{curves:{master:_curvePoints(toneCurve?.master),red:_curvePoints(toneCurve?.red),green:_curvePoints(toneCurve?.green),blue:_curvePoints(toneCurve?.blue)}},evidence:{warnings:toneCurve?.warnings}},
    hslAnalyzerPro:{confidence:hsl?.confidence ?? .5,recommendedAdjustments:{channels:_adaptHsl(hsl)},evidence:hsl},
    colorGradingAI:{confidence:grading?.confidence ?? .5,recommendedAdjustments:_adaptGrading(grading),evidence:{look:grading?.look,warnings:grading?.warnings}},
    calibrationEngine:{confidence:calibration?.confidence ?? .5,recommendedAdjustments:{red:{hue:_sliderValue(calibration?.red?.hue),saturation:_sliderValue(calibration?.red?.sat)},green:{hue:_sliderValue(calibration?.green?.hue),saturation:_sliderValue(calibration?.green?.sat)},blue:{hue:_sliderValue(calibration?.blue?.hue),saturation:_sliderValue(calibration?.blue?.sat)}},evidence:calibration},
    imageAnalysisCore:{confidence:imageCore?.confidence ?? .6,evidence:imageCore},
    colourPaletteKMeans:{confidence:.8,evidence:palette}, histogramMetrics:{confidence:.8,evidence:histogram}, toneZoneAnalyzer:{confidence:.8,evidence:toneZones},
    colorHarmony:{confidence:.6,evidence:generateHarmonies(palette?.colors || [])}, skinToneDetectionPro:{confidence:skinTone?.confidence ?? .5,evidence:skinTone,constraints:{detected:skinAnalysis?.detected}},
    featureFusionEngine:{confidence:.75,evidence:{source:'reference-color-match-panel'}}, decisionEngine:{confidence:.75,evidence:{category}}, xmpValidator:{confidence:1,evidence:{enabled:true}},
  };
  return { palette, toneZones, skinAnalysis, histogram, coreOutputs };
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
  el.dataset.pixelTransferState = pipeline.transferEvidence?.pixelTransfer?.state ?? 'NOT_AVAILABLE';
  el.dataset.gaussianHslConfidence = String(pipeline.transferEvidence?.gaussianHsl?.confidence ?? 0);
  el.dataset.coreFusionGate = pipeline.unifiedFusion?.gate?.decision ?? 'NOT_AVAILABLE';
  el.dataset.coreModulesAvailable = String(pipeline.unifiedFusion?.utilizationSummary?.available ?? 0);
  el.dataset.coreModulesConsumed = String(pipeline.unifiedFusion?.utilizationSummary?.consumed ?? 0);
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
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">O8 · PERCEPTUAL TRANSFER</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Curve Source', candidate.rawPreset.transferDiagnostics?.curveSource || 'SEMANTIC_FALLBACK')}${chip('Curve Magnitude', candidate.rawPreset.transferDiagnostics?.curveMagnitude || 0)}${chip('Gaussian HSL', `${Math.round((pipeline.transferEvidence?.gaussianHsl?.confidence || 0) * 100)}%`)}${chip('Shared Channels', pipeline.transferEvidence?.gaussianHsl?.supportedChannelCount || 0)}${chip('Mean ΔE00', pipeline.transferEvidence?.gaussianHsl?.meanSharedDeltaE2000 || 0)}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">O9 · UNIFIED CORE FUSION</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Fusion Gate', pipeline.unifiedFusion?.gate?.code || 'NOT_AVAILABLE')}${chip('Core Available', pipeline.unifiedFusion?.utilizationSummary?.available ?? 0)}${chip('Core Consumed', pipeline.unifiedFusion?.utilizationSummary?.consumed ?? 0)}${chip('Dropped Required', pipeline.unifiedFusion?.utilizationSummary?.droppedRequired?.length ?? 0)}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">N3 · LIGHTROOM CANDIDATE</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Temp Δ', `${signed(candidate.xmpCodec.wb.deltaTemperatureK, 0)} K`)}${chip('Final Temp', candidate.xmpCodec.wb.finalTemperatureK ? `${candidate.xmpCodec.wb.finalTemperatureK} K` : 'ต้องใส่ค่า Target')}${chip('Tint Δ', signed(candidate.xmpCodec.wb.deltaTint, 0))}${chip('Exposure', `${signed(p.exp / 100, 2)} EV`)}${chip('Active Params', candidate.directionGate.activeParameterCount)}${chip('Direction', candidate.directionGate.code)}${chip('XMP Readback', candidate.xmpReadback.decision)}</div>
    <div style="font-family:var(--font-mono);font-size:9px;color:var(--accent);margin:11px 0 6px">N4/N5 · PREVIEW & EVALUATION</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">${chip('Pixel Changed', rcm.previewMetrics ? `${rcm.previewMetrics.changedPixelPct.toFixed(1)}%` : 'รอ Preview')}${chip('Fidelity', evaluation ? `${evaluation.improvement.fidelityScore.toFixed(1)}/100` : 'รอวิเคราะห์ After')}${chip('Need Before→After', evaluation ? `${evaluation.before.matchNeedScore.toFixed(1)} → ${evaluation.after.matchNeedScore.toFixed(1)}` : '—')}${chip('Records', rcm.storedRecordCount)}${chip('LR Round-trip', rcm.roundTripFidelity ? `${rcm.roundTripFidelity.fidelityScore.toFixed(1)}/100` : 'ยังไม่ทดสอบ')}</div>
    <div style="font-size:11px;line-height:1.55;color:var(--text-dim);margin-top:11px">Preview ที่ถูกต้องคือ Reference → Target Original → Target Matched เท่านั้น ทุกค่าต้องผ่าน Data Lineage, Direction Gate และ XMP Structural Readback ก่อนดาวน์โหลด</div>
    <details style="margin-top:10px"><summary style="cursor:pointer;font-family:var(--font-mono);font-size:10px;color:var(--accent)">CORE CONTRIBUTION LEDGER</summary><div style="overflow:auto;margin-top:7px"><table style="width:100%;border-collapse:collapse;font-size:9.5px;color:var(--text-dim)"><thead><tr><th style="text-align:left">Parameter</th><th style="text-align:left">Contributors</th></tr></thead><tbody>${Object.entries(pipeline.unifiedFusion?.ledger || {}).slice(0,18).map(([parameter,items])=>`<tr><td>${escapeHtml(parameter)}</td><td>${items.map(item=>`${escapeHtml(item.moduleId)} ${signed(item.value,2)} × ${Math.round(item.confidence*100)}%`).join(' · ')}</td></tr>`).join('')}</tbody></table></div></details>
    <details style="margin-top:10px"><summary style="cursor:pointer;font-family:var(--font-mono);font-size:10px;color:var(--accent)">XMP DATA LINEAGE (${candidate.dataLineage.decision})</summary><div style="overflow:auto;margin-top:7px"><table style="width:100%;border-collapse:collapse;font-size:9.5px;color:var(--text-dim)"><thead><tr><th style="text-align:left">Parameter</th><th>Delta</th><th>Intent</th><th>Safe</th><th>XML Readback</th><th>Status</th></tr></thead><tbody>${candidate.dataLineage.rows.slice(0,13).map(row=>`<tr><td>${escapeHtml(row.parameter)}</td><td style="text-align:center">${escapeHtml(row.referenceTargetDelta ?? '—')}</td><td style="text-align:center">${escapeHtml(row.compensatedIntent ?? '—')}</td><td style="text-align:center">${escapeHtml(row.safeCandidate ?? '—')}</td><td style="text-align:center">${escapeHtml(row.readback ?? '—')}</td><td style="text-align:center">${escapeHtml(row.status)}</td></tr>`).join('')}</tbody></table></div></details>`;
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
      <div style="padding:10px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);margin-bottom:9px">
        <div style="font-family:var(--font-mono);font-size:9.5px;font-weight:700;color:var(--accent);margin-bottom:7px">TARGET LIGHTROOM BASE VALUES</div>
        <div style="font-size:10.5px;line-height:1.5;color:var(--text-dim);margin-bottom:7px">สำหรับ RAW ให้ใส่ค่า Temp/Tint เดิมที่ Lightroom แสดงก่อนใช้ XMP ระบบจะคำนวณ Delta จากฐานนี้ และจะไม่เดาค่า 5500K เอง</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px">
          <label style="font-size:10px;color:var(--text-dim)">Temperature (K)<input id="rcmTargetBaseTemp" type="number" min="2000" max="50000" step="50" placeholder="เช่น 5200" style="margin-top:4px;width:100%;box-sizing:border-box;padding:7px;background:var(--surface-1);color:var(--text);border:1px solid var(--border)"></label>
          <label style="font-size:10px;color:var(--text-dim)">Tint<input id="rcmTargetBaseTint" type="number" min="-150" max="150" step="1" placeholder="เช่น +3" style="margin-top:4px;width:100%;box-sizing:border-box;padding:7px;background:var(--surface-1);color:var(--text);border:1px solid var(--border)"></label>
          <label style="font-size:10px;color:var(--text-dim)">Target Profile (ข้อมูลกำกับ)<input id="rcmTargetProfileName" type="text" placeholder="เช่น Camera Standard" style="margin-top:4px;width:100%;box-sizing:border-box;padding:7px;background:var(--surface-1);color:var(--text);border:1px solid var(--border)"></label>
        </div>
        <div style="font-size:9.5px;color:var(--text-faint);margin-top:6px">Candidate XMP จะไม่เขียน Camera Profile จึงรักษา Profile ของ Target ไว้</div>
      </div>
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
  const updateTargetBase = async () => {
    const temp = Number($('rcmTargetBaseTemp')?.value); const tint = Number($('rcmTargetBaseTint')?.value);
    rcm.targetBaseTemperatureK = Number.isFinite(temp) && temp >= 2000 ? temp : null;
    rcm.targetBaseTint = Number.isFinite(tint) ? tint : null;
    rcm.targetProfileName = $('rcmTargetProfileName')?.value?.trim() || '';
    await _rebuildAndPreview();
  };
  $('rcmTargetBaseTemp')?.addEventListener('change', updateTargetBase);
  $('rcmTargetBaseTint')?.addEventListener('change', updateTargetBase);
  $('rcmTargetProfileName')?.addEventListener('change', updateTargetBase);
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
      rcm.lightroomResultEvidence = await _analyzeEvidence(img, { phase: 'LIGHTROOM RESULT' });
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
  if (!rcm.referenceImg) { _setStatus('กรุณาอัปโหลดภาพต้นแบบก่อน'); _setMatchedPreviewState('WAITING_FOR_IMAGES'); return; }
  _setStatus('กำลังวิเคราะห์ภาพต้นแบบ…');
  _setMatchedPreviewState('REFERENCE_ANALYSIS_PENDING', 'Reference Color Match Beta ใช้การวิเคราะห์คนละสถานะกับ AI Tone Extractor');
  rcm.referenceEvidence = await _analyzeEvidence(rcm.referenceImg, { phase: 'REFERENCE' });
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
  if (!rcm.referenceImg || !rcm.targetImg) {
    _setMatchedPreviewState('WAITING_FOR_IMAGES', !rcm.referenceImg ? 'กรุณาเลือกภาพ Reference' : 'กรุณาเลือกภาพ Target');
    return;
  }
  const runGenerationId = rcm.generationId;
  rcm.candidateReadyForDownload = false;
  $('rcmGenerateBtn')?.setAttribute('disabled', 'true');
  $('rcmDownloadBtn')?.setAttribute('disabled', 'true');
  $('rcmSaveAfterBtn')?.setAttribute('disabled', 'true');
  if ($('rcmAfterUpdating')) $('rcmAfterUpdating').style.opacity = '1';

  try {
    if (!rcm.referenceEvidence) {
      _setMatchedPreviewState('REFERENCE_ANALYSIS_PENDING', 'กำลังเรียก Core Analysis สำหรับ Reference โดยอัตโนมัติ');
      rcm.referenceEvidence = await _analyzeEvidence(rcm.referenceImg, { phase: 'REFERENCE' });
      if (runGenerationId !== rcm.generationId) throw Object.assign(new Error('Generation changed during reference analysis.'), { code: 'STALE_GENERATION' });
      _renderPalette(rcm.referenceEvidence.palette);
      _renderToneZones(rcm.referenceEvidence.toneZones);
    }

    _setStatus('กำลังวิเคราะห์ Target และสร้าง Pairwise Color Match…');
    _setMatchedPreviewState('TARGET_ANALYSIS_PENDING', 'กำลังเรียก Core ชุดเดียวกับ Reference สำหรับ Target');
    if (!rcm.targetEvidence) rcm.targetEvidence = await _analyzeEvidence(rcm.targetImg, { phase: 'TARGET' });
    if (runGenerationId !== rcm.generationId) throw Object.assign(new Error('Generation changed during target analysis.'), { code: 'STALE_GENERATION' });

    const transferKey = `${rcm.generationId}|${Math.round(_effectiveIntensity())}|${rcm.mode}`;
    if (!rcm.pixelTransfer || rcm.pixelTransferKey !== transferKey) {
      _setStatus('กำลังคำนวณ LAB/Gaussian HSL, Tone Curve และ Histogram Matching…');
      _setMatchedPreviewState('PAIRWISE_FUSION_PENDING', 'Reference − Target → Fusion → Candidate');
      rcm.pixelTransfer = await buildPerceptualPixelTransfer({
        referenceImg: rcm.referenceImg,
        targetImg: rcm.targetImg,
        intensity: _effectiveIntensity(),
        mode: rcm.mode,
      });
      rcm.pixelTransferKey = transferKey;
    }

    rcm.corePipeline = buildCoreColorMatchPipeline({
      reference: rcm.referenceEvidence,
      target: rcm.targetEvidence,
      analysisGenerationId: rcm.generationId,
      intensity: _effectiveIntensity(),
      candidateName: 'LUMIXA-Core-Color-Match-Candidate',
      protectionOptions: { ...rcm.toggles },
      pixelTransfer: rcm.pixelTransfer,
      targetMediaContext: {
        fileName: rcm.targetFile?.name || '',
        mimeType: rcm.targetFile?.type || '',
        mediaType: rcm.targetMediaOverride === 'AUTO' ? null : rcm.targetMediaOverride,
        baseTemperatureK: rcm.targetBaseTemperatureK,
        baseTint: rcm.targetBaseTint,
        profileName: rcm.targetProfileName,
      },
    });
    if (!rcm.corePipeline?.candidate?.safePreset) throw Object.assign(new Error('Pairwise fusion did not produce a preview preset.'), { code: 'MATCH_CANDIDATE_UNAVAILABLE' });

    _drawOriginal(rcm.targetImg, 'rcmBeforeCanvas');
    const afterCanvas = $('rcmAfterCanvas');
    if (!afterCanvas) throw Object.assign(new Error('Matched preview canvas is missing.'), { code: 'TARGET_RENDER_SURFACE_MISSING' });
    _setMatchedPreviewState('RENDERING', 'Preview ใช้ Unified Candidate ชุดเดียวกับ Candidate XMP');
    rcm.previewMetrics = renderColorMatchCandidateToCanvas({ image: rcm.targetImg, canvas: afterCanvas, preset: rcm.corePipeline.candidate.safePreset });
    if (!afterCanvas.width || !afterCanvas.height) throw Object.assign(new Error('Matched preview rendered with invalid geometry.'), { code: 'TARGET_RENDER_EMPTY' });

    const matchedImg = await _canvasToImage(afterCanvas);
    rcm.matchedEvidence = await _analyzeEvidence(matchedImg, { phase: 'MATCHED PREVIEW' });
    const matchedSignature = buildMatchedSignatureFromAnalysis({ ...rcm.matchedEvidence, analysisGenerationId: rcm.generationId });
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
    _setMatchedPreviewState('READY');
    const blocked = !rcm.corePipeline.candidate.exportReady;
    if (!blocked) {
      $('rcmGenerateBtn')?.removeAttribute('disabled');
      $('rcmSaveAfterBtn')?.removeAttribute('disabled');
    }
    _setStatus(blocked
      ? `Preview พร้อม แต่ Candidate XMP ถูกบล็อก: ${rcm.corePipeline.candidate.candidateState}`
      : `✓ Target Matched Preview พร้อม · Fidelity ${rcm.evaluation.improvement.fidelityScore.toFixed(1)}/100 · Production ยังเป็น Legacy`);
  } catch (error) {
    console.error('[LUMIXA][REFERENCE_MATCH_PREVIEW]', error);
    const code = error?.code || 'TARGET_RENDER_FAILED';
    _clearMatchedCanvas();
    _setMatchedPreviewState('ERROR', error?.message || 'ไม่สามารถสร้างภาพ Preview ได้', code);
    _setStatus(`Target Matched Preview ไม่ขึ้น: ${code}`);
    _renderCoreMatchInspector();
  } finally {
    if ($('rcmAfterUpdating')) $('rcmAfterUpdating').style.opacity = '0';
  }
}

function generateXMP() {
  const candidate = rcm.corePipeline?.candidate;
  if (!candidate || !candidate.exportReady) { _setStatus(`Candidate ยังส่งออกไม่ได้: ${candidate?.candidateState || 'NOT_READY'}`); return; }
  rcm.candidateReadyForDownload = true;
  $('rcmDownloadBtn')?.removeAttribute('disabled');
  $('rcmDownloadBtn').dataset.ready = '1';
  _setStatus(`✓ Candidate XMP สร้างในหน่วยความจำแล้ว (${candidate.candidateXmpLength} ตัวอักษร) · ไม่กระทบ Production XMP`);
}
function downloadXMPFile() {
  const candidate = rcm.corePipeline?.candidate;
  if (!candidate || !candidate.exportReady || !candidate.candidateXmp || !rcm.candidateReadyForDownload) { _setStatus(`ดาวน์โหลดไม่ได้: ${candidate?.candidateState || 'NOT_READY'}`); return; }
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
  rcm.pixelTransfer = null;
  rcm.pixelTransferKey = null;
  _clearMatchedCanvas();
  _setMatchedPreviewState(rcm.referenceImg && rcm.targetImg ? 'REFERENCE_ANALYSIS_PENDING' : 'WAITING_FOR_IMAGES');
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
  _setMatchedPreviewState('WAITING_FOR_IMAGES');

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
      _setStatus(rcm.targetImg ? 'ภาพต้นแบบโหลดแล้ว — กำลังสร้าง Pairwise Preview อัตโนมัติ' : 'ภาพต้นแบบโหลดแล้ว — เลือก Target หรือกดวิเคราะห์ภาพต้นแบบ');
      if (rcm.targetImg) void _rebuildAndPreview();
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
