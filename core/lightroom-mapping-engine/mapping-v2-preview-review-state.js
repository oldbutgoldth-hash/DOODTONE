/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROLLED PREVIEW REVIEW STATE MODEL (EPIC 2E-F, Phase A)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A standalone review-state layer for the FUTURE Controlled Preview
 * Review Console (Phase B+). This phase creates no UI and is NOT wired
 * into decision-engine — it is a pure, isolated state machine that
 * normalizes human-review input, tracks a 10-item checklist, evaluates
 * completion, and produces deterministic summaries.
 *
 * HARD GUARANTEES:
 * - Never mutates any input object (`existingReviewState`,
 *   `controlledOverlayPreviewSandboxV2`, `controlledOverlayTestGateV2`,
 *   `legacyOverlaySimulationV2`, `legacySafetyOverlayV2`,
 *   `lightroomSafetyClampV2`, `lightroomShadowCompareReportV2`) —
 *   every returned object/array is newly constructed.
 * - The six VISUAL review items (source-image-reviewed,
 *   skin-tones-reviewed, highlights-reviewed, shadows-reviewed,
 *   white-balance-reviewed, color-stacking-reviewed) are NEVER
 *   auto-approved by this module — only a human-supplied update via
 *   `updatePreviewReviewItemV2` can move them out of "pending".
 * - `canApprovePreview` requires genuinely ALL required items to be
 *   `status:"passed"` AND `reviewed:true` AND no `reviewerDecision`
 *   of "reject"/"needs-adjustment" anywhere — never a percentage-based
 *   or partial approval.
 * - No production side effects: this file is not imported by
 *   `core/lightroom-mapping-engine/index.js`, `mapStyleFingerprintToLightroom()`,
 *   preset-engine, xmp-validator, or decision-engine. It does not touch
 *   XMP export or the legacy `decision.styleBudget` in any way.
 *
 * Every input is OPTIONAL; every access below is null-safe. Plain
 * functions only (no classes) — consistent with every other
 * `mapping-v2-*.js` module in this project.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const clampPct = (v) => Math.max(0, Math.min(100, v ?? 0));

const STATUS_VALUES = new Set(['pending', 'passed', 'failed', 'unavailable', 'not-required']);
const DECISION_VALUES = new Set(['approve', 'reject', 'needs-adjustment', 'undecided']);

// The six items that require a human to actually LOOK at the image —
// this module must never manufacture evidence that substitutes for
// that, and must never move these out of "pending" on its own.
const VISUAL_REVIEW_IDS = new Set([
  'source-image-reviewed', 'skin-tones-reviewed', 'highlights-reviewed',
  'shadows-reviewed', 'white-balance-reviewed', 'color-stacking-reviewed',
]);

// Canonical review item definitions — id, label, description, category.
const REVIEW_ITEM_DEFINITIONS = [
  { id: 'legacy-output-preserved', label: 'Legacy output preserved', description: 'Confirm the active production output still comes from legacy Lightroom Mapping, unaffected by this preview.', category: 'integrity' },
  { id: 'source-image-reviewed', label: 'Source image reviewed', description: 'Review the source image alongside the preview before approving anything.', category: 'visual' },
  { id: 'skin-tones-reviewed', label: 'Skin tones reviewed', description: 'Confirm skin tones look natural and protected in the preview.', category: 'visual' },
  { id: 'highlights-reviewed', label: 'Highlights reviewed', description: 'Confirm highlights are not over-capped, blown, or damaged.', category: 'visual' },
  { id: 'shadows-reviewed', label: 'Shadows reviewed', description: 'Confirm shadow detail is preserved, not crushed.', category: 'visual' },
  { id: 'white-balance-reviewed', label: 'White balance reviewed', description: 'Confirm there is no unwanted white balance shift.', category: 'visual' },
  { id: 'color-stacking-reviewed', label: 'Color stacking reviewed', description: 'Confirm no risky colour-tool stacking is visible in the preview.', category: 'visual' },
  { id: 'rollback-confirmed', label: 'Rollback confirmed', description: 'Confirm rollback to legacy mapping is available and understood.', category: 'safety' },
  { id: 'preview-non-production-confirmed', label: 'Preview non-production confirmed', description: 'Confirm the preview is clearly marked non-production and cannot affect exported output.', category: 'safety' },
  { id: 'export-path-unchanged', label: 'Export path unchanged', description: 'Confirm the current XMP export path is unchanged by this preview.', category: 'safety' },
];
const REQUIRED_ITEM_IDS = REVIEW_ITEM_DEFINITIONS.map(d => d.id); // all 10 are required by default

const nowIso = () => new Date().toISOString();

/** Normalizes a caller-supplied status value; unknown/missing → 'pending'. */
function _normalizeStatus(status) {
  return STATUS_VALUES.has(status) ? status : 'pending';
}

/** Normalizes a caller-supplied reviewer decision; unknown/missing → 'undecided'. */
function _normalizeDecision(decision) {
  return DECISION_VALUES.has(decision) ? decision : 'undecided';
}

/** Normalizes a reviewer note — must be a string or null, never invented. */
function _normalizeNote(note) {
  return typeof note === 'string' && note.trim().length ? note.trim() : null;
}

// ── Evidence gathering — ONLY from what actually exists in inputs, never invented ──
function _gatherEvidence(itemId, ctx) {
  const { sandbox, testGate, safety, capture } = ctx;
  const riskReview = sandbox?.previewRiskReview ?? null;

  switch (itemId) {
    case 'legacy-output-preserved': {
      if (!sandbox) return { evidence: null, warning: 'No preview sandbox available — legacy-preservation evidence unavailable.' };
      const isLegacy = sandbox.selectedOutputSource === 'legacy' && sandbox.fallbackStrategy?.useLegacyMapping === true;
      return { evidence: { selectedOutputSource: sandbox.selectedOutputSource ?? null, useLegacyMapping: sandbox.fallbackStrategy?.useLegacyMapping ?? null, isLegacyConfirmedBySandbox: isLegacy }, warning: null };
    }
    case 'source-image-reviewed':
      return { evidence: null, warning: 'No automatic evidence exists for source-image review — this requires direct human inspection of the source image.' };
    case 'skin-tones-reviewed':
      return { evidence: riskReview ? { skinRisk: riskReview.skinRisk ?? 'unknown' } : null, warning: riskReview ? null : 'No preview risk review available — skin-tone risk evidence unavailable.' };
    case 'highlights-reviewed':
      return { evidence: riskReview ? { highlightRisk: riskReview.highlightRisk ?? 'unknown' } : null, warning: riskReview ? null : 'No preview risk review available — highlight risk evidence unavailable.' };
    case 'shadows-reviewed':
      return { evidence: riskReview ? { shadowRisk: riskReview.shadowRisk ?? 'unknown' } : null, warning: riskReview ? null : 'No preview risk review available — shadow risk evidence unavailable.' };
    case 'white-balance-reviewed':
      return { evidence: riskReview ? { whiteBalanceRisk: riskReview.whiteBalanceRisk ?? 'unknown' } : null, warning: riskReview ? null : 'No preview risk review available — white balance risk evidence unavailable.' };
    case 'color-stacking-reviewed':
      return { evidence: riskReview ? { colorRisk: riskReview.colorRisk ?? 'unknown', overStackSeverity: riskReview.overStackSeverity ?? 'unknown' } : null, warning: riskReview ? null : 'No preview risk review available — colour-stacking evidence unavailable.' };
    case 'rollback-confirmed': {
      const rp = sandbox?.rollbackPlan ?? null;
      return { evidence: rp ? { available: rp.available ?? false, restoreSource: rp.restoreSource ?? null, strategy: rp.strategy ?? null } : null, warning: rp ? null : 'No rollback plan available from the preview sandbox.' };
    }
    case 'preview-non-production-confirmed': {
      const preset = sandbox?.simulatedPreviewPreset ?? null;
      return { evidence: preset ? { productionSafe: preset.productionSafe ?? null, appliedToProduction: preset.appliedToProduction ?? null, containsRealSliderValues: preset.containsRealSliderValues ?? null, containsXMPValues: preset.containsXMPValues ?? null } : null, warning: preset ? null : 'No simulated preview preset metadata available.' };
    }
    case 'export-path-unchanged': {
      if (!sandbox) return { evidence: null, warning: 'No preview sandbox available — export-path evidence unavailable.' };
      return { evidence: { canExportPreview: sandbox.canExportPreview ?? null }, warning: sandbox.canExportPreview === false ? null : 'canExportPreview is not confirmed false by the sandbox.' };
    }
    default:
      return { evidence: null, warning: null };
  }
}

/**
 * Builds one fresh review item, seeded from an existing item (if the
 * caller supplied `existingReviewState`) or from scratch, then merged
 * with freshly-gathered evidence. Never marks a visual item as
 * anything but its existing/seeded status — evidence only informs
 * `evidence`/`warnings`, never `status` for visual items.
 */
function _buildReviewItem(def, existingItem, ctx) {
  const { evidence, warning } = _gatherEvidence(def.id, ctx);
  const warnings = [];
  if (warning) warnings.push(warning);

  // Seed from existing state if present (immutably — we only read from it).
  const seededStatus = existingItem ? _normalizeStatus(existingItem.status) : 'pending';
  const seededReviewed = existingItem?.reviewed === true;
  const seededDecision = existingItem ? _normalizeDecision(existingItem.reviewerDecision) : 'undecided';
  const seededNote = existingItem ? _normalizeNote(existingItem.reviewerNote) : null;
  const seededUpdatedAt = existingItem?.updatedAt ?? null;

  return {
    id: def.id, label: def.label, description: def.description, category: def.category,
    required: true, // all 10 canonical items are required by default in this phase
    status: seededStatus, reviewed: seededReviewed, reviewerDecision: seededDecision,
    reviewerNote: seededNote, evidence, warnings, updatedAt: seededUpdatedAt,
  };
}

// ── Progress / Summary / Approval computation (shared by create/evaluate/update/reset) ──
function _computeProgress(reviewItems) {
  const required = reviewItems.filter(i => i.required);
  const passed = required.filter(i => i.status === 'passed');
  const failed = required.filter(i => i.status === 'failed');
  const pending = required.filter(i => i.status === 'pending');
  const unavailable = required.filter(i => i.status === 'unavailable');
  const completed = passed.length; // only "passed" counts toward completion — not-required items never count
  const percentage = required.length ? clampPct((completed / required.length) * 100) : 0;
  return {
    total: reviewItems.length, required: required.length, completed,
    passed: passed.length, failed: failed.length, pending: pending.length,
    unavailable: unavailable.length, percentage: +percentage.toFixed(1),
  };
}

function _computeApproval(reviewItems, sandbox) {
  const required = reviewItems.filter(i => i.required);
  const anyFailed = required.some(i => i.status === 'failed');
  const anyRejected = required.some(i => i.reviewerDecision === 'reject');
  const anyNeedsAdjustment = required.some(i => i.reviewerDecision === 'needs-adjustment');
  const allPassedAndReviewed = required.length > 0 && required.every(i => i.status === 'passed' && i.reviewed === true);
  const noBlockingDecision = required.every(i => i.reviewerDecision !== 'reject' && i.reviewerDecision !== 'needs-adjustment');

  const rollbackConfirmed = required.find(i => i.id === 'rollback-confirmed')?.status === 'passed';
  const nonProductionConfirmed = required.find(i => i.id === 'preview-non-production-confirmed')?.status === 'passed';
  const exportUnchangedConfirmed = required.find(i => i.id === 'export-path-unchanged')?.status === 'passed';

  const sandboxReady = sandbox?.canGeneratePreview === true;

  // canApprovePreview requires BOTH review completion AND sandbox
  // readiness — a genuinely separate gate from approvalState.
  const canApprovePreview = !!sandbox && sandboxReady && allPassedAndReviewed && noBlockingDecision
    && rollbackConfirmed && nonProductionConfirmed && exportUnchangedConfirmed;

  // approvalState reflects the REVIEW's own completion status — "approved"
  // means "every required item passed", independent of whether the
  // sandbox itself happens to be ready right now. canApprovePreview is
  // the separate, stricter gate that also requires sandbox readiness.
  let approvalState;
  if (!sandbox) {
    approvalState = 'unavailable';
  } else if (anyNeedsAdjustment) {
    approvalState = 'needs-adjustment';
  } else if (anyFailed || anyRejected) {
    approvalState = anyRejected ? 'rejected' : 'blocked';
  } else if (allPassedAndReviewed && noBlockingDecision) {
    approvalState = 'approved';
  } else {
    const anyReviewed = required.some(i => i.reviewed === true || i.status !== 'pending');
    approvalState = anyReviewed ? 'in-progress' : 'not-started';
  }

  const canRequestAdjustment = !!sandbox && required.some(i => i.status !== 'passed' || i.reviewerDecision === 'undecided');
  const canRejectPreview = !!sandbox;

  return { canApprovePreview, canRequestAdjustment, canRejectPreview, approvalState };
}

function _computeReviewSummary(reviewItems, progress, approval) {
  const required = reviewItems.filter(i => i.required);
  const nextRequiredItem = required.find(i => i.status === 'pending' || i.status === 'unavailable') ?? null;
  const riskyFindings = required
    .map(i => ({ id: i.id, evidence: i.evidence }))
    .filter(e => e.evidence && Object.values(e.evidence).some(v => v === 'high' || v === 'critical'));

  const headline = approval.approvalState === 'approved' ? 'All required review items passed — preview is approved.'
    : approval.approvalState === 'rejected' ? 'Preview review was rejected.'
    : approval.approvalState === 'needs-adjustment' ? 'Preview requires adjustment before it can be approved.'
    : approval.approvalState === 'blocked' ? 'Preview review is blocked by one or more failed required items.'
    : approval.approvalState === 'unavailable' ? 'No preview sandbox is available to review yet.'
    : approval.approvalState === 'in-progress' ? 'Review is in progress — required items remain.'
    : 'Review has not started yet.';

  const photographerMessage = approval.approvalState === 'approved'
    ? 'Every required check has been completed and passed. The preview is approved for review purposes only — it still does not change your exported preset.'
    : `Review is not complete yet (${progress.completed}/${progress.required} required items passed). Nothing has changed in your exported preset.`;
  const developerMessage = `approvalState=${approval.approvalState}; canApprovePreview=${approval.canApprovePreview}; ${progress.completed}/${progress.required} required items passed, ${progress.failed} failed, ${progress.pending} pending, ${progress.unavailable} unavailable.`;

  return {
    headline, status: approval.approvalState,
    completedRequired: progress.completed, totalRequired: progress.required,
    nextRequiredItem: nextRequiredItem ? nextRequiredItem.id : null,
    riskSummary: riskyFindings.length ? riskyFindings.map(f => `${f.id}: ${JSON.stringify(f.evidence)}`) : ['No elevated-risk evidence currently on record.'],
    photographerMessage, developerMessage,
  };
}

function _buildRollbackPlan() {
  return {
    available: true,
    restoreSource: 'legacy',
    productionMutationDetected: false,
    steps: [
      'Discard the current human-review state.',
      'Discard the isolated preview object.',
      'Restore the selected output source to legacy.',
      'Keep production Lightroom Mapping unchanged.',
      'Keep the existing XMP export path unchanged.',
    ],
  };
}

function _buildFallbackStrategy(reason) {
  return { useLegacyMapping: true, safeMode: true, reason };
}

/**
 * Core, shared state-builder used by both createPreviewReviewStateV2 and
 * evaluatePreviewReviewStateV2 — identical input shape, identical
 * output shape. `create` is for starting a fresh review flow;
 * `evaluate` is for re-computing a state that already has
 * `existingReviewState` history. Both are equally safe with a missing
 * `existingReviewState`.
 */
function _buildReviewState(input) {
  const {
    existingReviewState = null,
    controlledOverlayPreviewSandboxV2 = null,
    controlledOverlayTestGateV2 = null,
    legacyOverlaySimulationV2 = null,
    legacySafetyOverlayV2 = null,
    lightroomSafetyClampV2 = null,
    lightroomShadowCompareReportV2 = null,
    photographerIntent = null, photographerStyle = null, styleDNA = null,
    captureCapability = null,
  } = input ?? {};

  const sandbox = controlledOverlayPreviewSandboxV2 ?? null;
  const testGate = controlledOverlayTestGateV2 ?? null;
  const safety = lightroomSafetyClampV2 ?? null;
  const capture = captureCapability ?? null;
  const ctx = { sandbox, testGate, safety, capture };

  // Build an id → item map from any existing state, read-only.
  const existingItemsById = new Map();
  if (existingReviewState?.reviewItems && Array.isArray(existingReviewState.reviewItems)) {
    for (const it of existingReviewState.reviewItems) {
      if (it && typeof it.id === 'string') existingItemsById.set(it.id, it);
    }
  }

  const reviewItems = REVIEW_ITEM_DEFINITIONS.map(def => _buildReviewItem(def, existingItemsById.get(def.id) ?? null, ctx));

  const requiredItemIds = reviewItems.filter(i => i.required).map(i => i.id);
  const completedItemIds = reviewItems.filter(i => i.status === 'passed').map(i => i.id);
  const failedItemIds = reviewItems.filter(i => i.status === 'failed').map(i => i.id);
  const pendingItemIds = reviewItems.filter(i => i.status === 'pending').map(i => i.id);
  const unavailableItemIds = reviewItems.filter(i => i.status === 'unavailable').map(i => i.id);

  const reviewProgress = _computeProgress(reviewItems);
  const approval = _computeApproval(reviewItems, sandbox);
  const reviewSummary = _computeReviewSummary(reviewItems, reviewProgress, approval);

  const warnings = [], reasons = [];
  if (!sandbox) warnings.push('No Controlled Overlay Preview Sandbox supplied — review state is being tracked ahead of an actual preview.');
  if (sandbox && sandbox.canGeneratePreview !== true) warnings.push('Preview sandbox exists but canGeneratePreview is not true — approval cannot occur even if all review items pass.');
  const missingEvidenceCount = reviewItems.filter(i => i.warnings.length > 0).length;
  if (missingEvidenceCount > 0) warnings.push(`${missingEvidenceCount} review item(s) have incomplete automatic evidence — never treated as passed by default.`);

  reasons.push(`Approval state "${approval.approvalState}" — ${reviewProgress.completed}/${reviewProgress.required} required items passed, canApprovePreview=${approval.canApprovePreview}.`);
  if (VISUAL_REVIEW_IDS.size) reasons.push('Visual review items (source image, skin tones, highlights, shadows, white balance, colour stacking) are never auto-approved — they require explicit human input via updatePreviewReviewItemV2.');

  const legacyAvailabilityFactor = sandbox ? 1 : 0.3;
  const confidence = +clamp01(
    (reviewProgress.percentage / 100) * 0.5 + legacyAvailabilityFactor * 0.3 +
    (testGate?.confidence ?? 0.3) * 0.1 + (legacySafetyOverlayV2?.confidence ?? legacyOverlaySimulationV2?.confidence ?? 0.3) * 0.1
  ).toFixed(3);

  const blockers = [];
  if (!sandbox) blockers.push({ blocker: 'No Controlled Overlay Preview Sandbox is available to review.', severity: 'high', requiredFix: 'Generate a preview via EPIC 2E-E before starting review.', source: 'Controlled Overlay Preview Sandbox V2' });
  if (sandbox && sandbox.canGeneratePreview !== true) blockers.push({ blocker: 'Preview sandbox has not reached canGeneratePreview=true.', severity: 'high', requiredFix: 'Resolve preview sandbox gate failures first.', source: 'Controlled Overlay Preview Sandbox V2' });
  for (const item of reviewItems.filter(i => i.required && i.status === 'failed')) {
    blockers.push({ blocker: `Required review item "${item.id}" failed.`, severity: 'critical', requiredFix: 'Address the failure and re-review this item.', source: 'Human Review' });
  }
  for (const item of reviewItems.filter(i => i.required && i.reviewerDecision === 'needs-adjustment')) {
    blockers.push({ blocker: `Required review item "${item.id}" needs adjustment.`, severity: 'high', requiredFix: 'Make the requested adjustment and re-review.', source: 'Human Review' });
  }

  return {
    mode: 'controlled-preview-human-review',
    reviewState: approval.approvalState, // top-level convenience mirror of approvalState
    reviewItems, requiredItemIds, completedItemIds, failedItemIds, pendingItemIds, unavailableItemIds,
    reviewProgress, reviewSummary,
    canApprovePreview: approval.canApprovePreview, canRequestAdjustment: approval.canRequestAdjustment,
    canRejectPreview: approval.canRejectPreview, approvalState: approval.approvalState,
    blockers, warnings, reasons,
    rollbackPlan: _buildRollbackPlan(),
    fallbackStrategy: _buildFallbackStrategy('This review-state layer never writes production output or exported XMP — legacy Lightroom Mapping remains the exclusive production path regardless of review outcome.'),
    confidence,
    metadata: {
      sandboxAvailable: !!sandbox, sandboxCanGeneratePreview: sandbox?.canGeneratePreview === true,
      testGateAvailable: !!testGate, safetyClampAvailable: !!safety,
      hasCaptureCapability: !!capture, seededFromExistingState: !!existingReviewState,
      generatedAt: nowIso(),
    },
  };
}

/**
 * Creates a fresh review state. Optionally seeds from
 * `input.existingReviewState` (read-only) so a caller can resume an
 * in-progress review rather than losing prior reviewer input. Never
 * throws, including `createPreviewReviewStateV2({})` or no argument.
 */
export function createPreviewReviewStateV2(input = {}) {
  return _buildReviewState(input ?? {});
}

/**
 * Re-evaluates a review state from the same input shape as
 * `createPreviewReviewStateV2` — identical logic, provided as a
 * separate named export for semantic clarity when re-computing an
 * existing flow (e.g. after upstream V2 objects change) rather than
 * starting one. Never throws.
 */
export function evaluatePreviewReviewStateV2(input = {}) {
  return _buildReviewState(input ?? {});
}

/**
 * Returns a NEW state object with exactly one review item updated.
 * Never mutates `state`. Unknown item IDs are safely ignored (the
 * returned state is a full, valid recomputed copy of the input state,
 * unchanged in content, with a warning noting the unknown ID).
 *
 * Consistency rules enforced here (never trusted blindly from `update`):
 * - status:"passed" ⇒ reviewed becomes true; reviewerDecision defaults
 *   to "approve" if the caller didn't explicitly set one.
 * - status:"failed" ⇒ reviewed becomes true; reviewerDecision can never
 *   remain "approve" (forced to "undecided" if the caller tried that).
 * - reviewerDecision:"reject" ⇒ status can never remain "passed"
 *   (forced to "failed" if the caller tried that).
 * - reviewerDecision:"needs-adjustment" ⇒ status is forced away from
 *   "passed" as well, so approval can never occur through this item.
 */
export function updatePreviewReviewItemV2(state, itemId, update = {}) {
  const currentItems = Array.isArray(state?.reviewItems) ? state.reviewItems : [];
  const targetIndex = currentItems.findIndex(i => i && i.id === itemId);

  if (targetIndex === -1) {
    // EPIC 2E-F-A-F Bug 2 fix: an unknown item ID must be a genuine
    // no-op on every derived field — it must NOT re-derive approval,
    // progress, or summary state (the previous implementation called
    // _buildReviewState with a forced-null sandbox, which silently
    // reset approvalState/canApprovePreview/etc. to their
    // no-sandbox values regardless of the real state). This path now
    // deep-clones every field directly from `state` (never
    // JSON.stringify/parse, which would drop undefined values), adds
    // exactly one warning, and touches nothing else.
    const clonedItems = currentItems.map(i => ({
      ...i,
      evidence: i.evidence ? { ...i.evidence } : i.evidence,
      warnings: [...(i.warnings ?? [])],
    }));
    const clonedProgress = state?.reviewProgress ? { ...state.reviewProgress } : state?.reviewProgress;
    const clonedSummary = state?.reviewSummary
      ? { ...state.reviewSummary, riskSummary: [...(state.reviewSummary.riskSummary ?? [])] }
      : state?.reviewSummary;
    const clonedRollbackPlan = state?.rollbackPlan
      ? { ...state.rollbackPlan, steps: [...(state.rollbackPlan.steps ?? [])], triggerConditions: state.rollbackPlan.triggerConditions ? [...state.rollbackPlan.triggerConditions] : state.rollbackPlan.triggerConditions }
      : state?.rollbackPlan;
    const clonedFallbackStrategy = state?.fallbackStrategy ? { ...state.fallbackStrategy } : state?.fallbackStrategy;
    const clonedBlockers = (state?.blockers ?? []).map(b => ({ ...b }));
    const clonedReasons = [...(state?.reasons ?? [])];
    const clonedMetadata = state?.metadata ? { ...state.metadata } : state?.metadata;

    return {
      mode: state?.mode ?? 'controlled-preview-human-review',
      reviewState: state?.reviewState,
      reviewItems: clonedItems,
      requiredItemIds: [...(state?.requiredItemIds ?? [])],
      completedItemIds: [...(state?.completedItemIds ?? [])],
      failedItemIds: [...(state?.failedItemIds ?? [])],
      pendingItemIds: [...(state?.pendingItemIds ?? [])],
      unavailableItemIds: [...(state?.unavailableItemIds ?? [])],
      reviewProgress: clonedProgress,
      reviewSummary: clonedSummary,
      // Every approval-related field is PRESERVED exactly — never
      // recomputed on this path, since nothing about the real state
      // changed (the update targeted an ID that doesn't exist).
      canApprovePreview: state?.canApprovePreview,
      canRequestAdjustment: state?.canRequestAdjustment,
      canRejectPreview: state?.canRejectPreview,
      approvalState: state?.approvalState,
      blockers: clonedBlockers,
      warnings: [...(state?.warnings ?? []), `Unknown review item id "${itemId}" — update ignored safely.`],
      reasons: clonedReasons,
      rollbackPlan: clonedRollbackPlan,
      fallbackStrategy: clonedFallbackStrategy,
      confidence: state?.confidence,
      metadata: clonedMetadata,
    };
  }

  let nextStatus = _normalizeStatus(update.status ?? currentItems[targetIndex].status);
  let nextDecision = _normalizeDecision(update.reviewerDecision ?? currentItems[targetIndex].reviewerDecision);
  const nextNote = update.reviewerNote !== undefined ? _normalizeNote(update.reviewerNote) : currentItems[targetIndex].reviewerNote;

  // Consistency enforcement (never trust the caller's combination blindly).
  if (nextDecision === 'reject' && nextStatus === 'passed') nextStatus = 'failed';
  if (nextDecision === 'needs-adjustment' && nextStatus === 'passed') nextStatus = 'pending';
  if (nextStatus === 'failed' && nextDecision === 'approve') nextDecision = 'undecided';
  if (nextStatus === 'passed' && (update.reviewerDecision === undefined) && nextDecision === 'undecided') nextDecision = 'approve';

  // EPIC 2E-F-A-F Bug 1 fix: reviewed consistency is derived from the
  // FINAL status (after all reviewerDecision↔status normalization
  // above), in a strict, deterministic order:
  //   1. If final status is "passed" or "failed" → reviewed is ALWAYS
  //      true. An explicit update.reviewed=false can NEVER override
  //      this — the contract requires passed/failed items to have been
  //      genuinely reviewed.
  //   2. Otherwise (status is "pending"/"unavailable"/"not-required")
  //      → an explicit update.reviewed is honoured; if none was given,
  //      fall back to the item's current reviewed value.
  let nextReviewed;
  if (nextStatus === 'passed' || nextStatus === 'failed') {
    nextReviewed = true;
  } else if (update.reviewed === true || update.reviewed === false) {
    nextReviewed = update.reviewed;
  } else {
    nextReviewed = currentItems[targetIndex].reviewed;
  }

  const updatedItem = {
    ...currentItems[targetIndex],
    status: nextStatus, reviewed: nextReviewed, reviewerDecision: nextDecision,
    reviewerNote: nextNote, updatedAt: nowIso(),
  };

  const newItems = currentItems.map((it, idx) => idx === targetIndex ? updatedItem : { ...it, evidence: it.evidence ? { ...it.evidence } : it.evidence, warnings: [...(it.warnings ?? [])] });

  const requiredItemIds = newItems.filter(i => i.required).map(i => i.id);
  const completedItemIds = newItems.filter(i => i.status === 'passed').map(i => i.id);
  const failedItemIds = newItems.filter(i => i.status === 'failed').map(i => i.id);
  const pendingItemIds = newItems.filter(i => i.status === 'pending').map(i => i.id);
  const unavailableItemIds = newItems.filter(i => i.status === 'unavailable').map(i => i.id);

  const sandboxProxy = state?.metadata?.sandboxAvailable ? { canGeneratePreview: state?.metadata?.sandboxCanGeneratePreview === true } : null;
  const approval = _computeApproval(newItems, sandboxProxy);
  const reviewProgress = _computeProgress(newItems);
  const reviewSummary = _computeReviewSummary(newItems, reviewProgress, approval);

  const warnings = [...(state?.warnings ?? []).filter(w => !w.startsWith('Unknown review item id'))];
  const missingEvidenceCount = newItems.filter(i => i.warnings.length > 0).length;
  const dedupedWarnings = [...new Set(warnings)];

  const blockers = [];
  if (!state?.metadata?.sandboxAvailable) blockers.push({ blocker: 'No Controlled Overlay Preview Sandbox is available to review.', severity: 'high', requiredFix: 'Generate a preview via EPIC 2E-E before starting review.', source: 'Controlled Overlay Preview Sandbox V2' });
  else if (state?.metadata?.sandboxCanGeneratePreview !== true) blockers.push({ blocker: 'Preview sandbox has not reached canGeneratePreview=true.', severity: 'high', requiredFix: 'Resolve preview sandbox gate failures first.', source: 'Controlled Overlay Preview Sandbox V2' });
  for (const item of newItems.filter(i => i.required && i.status === 'failed')) {
    blockers.push({ blocker: `Required review item "${item.id}" failed.`, severity: 'critical', requiredFix: 'Address the failure and re-review this item.', source: 'Human Review' });
  }
  for (const item of newItems.filter(i => i.required && i.reviewerDecision === 'needs-adjustment')) {
    blockers.push({ blocker: `Required review item "${item.id}" needs adjustment.`, severity: 'high', requiredFix: 'Make the requested adjustment and re-review.', source: 'Human Review' });
  }

  const reasons = [`Approval state "${approval.approvalState}" — ${reviewProgress.completed}/${reviewProgress.required} required items passed, canApprovePreview=${approval.canApprovePreview}.`, `Item "${itemId}" updated to status="${nextStatus}", reviewerDecision="${nextDecision}".`];

  return {
    mode: 'controlled-preview-human-review',
    reviewState: approval.approvalState,
    reviewItems: newItems, requiredItemIds, completedItemIds, failedItemIds, pendingItemIds, unavailableItemIds,
    reviewProgress, reviewSummary,
    canApprovePreview: approval.canApprovePreview, canRequestAdjustment: approval.canRequestAdjustment,
    canRejectPreview: approval.canRejectPreview, approvalState: approval.approvalState,
    blockers, warnings: dedupedWarnings, reasons,
    rollbackPlan: _buildRollbackPlan(),
    fallbackStrategy: _buildFallbackStrategy('This review-state layer never writes production output or exported XMP — legacy Lightroom Mapping remains the exclusive production path regardless of review outcome.'),
    confidence: +clamp01((reviewProgress.percentage / 100) * 0.5 + (state?.confidence ?? 0.3) * 0.5).toFixed(3),
    metadata: { ...(state?.metadata ?? {}), lastUpdatedItemId: itemId, generatedAt: nowIso() },
  };
}

/**
 * Returns a NEW state with every required item reset to pending,
 * reviewer decisions/notes cleared, and approvalState set to
 * "not-started". Never mutates `state`. Preserves only safe static
 * metadata (e.g. whether a sandbox was available), never reviewer input.
 */
export function resetPreviewReviewStateV2(state) {
  const currentItems = Array.isArray(state?.reviewItems) ? state.reviewItems : REVIEW_ITEM_DEFINITIONS.map(def => ({ id: def.id, label: def.label, description: def.description, category: def.category, required: true }));

  const resetItems = currentItems.map(it => ({
    id: it.id, label: it.label, description: it.description, category: it.category, required: it.required ?? true,
    status: 'pending', reviewed: false, reviewerDecision: 'undecided', reviewerNote: null,
    evidence: it.evidence ? { ...it.evidence } : null, // evidence is preserved (it's system-observed, not reviewer input) but reviewer state is fully cleared
    warnings: [...(it.warnings ?? [])],
    updatedAt: null,
  }));

  const requiredItemIds = resetItems.filter(i => i.required).map(i => i.id);
  const reviewProgress = _computeProgress(resetItems);
  const approval = { canApprovePreview: false, canRequestAdjustment: !!state, canRejectPreview: !!state, approvalState: 'not-started' };
  const reviewSummary = _computeReviewSummary(resetItems, reviewProgress, approval);

  return {
    mode: 'controlled-preview-human-review',
    reviewState: 'not-started',
    reviewItems: resetItems, requiredItemIds,
    completedItemIds: [], failedItemIds: [], pendingItemIds: [...requiredItemIds], unavailableItemIds: [],
    reviewProgress, reviewSummary,
    canApprovePreview: false, canRequestAdjustment: approval.canRequestAdjustment,
    canRejectPreview: approval.canRejectPreview, approvalState: 'not-started',
    blockers: [], warnings: ['Review state was reset — all required items returned to pending.'], reasons: ['Review state reset to a fresh, unreviewed baseline.'],
    rollbackPlan: _buildRollbackPlan(),
    fallbackStrategy: _buildFallbackStrategy('This review-state layer never writes production output or exported XMP — legacy Lightroom Mapping remains the exclusive production path regardless of review outcome.'),
    confidence: 0,
    metadata: {
      sandboxAvailable: state?.metadata?.sandboxAvailable ?? false,
      sandboxCanGeneratePreview: state?.metadata?.sandboxCanGeneratePreview ?? false,
      testGateAvailable: state?.metadata?.testGateAvailable ?? false,
      safetyClampAvailable: state?.metadata?.safetyClampAvailable ?? false,
      hasCaptureCapability: state?.metadata?.hasCaptureCapability ?? false,
      resetFromPriorState: !!state,
      generatedAt: nowIso(),
    },
  };
}
