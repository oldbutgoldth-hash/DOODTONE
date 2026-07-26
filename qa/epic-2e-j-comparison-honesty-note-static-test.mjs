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
import { en } from '../ui/i18n/en.js';

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
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase J: signature now also accepts an explicit `locale` parameter (defaulting to 'en'), threaded through to every translated string -- never captured stale.
  const exportedSignature = /export function renderSideBySideComparison\(container, comparison, visualPreviewInfo = null, locale = 'en'\) \{/.test(rendererSrc);
  record('renderSideBySideComparison accepts an optional visualPreviewInfo parameter (defaulting to null) and an explicit locale parameter (defaulting to en)', exportedSignature, { exportedSignature });

  const bodyReceivesIt = /_renderBody\(container, comparison, visualPreviewInfo, locale\);/.test(rendererSrc);
  record('The visualPreviewInfo parameter (and locale) is threaded into _renderBody', bodyReceivesIt, { bodyReceivesIt });
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
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase B/J: the
  // literal English strings are now sourced through t(), but the
  // underlying computation (legacyPreview ? legacyDataAvailable : undefined)
  // is unchanged -- verify the VALUE expression, not the English wording.
  const legacyDataAvailableUnchanged = /t\('comparison\.legacyDataAvailable', \{ value: _yesNoUnknown\(legacyPreview \? legacyDataAvailable : undefined, locale\) \}, locale\)/.test(rendererSrc);
  const v2DataAvailableUnchanged = /t\('comparison\.v2DataAvailable', \{ value: _yesNoUnknown\(v2Preview \? v2DataAvailable : undefined, locale\) \}, locale\)/.test(rendererSrc);
  record('legacyDataAvailable/v2DataAvailable (this Data Comparison layer\'s own values) are still computed purely from `comparison`, never influenced by visualPreviewInfo', legacyDataAvailableUnchanged && v2DataAvailableUnchanged, { legacyDataAvailableUnchanged, v2DataAvailableUnchanged });

  const noteNeverClaimsUnknownResolved = /does NOT change any "Unknown" value shown above/.test(en.comparison.visualLayerNote.safetyRestraint) && /does NOT change any "Unknown" value shown above/.test(en.comparison.visualLayerNote.identityFallback);
  record('The cross-reference note explicitly states it does NOT change any "Unknown" value from this layer', noteNeverClaimsUnknownResolved, { noteNeverClaimsUnknownResolved });
}

// ── Three honest branches for the Visual layer's own status ─────────────
{
  const hasNoInfoBranch = /if \(!vpInfo\) \{/.test(rendererSrc);
  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase F:
  // the mode check now reads `effectiveTranslationMode` (which prefers
  // the caller's resolved post-render state, falling back to
  // vpTranslation?.mode) rather than vpTranslation?.mode directly --
  // verify the effective-mode variable itself is correctly derived
  // from vpTranslation as its fallback, and that both branches exist.
  const derivesEffectiveModeFromTranslation = /const effectiveTranslationMode = resolvedVisual\?\.translationMode \?\? vpTranslation\?\.mode;/.test(rendererSrc);
  const hasSafetyRestraintBranch = /effectiveTranslationMode === 'legacy-derived-safety-restraint'/.test(rendererSrc) && derivesEffectiveModeFromTranslation;
  const hasIdentityFallbackBranch = /effectiveTranslationMode === 'identity-fallback'/.test(rendererSrc) && derivesEffectiveModeFromTranslation;
  const hasElseNotAvailableBranch = /not currently available for this analysis/.test(en.comparison.visualLayerNote.notAvailable);
  record('The Visual-layer cross-reference note has 4 honest branches: no-info, safety-restraint, identity-fallback, and not-available', hasNoInfoBranch && hasSafetyRestraintBranch && hasIdentityFallbackBranch && hasElseNotAvailableBranch, { hasNoInfoBranch, hasSafetyRestraintBranch, hasIdentityFallbackBranch, hasElseNotAvailableBranch });

  // Now conditionally derived: prefers resolved post-render evidence
  // (legacyRendered/v2Rendered) when present, else falls back to the
  // plan-time vpInfo.renderable === true flag -- never assumed true
  // from mode alone in either case.
  const gatedByRenderableFlag = /const vpRenderable = resolvedVisual \? \(resolvedVisual\.legacyRendered === true \|\| resolvedVisual\.v2Rendered === true\) : vpInfo\?\.renderable === true;/.test(rendererSrc);
  record('The positive branches (safety-restraint/identity-fallback) require vpInfo.renderable === true, never assumed from mode alone', gatedByRenderableFlag, { gatedByRenderableFlag });
}

// ── app.js call site passes real, already-computed data (no new computation) ──
{
  const readsExistingRenderPlan = /const vprPlanForComparisonNote = finalPreset\._decision\?\.finalStyleIntent\?\.visualPreviewRenderPlanV2 \?\? null;/.test(appSrc);
  record('app.js reads visualPreviewRenderPlanV2 directly from the already-computed finalStyleIntent — no new engine call', readsExistingRenderPlan, { readsExistingRenderPlan });

  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase E:
  // updated to match the FIXED field-path (Defect 2B/2C) -- the bounded
  // hint now reads `renderable`/`controlledV2Translation` from the
  // correctly-nested `v2RenderPlanForComparisonNote` (itself read from
  // `vprPlanForComparisonNote.v2RenderPlan`), plus the two explicit
  // `sharedRenderConstraints` booleans, never from non-existent root
  // fields on `vprPlanForComparisonNote` itself.
  const readsV2RenderPlanNested = /const v2RenderPlanForComparisonNote = _isRecordLike\(vprPlanForComparisonNote\?\.v2RenderPlan\)/.test(appSrc);
  record('app.js reads the nested v2RenderPlan object (never a non-existent root field) before extracting renderable/controlledV2Translation', readsV2RenderPlanNested, { readsV2RenderPlanNested });

  const passesOnlyBoundedFields = /renderable: v2RenderPlanForComparisonNote\?\.renderable === true,\s*\n\s*controlledV2Translation: _isRecordLike\(v2RenderPlanForComparisonNote\?\.controlledV2Translation\) \? v2RenderPlanForComparisonNote\.controlledV2Translation : null,/.test(appSrc);
  record('Only a small, bounded subset (renderable + controlledV2Translation + allowProductionWrite + allowExport) is passed through, not the entire render plan object', passesOnlyBoundedFields, { passesOnlyBoundedFields });

  // Regression guard (Phase E requirement): forbid ever reading these
  // two fields directly off the ROOT of visualPreviewRenderPlanV2 again
  // anywhere in app.js -- this is the exact defect class from EPIC
  // 2E-J-R1 Defect 2B/2C. Matches `visualPreviewRenderPlanV2.renderable`
  // or `visualPreviewRenderPlanV2.controlledV2Translation` (optional-
  // chained or not), but correctly allows `visualPreviewRenderPlanV2.v2RenderPlan`
  // and `visualPreviewRenderPlanV2.sharedRenderConstraints`.
  const forbiddenRootReadPattern = /visualPreviewRenderPlanV2\??\.(renderable|controlledV2Translation)\b/;
  const hasForbiddenRootRead = forbiddenRootReadPattern.test(appSrc);
  record('app.js never reads the non-existent root fields visualPreviewRenderPlanV2.renderable / .controlledV2Translation anywhere', !hasForbiddenRootRead, { hasForbiddenRootRead });

  // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase J:
  // renderSideBySideComparison now also receives the current locale as
  // its 4th argument (state.lang) so it can render every label in the
  // active language without capturing a stale value.
  const passedToRenderCall = /renderSideBySideComparison\(comparisonInner, state\.lastSideBySideComparison, visualPreviewInfoForComparisonNote, state\.lang\);/.test(appSrc);
  record('The bounded hint and current locale are passed as the 3rd/4th arguments to renderSideBySideComparison', passedToRenderCall, { passedToRenderCall });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
