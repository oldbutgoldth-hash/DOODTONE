/**
 * EPIC 2E-P1A — Single Image Analysis Profile
 *
 * Declares the REAL Core modules the single-image workflow calls
 * today, in the REAL order `runAnalysis()` calls them
 * (`ui/app.js:2035-2757`, confirmed in P1A_SOURCE_LINEAGE_AUDIT.md
 * §3). This module does not call the engines itself — it is a pure
 * declarative table the orchestrator reads. No Core formula is
 * duplicated or altered here.
 *
 * executionMode:
 *  - 'SEQUENTIAL'      : must complete before the next module starts.
 *  - 'PARALLEL_GROUP'  : runs together with other modules sharing the
 *                        same groupId via Promise.allSettled, matching
 *                        the real `Promise.allSettled([...])` call
 *                        sites in runAnalysis().
 *  - 'FIRE_AND_FORGET' : kicked off early, awaited later in the real
 *                        flow (imageAnalysisCore, palette/harmony).
 */

export const PROFILE_VERSION = 'SINGLE_IMAGE_FULL@1';

export const SINGLE_IMAGE_FULL = Object.freeze([
  {
    moduleId: 'histogram',
    evidenceKey: 'stats',
    required: true,
    dependencies: [],
    executionMode: 'SEQUENTIAL',
    groupId: 'g1-histogram',
    timeoutMs: 15000,
    fallbackPolicy: 'HARD_FAIL',
    sourceEngine: 'core/histogram-engine/index.js',
    sourceFunction: 'analyzeImage',
  },
  {
    moduleId: 'imageAnalysisCore',
    evidenceKey: 'imageAnalysis',
    required: false,
    dependencies: [],
    executionMode: 'FIRE_AND_FORGET',
    groupId: 'g2-fire-and-forget',
    timeoutMs: 20000, // matches WORKER_TIMEOUT_MS in core/image-analysis-core/index.js
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/image-analysis-core/index.js',
    sourceFunction: 'analyzeImageCore',
  },
  {
    moduleId: 'palette',
    evidenceKey: 'palette',
    required: false,
    dependencies: [],
    executionMode: 'FIRE_AND_FORGET',
    groupId: 'g2-fire-and-forget',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/kmeans-engine/index.js',
    sourceFunction: 'extractPalette',
  },
  {
    moduleId: 'harmony',
    evidenceKey: 'harmony',
    required: false,
    dependencies: ['palette'],
    executionMode: 'FIRE_AND_FORGET',
    groupId: 'g2-fire-and-forget',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/color-harmony-engine/index.js',
    sourceFunction: 'generateHarmonies',
  },
  {
    moduleId: 'skinClassify',
    evidenceKey: 'skin', // merged with skinTone below into one evidence entry
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g3-skin-cast',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/skin-classifier/index.js',
    sourceFunction: 'classifySkin',
  },
  {
    moduleId: 'colorCast',
    evidenceKey: 'colorCast',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g3-skin-cast',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/color-cast-detector/index.js',
    sourceFunction: 'detectColorCast',
  },
  {
    moduleId: 'scene',
    evidenceKey: 'scene',
    required: false,
    dependencies: ['histogram', 'skinClassify'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g4-scene',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/scene-classifier/index.js',
    sourceFunction: 'classifyScene',
  },
  {
    moduleId: 'skinTone',
    evidenceKey: 'skin', // merged into the same evidence.skin entry as skinClassify
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/skintone-engine/index.js',
    sourceFunction: 'analyzeSkinTone',
  },
  {
    moduleId: 'whiteBalance',
    evidenceKey: 'wb',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/whitebalance-engine/index.js',
    sourceFunction: 'analyzeWhiteBalance',
  },
  {
    moduleId: 'hsl',
    evidenceKey: 'hsl',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/hsl-analyzer-engine/index.js',
    sourceFunction: 'analyzeHSL',
  },
  {
    moduleId: 'colorGrading',
    evidenceKey: 'grading',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/colorgrading-ai-engine/index.js',
    sourceFunction: 'analyzeColorGrading',
  },
  {
    moduleId: 'toneCurves',
    evidenceKey: 'toneCurves',
    required: false,
    dependencies: ['histogram'],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/tone-curve-ai-engine/index.js',
    sourceFunction: 'generateToneCurves',
  },
  {
    moduleId: 'calibration',
    evidenceKey: 'calibration',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/calibration-engine/index.js',
    sourceFunction: 'analyzeCalibration',
  },
  {
    moduleId: 'styleRecognition',
    evidenceKey: 'styleRecognition',
    required: false,
    dependencies: [],
    executionMode: 'PARALLEL_GROUP',
    groupId: 'g5-color-engines',
    timeoutMs: 15000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/style-recognition-engine/index.js',
    sourceFunction: 'recognizeStyle',
  },
  {
    moduleId: 'basicPanel',
    evidenceKey: 'basic',
    required: true, // buildFinalPreset() reads `basic` unconditionally
    dependencies: ['histogram'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g6-basic',
    timeoutMs: 10000,
    fallbackPolicy: 'HARD_FAIL',
    sourceEngine: 'core/basic-panel-engine/index.js',
    sourceFunction: 'generateBasicPanel',
  },
  {
    moduleId: 'styleFeatureGraph',
    evidenceKey: 'styleFeatureGraph',
    required: false,
    dependencies: ['hsl', 'colorGrading', 'toneCurves', 'calibration', 'styleRecognition'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g7-fusion',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/feature-fusion-engine/index.js',
    sourceFunction: 'buildStyleFeatureGraph',
  },
  {
    moduleId: 'styleFingerprint',
    evidenceKey: 'styleFingerprint',
    required: false,
    dependencies: ['styleFeatureGraph'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g8-fingerprint',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/style-fingerprint/index.js',
    sourceFunction: 'buildStyleFingerprint',
  },
  {
    moduleId: 'decisionCandidate',
    evidenceKey: 'candidate', // written to session.candidate, not session.evidence
    required: true,
    dependencies: ['histogram', 'basicPanel', 'whiteBalance', 'skinClassify', 'hsl', 'calibration', 'colorGrading', 'toneCurves'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g9-decision',
    timeoutMs: 10000,
    fallbackPolicy: 'HARD_FAIL',
    sourceEngine: 'core/decision-engine/index.js',
    sourceFunction: 'buildFinalPreset',
  },
  {
    moduleId: 'validation',
    evidenceKey: 'validationReport',
    required: true,
    dependencies: ['decisionCandidate'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g10-validation',
    timeoutMs: 10000,
    fallbackPolicy: 'HARD_FAIL',
    sourceEngine: 'core/xmp-validator/index.js',
    sourceFunction: 'validateFinalPreset',
  },
  {
    moduleId: 'benchmark',
    evidenceKey: 'benchmark',
    required: false,
    dependencies: ['decisionCandidate'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g11-benchmark',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/style-benchmark-engine/index.js',
    sourceFunction: 'benchmarkStylePreservation',
  },
  {
    moduleId: 'decisionReport',
    evidenceKey: 'decisionReport',
    required: false,
    dependencies: ['decisionCandidate', 'benchmark'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g12-report',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/decision-report-engine/index.js',
    sourceFunction: 'buildDecisionReport',
  },
  {
    moduleId: 'referenceTransfer',
    evidenceKey: 'referenceTransfer',
    required: false,
    dependencies: ['decisionCandidate'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g13-transfer',
    timeoutMs: 10000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/reference-transfer-engine/index.js',
    sourceFunction: 'buildReferenceTransferReport',
  },
  {
    moduleId: 'processingLog',
    evidenceKey: 'processingLog',
    required: false,
    dependencies: ['referenceTransfer'],
    executionMode: 'SEQUENTIAL',
    groupId: 'g14-processing-log',
    timeoutMs: 5000,
    fallbackPolicy: 'SOFT_FAIL',
    sourceEngine: 'core/processing-log/index.js',
    sourceFunction: 'processingLog.snapshot',
  },
]);

export function getModuleDescriptor(moduleId) {
  return SINGLE_IMAGE_FULL.find((m) => m.moduleId === moduleId) || null;
}

export function getRequiredModuleIds() {
  return SINGLE_IMAGE_FULL.filter((m) => m.required).map((m) => m.moduleId);
}

export function getTotalModuleCount() {
  return SINGLE_IMAGE_FULL.length;
}
