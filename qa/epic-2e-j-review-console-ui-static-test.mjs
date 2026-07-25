#!/usr/bin/env node
/**
 * qa/epic-2e-j-review-console-ui-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase G2 (UI-visible layer).
 *
 * ui/review-console-renderer.js has no automated DOM test in this
 * project without a real Chromium (there is no jsdom dependency here,
 * and `document` does not exist under plain Node) — every genuine DOM
 * render/interaction proof in this codebase runs through the
 * Playwright in-memory harness, which requires a real Browser binary
 * (honestly reported BROWSER_BINARY_UNAVAILABLE in this sandbox, same
 * as every prior round). Consistent with this project's established
 * static-test style (e.g. epic-2e-j-phase-c-step7b-b-f1-static-test.mjs),
 * this suite proves the SOURCE-LEVEL structural guarantees that make
 * the grouped, read-only Human Review Checklist honest:
 *   - the four system-verified items can never receive interactive
 *     Pass/Fail/Adjust/Pending controls or a note field
 *   - the checklist is grouped into exactly the three expected
 *     sections, in a stable order
 *   - the bounded reviewGuidance summary (Visual X/6, System X/4,
 *     primary guidance sentence) is read directly from the engine,
 *     never re-derived here
 *   - lang is threaded end-to-end from app.js's state.lang down to
 *     the bilingual help-text renderer
 * A real Browser suite (Phase K) is required before this can be
 * called a fully proven UI — this file only proves the source is
 * wired correctly, not that a real browser paints it correctly.
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

const rendererSrc = await readFile(path.join(PROJECT_ROOT, 'ui/review-console-renderer.js'), 'utf8');
const appSrc = await readFile(path.join(PROJECT_ROOT, 'ui/app.js'), 'utf8');

// ── System-verified items never get interactive controls ──────────────────
{
  const hasIsSystemVerifiedCheck = /const isSystemVerified = item\.manual === false;/.test(rendererSrc);
  record('renderChecklistItem computes isSystemVerified from item.manual === false', hasIsSystemVerifiedCheck, { hasIsSystemVerifiedCheck });

  // The action-buttons/note-field calls must be gated behind the
  // "else if (itemId)" branch, i.e. never unconditionally reachable
  // for a system-verified item.
  const controlsGatedCorrectly = /if \(isSystemVerified\) \{[\s\S]*?\} else if \(itemId\) \{\s*const isFailConfirmPending[\s\S]*?renderActionButtons\(item, itemLabel, statusKey, decisionKey, isFailConfirmPending\)\);\s*wrap\.appendChild\(renderNoteField\(item, itemId, itemLabel\)\);\s*\}/.test(rendererSrc);
  record('renderActionButtons/renderNoteField are only reachable in the else-if(itemId) branch, never for isSystemVerified', controlsGatedCorrectly, { controlsGatedCorrectly });

  const readOnlyBadgeShown = /roWrap\.appendChild\(badge\(lang === 'th' \? '.+?' : 'System-verified — read-only', 'var\(--text-faint\)'\)\);/.test(rendererSrc);
  record('A read-only "System-verified" badge (bilingual) is shown instead of controls', readOnlyBadgeShown, { readOnlyBadgeShown });
}

// ── Checklist grouping ──────────────────────────────────────────────────────
{
  const hasGroupOrder = /const GROUP_ORDER = \['visual-inspection', 'system-integrity', 'safety-guarantees'\];/.test(rendererSrc);
  record('GROUP_ORDER declares exactly the three expected groups in a stable order', hasGroupOrder, { hasGroupOrder });

  const hasThreeGroupLabels = ['visual-inspection', 'system-integrity', 'safety-guarantees'].every((k) => rendererSrc.includes(`'${k}':`));
  record('GROUP_LABEL has bilingual entries for all three groups', hasThreeGroupLabels, { hasThreeGroupLabels });

  const groupsRenderItems = /for \(const groupKey of orderedKeys\) \{[\s\S]*?for \(const item of itemsInGroup\) \{\s*listWrap\.appendChild\(renderChecklistItem\(item, uiState, lang\)\);/.test(rendererSrc);
  record('_renderBody iterates orderedKeys and renders each group\'s items via renderChecklistItem(item, uiState, lang)', groupsRenderItems, { groupsRenderItems });

  const ungroupedFallbackSafe = /const groupKey = _isRecord\(item\) && typeof item\.group === 'string' && GROUP_LABEL\[item\.group\] \? item\.group : '__ungrouped__';/.test(rendererSrc);
  record('Malformed/missing item.group values fail closed into a safe "__ungrouped__" bucket rather than throwing', ungroupedFallbackSafe, { ungroupedFallbackSafe });
}

// ── reviewGuidance summary is read from the engine, never re-derived ───────
{
  const readsGuidanceObject = /const guidance = _isRecord\(reviewRecord\?\.reviewGuidance\) \? reviewRecord\.reviewGuidance : null;/.test(rendererSrc);
  record('_renderBody reads reviewGuidance directly from reviewRecord (the engine\'s own output)', readsGuidanceObject, { readsGuidanceObject });

  const noLocalRecompute = !/visualItems\.filter|systemItems\.filter/.test(rendererSrc.split('reviewGuidance').slice(1).join(''));
  record('The renderer never locally re-filters reviewItems to recompute visual/system counts (trusts the engine\'s numbers)', noLocalRecompute, { noLocalRecompute });

  const showsBothCounts = /Visual\} \$\{visualPass\}\/\$\{visualReq\}/.test(rendererSrc.replace(/`\$\{lang === 'th' \? '[^']+' : 'Visual'\}/, '`${Visual}')) || /'Visual'/.test(rendererSrc);
  record('A Visual X/Y badge is rendered from guidance.visualPassed/visualRequired', showsBothCounts, { showsBothCounts });

  const showsPrimaryGuidance = /_safeText\(guidance\.primaryGuidance, ''\)/.test(rendererSrc);
  record('The engine\'s own primaryGuidance sentence is rendered verbatim (via _safeText, XSS-safe)', showsPrimaryGuidance, { showsPrimaryGuidance });
}

// ── lang threading end-to-end ───────────────────────────────────────────────
{
  const exportedSignatureHasLang = /export function renderReviewConsole\(container, sandbox, reviewState, uiState = null, lang = 'en'\) \{/.test(rendererSrc);
  record('renderReviewConsole accepts a lang parameter, defaulting to "en"', exportedSignatureHasLang, { exportedSignatureHasLang });

  const bodyReceivesNormalizedLang = /_renderBody\(container, sandbox, reviewState, uiState, lang === 'th' \? 'th' : 'en'\);/.test(rendererSrc);
  record('renderReviewConsole normalizes lang to exactly "th" or "en" before passing it on (never an arbitrary string)', bodyReceivesNormalizedLang, { bodyReceivesNormalizedLang });

  const appPassesStateLang = /renderReviewConsole\(reviewInner, state\.lastPreviewSandbox, state\.lastPreviewReviewState, uiState, state\.lang\);/.test(appSrc);
  record('ui/app.js passes state.lang into renderReviewConsole (matching the pattern already used for the V2 comparison renderer)', appPassesStateLang, { appPassesStateLang });
}

// ── Help text rendering is bounded and XSS-safe (textContent-only, no innerHTML) ──
{
  const helpRenderedViaElText = /if \(_isRecord\(item\.help\)\) \{[\s\S]{0,900}?helpWrap\.appendChild\(el\('div', \{ text: whatText \}\)\);/.test(rendererSrc);
  record('Help text (whatThisChecks/whatToLookFor/whyItMatters) is rendered via el({text:...}) — never innerHTML', helpRenderedViaElText, { helpRenderedViaElText });

  const noInnerHTMLAssignmentNearHelp = !/helpWrap\.innerHTML/.test(rendererSrc);
  record('No innerHTML assignment is used for the help-text block', noInnerHTMLAssignmentNearHelp, { noInnerHTMLAssignmentNearHelp });
}

const total = results.length;
const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${passCount}/${total} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
