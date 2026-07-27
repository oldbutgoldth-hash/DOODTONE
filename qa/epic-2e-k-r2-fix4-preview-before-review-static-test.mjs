#!/usr/bin/env node
/** EPIC 2E-K-R2-FIX4 — Preview-before-review + Candidate-only approval. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFinalPreset } from '../core/decision-engine/index.js';
import {
  applyPreviewEvidenceToReviewStateV2,
  updatePreviewReviewItemV2,
} from '../core/lightroom-mapping-engine/mapping-v2-preview-review-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
function check(name, ok, evidence = {}) {
  results.push({ name, ok });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${name} — ${JSON.stringify(evidence)}`);
}

const preset = buildFinalPreset({});
const fsi = preset?._decision?.finalStyleIntent ?? null;
const sandbox = fsi?.controlledOverlayPreviewSandboxV2 ?? null;
let review = fsi?.controlledPreviewReviewStateV2 ?? null;
const renderPlan = fsi?.visualPreviewRenderPlanV2?.v2RenderPlan ?? null;

check('Preview Sandbox exists without prior Human Review', !!sandbox);
check('Preview generation is independent of Candidate Review', sandbox?.canGeneratePreview === true, { canGeneratePreview: sandbox?.canGeneratePreview });
check('Controlled V2 Render Plan is renderable before Candidate Review', renderPlan?.renderable === true, { renderable: renderPlan?.renderable });
check('Initial Candidate Review is not auto-approved', review?.candidateReviewStatus !== 'approved' && review?.approvalState !== 'approved', { candidateReviewStatus: review?.candidateReviewStatus, approvalState: review?.approvalState });
check('Review guidance explicitly says preview does not depend on review', review?.reviewGuidance?.previewGenerationDependsOnReview === false, review?.reviewGuidance);
check('Review state hard-locks Production source to Legacy', review?.productionSource === 'legacy');
check('Review state cannot write Production/XMP or export preview', review?.productionWrite === false && review?.controlledV2Apply === false && review?.previewExport === false && review?.productionActivationAllowed === false, {
  productionWrite: review?.productionWrite,
  controlledV2Apply: review?.controlledV2Apply,
  previewExport: review?.previewExport,
  productionActivationAllowed: review?.productionActivationAllowed,
});

review = applyPreviewEvidenceToReviewStateV2(review, {
  generationId: 1,
  renderState: 'rendering',
  legacyRendered: false,
  v2Rendered: false,
  bothRendered: false,
  visualComparisonAvailable: false,
});
const blocked = updatePreviewReviewItemV2(review, 'source-image-reviewed', {
  status: 'passed', reviewed: true, reviewerDecision: 'approve',
});
check('Direct Candidate Review update is blocked before pixel evidence', blocked?.metadata?.lastActionError === 'PREVIEW_EVIDENCE_REQUIRED', { lastActionError: blocked?.metadata?.lastActionError });
check('Blocked pre-evidence update does not mark item passed', blocked?.reviewItems?.find(i => i.id === 'source-image-reviewed')?.status === 'pending');

review = applyPreviewEvidenceToReviewStateV2(review, {
  generationId: 1,
  renderState: 'rendered',
  legacyRendered: true,
  v2Rendered: true,
  bothRendered: true,
  visualComparisonAvailable: true,
});
const allowed = updatePreviewReviewItemV2(review, 'source-image-reviewed', {
  status: 'passed', reviewed: true, reviewerDecision: 'approve',
});
check('Candidate Review becomes available only after both previews render', allowed?.reviewItems?.find(i => i.id === 'source-image-reviewed')?.status === 'passed');
check('Candidate Review update still cannot enable Production/XMP', allowed?.productionSource === 'legacy' && allowed?.productionWrite === false && allowed?.controlledV2Apply === false && allowed?.previewExport === false && allowed?.productionActivationAllowed === false);

let fullyApproved = allowed;
for (const itemId of ['skin-tones-reviewed', 'highlights-reviewed', 'shadows-reviewed', 'white-balance-reviewed', 'color-stacking-reviewed']) {
  fullyApproved = updatePreviewReviewItemV2(fullyApproved, itemId, {
    status: 'passed', reviewed: true, reviewerDecision: 'approve',
  });
}
check('All six visual checks complete Candidate Review only', fullyApproved?.candidateReviewStatus === 'approved' && fullyApproved?.reviewGuidance?.candidateReviewComplete === true, {
  candidateReviewStatus: fullyApproved?.candidateReviewStatus,
  visualPassed: fullyApproved?.reviewGuidance?.visualPassed,
});
check('Even fully-approved Candidate Review keeps Legacy Production and XMP/write paths locked', fullyApproved?.productionSource === 'legacy' && fullyApproved?.productionWrite === false && fullyApproved?.controlledV2Apply === false && fullyApproved?.previewExport === false && fullyApproved?.productionActivationAllowed === false, {
  productionSource: fullyApproved?.productionSource,
  productionWrite: fullyApproved?.productionWrite,
  controlledV2Apply: fullyApproved?.controlledV2Apply,
  previewExport: fullyApproved?.previewExport,
});

const app = await readFile(path.join(ROOT, 'ui/app.js'), 'utf8');
const controller = await readFile(path.join(ROOT, 'ui/review-console-controller.js'), 'utf8');
const renderer = await readFile(path.join(ROOT, 'ui/review-console-renderer.js'), 'utf8');
const decision = await readFile(path.join(ROOT, 'core/decision-engine/index.js'), 'utf8');

check('Authoritative Preview Sandbox disables only the Human Review preview gate', /flags:\s*\{\s*requireHumanReviewForPreview:\s*false\s*\}/.test(decision));
const handler = app.match(/async function handleBuildControlledV2Preview\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
check('View Preview control never re-runs Analysis', handler.length > 0 && !/runAnalysis\s*\(/.test(handler));
check('App re-renders Candidate Review when pixel render settles', /applyPreviewEvidenceToReviewStateV2\(state\.lastPreviewReviewState,[\s\S]{0,500}bothRendered/.test(app));
check('Controller blocks Candidate Review before evidence', /getReviewAvailability/.test(controller) && /Preview evidence is not ready yet/.test(controller));
check('Renderer disables Candidate Review controls and note fields before evidence', /reviewDisabled/.test(renderer) && /aria-disabled/.test(renderer) && /previewEvidencePending/.test(renderer));
check('New analysis generation archives and invalidates prior Candidate Review', /_archiveCandidateReviewForNewGeneration\(renderGeneration\)/.test(app) && /controlledPreviewReviewStateV2:\s*null/.test(app));

const pass = results.filter(r => r.ok).length;
const fail = results.length - pass;
console.log(`\n${pass}/${results.length} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
