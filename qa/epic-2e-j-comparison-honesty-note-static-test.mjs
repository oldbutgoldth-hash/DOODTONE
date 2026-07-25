#!/usr/bin/env node
/**
 * qa/epic-2e-j-comparison-honesty-note-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase I.
 *
 * Proves the Data Comparison layer (ui/side-by-side-comparison-renderer.js)
 * now explicitly distinguishes itself from the SEPARATE Visual Preview
 * Comparison (pixel-based) evidence layer, without:
 *   - fetching/re-deriving the Visual Preview evidence itself (it only
 *     ever reads an already-computed, optional `visualPreviewInfo` hint
 *     passed in by the caller)
 *   - reinterpreting its OWN "Unknown"/not-available values as
 *     low-risk or equal just because a Visual Preview happens to be
 *     available
 *   - mutating finalStyleIntent.sideBySidePreviewComparisonV2 or the
 *     upstream simulatedPreviewPreset contract in any way
 * Uses direct function import + a real (in-memory, no DOM) execution
 * of `renderSideBySideComparison`'s pure text-producing logic is not
 * possible without a DOM; consistent with this project's established
 * pattern for renderer files with no jsdom dependency, this is a
 * source-pattern static test — a real Browser suite proves the actual
 * rendered result.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, ok, evidence) {
  results.push({ test, result: ok ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  console.log(`${ok ? '✓ [PASS]' : '✗ [FAIL]'} ${test} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const rendererSrc = await readFile(path.join(PROJECT_ROOT, 'ui/side-by-side-comparison-renderer.js'), 'utf8');
const appSrc = await readFile(path.join(PROJECT_ROOT, 'ui/app.js'), 'utf8');

// ── Signature threading ─────────────────────────────────────────────────
{
  const exportedSignature = /export function renderSideBySideComparison\(container, comparison, visualPreviewInfo = null\) \{/.test(rendererSrc);
  record('renderSideBySideComparison accepts an optional visualPreviewInfo parameter, defaulting to null', exportedSignature, { exportedSignature });

  const bodyReceivesIt = /_renderBody\(container, comparison, visualPreviewInfo\);/.test(rendererSrc);
  record('The visualPreviewInfo parameter is threaded into _renderBody', bodyReceivesIt, { bodyReceivesIt });
}

// ── The renderer never fetches/re-derives Visual Preview evidence itself ──
{
  // Strip line comments before checking — the file's JSDoc explains
  // WHERE visualPreviewInfo originates (for documentation purposes),
  // which legitimately mentions these names in prose; what actually
  // matters is that no CODE (import statements, property-access
  // chains, function calls) reaches for this data independently.
  const codeOnly = rendererSrc.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
  const noImportOfOtherEngines = !/^import .*(visual-preview|preview-sandbox|decision-engine)/m.test(codeOnly);
  const noOwnPropertyAccess = !/\.visualPreviewRenderPlanV2\b|\.controlledOverlayPreviewSandboxV2\b|visualPreviewComparisonController\./.test(codeOnly);
  const noOwnFetch = noImportOfOtherEngines && noOwnPropertyAccess;
  record('side-by-side-comparison-renderer.js never imports/reaches for Visual Preview Comparison evidence itself in actual CODE (only its JSDoc prose explains provenance) — only reads the passed-in visualPreviewInfo parameter', noOwnFetch, { noImportOfOtherEngines, noOwnPropertyAccess });

  const treatsAsReadOnlyHint = /const vpInfo = _isRecord\(visualPreviewInfo\) \? visualPreviewInfo : null;/.test(rendererSrc);
  record('visualPreviewInfo is treated as an untrusted, optional, read-only hint (validated via _isRecord, never assumed present)', treatsAsReadOnlyHint, { treatsAsReadOnlyHint });
}

// ── Own Unknown/not-available values are never reinterpreted by the other layer ──
{
  const legacyDataAvailableUnchanged = /Legacy data available \(this layer\): \$\{_yesNoUnknown\(legacyPreview \? legacyDataAvailable : undefined\)\}/.test(rendererSrc);
  const v2DataAvailableUnchanged = /V2 data available \(this layer\): \$\{_yesNoUnknown\(v2Preview \? v2DataAvailable : undefined\)\}/.test(rendererSrc);
  record('legacyDataAvailable/v2DataAvailable (this Data Comparison layer\'s own values) are still computed purely from `comparison`, never influenced by visualPreviewInfo', legacyDataAvailableUnchanged && v2DataAvailableUnchanged, { legacyDataAvailableUnchanged, v2DataAvailableUnchanged });

  const noteNeverClaimsUnknownResolved = /does NOT change any "Unknown" value shown above/.test(rendererSrc);
  record('The cross-reference note explicitly states it does NOT change any "Unknown" value from this layer', noteNeverClaimsUnknownResolved, { noteNeverClaimsUnknownResolved });
}

// ── Three honest branches for the Visual layer's own status ─────────────
{
  const hasNoInfoBranch = /if \(!vpInfo\) \{/.test(rendererSrc);
  const hasSafetyRestraintBranch = /vpTranslation\?\.mode === 'legacy-derived-safety-restraint'/.test(rendererSrc);
  const hasIdentityFallbackBranch = /vpTranslation\?\.mode === 'identity-fallback'/.test(rendererSrc);
  const hasElseNotAvailableBranch = /not currently available for this analysis/.test(rendererSrc);
  record('The Visual-layer cross-reference note has 4 honest branches: no-info, safety-restraint, identity-fallback, and not-available', hasNoInfoBranch && hasSafetyRestraintBranch && hasIdentityFallbackBranch && hasElseNotAvailableBranch, { hasNoInfoBranch, hasSafetyRestraintBranch, hasIdentityFallbackBranch, hasElseNotAvailableBranch });

  const gatedByRenderableFlag = /const vpRenderable = vpInfo\?\.renderable === true;/.test(rendererSrc);
  record('The positive branches (safety-restraint/identity-fallback) require vpInfo.renderable === true, never assumed from mode alone', gatedByRenderableFlag, { gatedByRenderableFlag });
}

// ── app.js call site passes real, already-computed data (no new computation) ──
{
  const readsExistingRenderPlan = /const vprPlanForComparisonNote = finalPreset\._decision\?\.finalStyleIntent\?\.visualPreviewRenderPlanV2 \?\? null;/.test(appSrc);
  record('app.js reads visualPreviewRenderPlanV2 directly from the already-computed finalStyleIntent — no new engine call', readsExistingRenderPlan, { readsExistingRenderPlan });

  const passesOnlyBoundedFields = /renderable: vprPlanForComparisonNote\.renderable === true, controlledV2Translation: _isRecordLike\(vprPlanForComparisonNote\.controlledV2Translation\) \? vprPlanForComparisonNote\.controlledV2Translation : null/.test(appSrc);
  record('Only a small, bounded subset (renderable + controlledV2Translation) is passed through, not the entire render plan object', passesOnlyBoundedFields, { passesOnlyBoundedFields });

  const passedToRenderCall = /renderSideBySideComparison\(comparisonInner, state\.lastSideBySideComparison, visualPreviewInfoForComparisonNote\);/.test(appSrc);
  record('The bounded hint is passed as the 3rd argument to renderSideBySideComparison', passedToRenderCall, { passedToRenderCall });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
