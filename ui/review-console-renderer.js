/**
 * ui/review-console-renderer.js
 *
 * Controlled Preview Review Console (EPIC 2E-F Phase C-A).
 *
 * A pure, READ-ONLY UI layer over the existing, already-computed
 * `controlledOverlayPreviewSandboxV2` and `controlledPreviewReviewStateV2`
 * objects. This module NEVER:
 * - re-runs image analysis, K-Means, or any analysis pipeline stage
 * - calls decision-engine, lightroom-mapping-engine, preset-engine, or
 *   xmp-validator
 * - writes to production XMP or Lightroom Mapping in any way
 * - allows the user to change any review item, approve, reject, request
 *   adjustment, or reset anything — there are NO interactive controls
 *   of any kind in this phase. Approving/rejecting a preview item is a
 *   FUTURE phase's responsibility, not this one's.
 *
 * This module performs ZERO mutation and calls no state-transition
 * function (e.g. `updatePreviewReviewItemV2`) — it only ever reads the
 * `sandbox`/`reviewState` objects passed in and renders them as static
 * DOM content.
 *
 * XSS SAFETY: every piece of text that ultimately originates from
 * upstream analysis/review data (reviewer notes, blocker/warning
 * strings, evidence values, IDs, labels) is inserted via `textContent`
 * or `document.createElement`, never via `innerHTML` string
 * interpolation. The only literal HTML strings in this file are
 * hardcoded, static markup with no interpolated dynamic values.
 */

const STATUS_COLOR = { passed: 'var(--success)', failed: 'var(--danger)', pending: 'var(--text-faint)', unavailable: 'var(--text-faint)', 'not-required': 'var(--text-faint)' };
const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', pending: 'Pending', unavailable: 'Unavailable', 'not-required': 'Not required' };
const APPROVAL_COLOR = { approved: 'var(--success)', rejected: 'var(--danger)', blocked: 'var(--danger)', 'needs-adjustment': 'var(--warn)', 'in-progress': 'var(--accent)', 'not-started': 'var(--text-faint)', unavailable: 'var(--text-faint)' };

/** Creates an element with optional class/style/text — text is always set via textContent (never innerHTML). */
function el(tag, { cls, style, text } = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) e.setAttribute('style', style);
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function badge(text, color) {
  return el('span', {
    style: `display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.04em;background:${color}22;color:${color};border:1px solid ${color}44`,
    text,
  });
}

function sectionHeading(text, iconGlyph) {
  const row = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:18px 0 10px;font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)' });
  if (iconGlyph) {
    const icon = el('span', { cls: 'material-symbols-outlined', style: "font-family:'Material Symbols Outlined';font-size:14px;color:var(--accent)", text: iconGlyph });
    row.appendChild(icon);
  }
  row.appendChild(el('span', { text }));
  return row;
}

function listRow(labelText, valueNode) {
  const row = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px' });
  row.appendChild(el('span', { style: 'color:var(--text-dim)', text: labelText }));
  const valWrap = el('div', { style: 'text-align:right;color:var(--text)' });
  if (typeof valueNode === 'string') valWrap.textContent = valueNode;
  else if (valueNode) valWrap.appendChild(valueNode);
  row.appendChild(valWrap);
  return row;
}

/**
 * Renders one checklist item row as a pure, static display — status
 * badge, description, reason, any existing reviewer note/evidence
 * already present on the item. No buttons, no click handlers, no way
 * for the user to change anything from here.
 */
function renderChecklistItem(item) {
  const wrap = el('div', { style: 'padding:12px 0;border-bottom:1px solid var(--border)' });

  const top = el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px' });
  const labelCol = el('div', { style: 'flex:1;min-width:0' });
  labelCol.appendChild(el('div', { style: 'font-size:13px;font-weight:600;color:var(--text)', text: item.label }));
  labelCol.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:2px;line-height:1.4', text: item.description }));
  top.appendChild(labelCol);
  top.appendChild(badge(STATUS_LABEL[item.status] ?? item.status, STATUS_COLOR[item.status] ?? 'var(--text-faint)'));
  wrap.appendChild(top);

  if (item.reason) {
    wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint);margin-top:4px;font-style:italic', text: item.reason }));
  }
  if (item.reviewerNote) {
    const noteWrap = el('div', { style: 'font-size:11.5px;color:var(--text-dim);margin-top:6px;padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--accent)' });
    noteWrap.appendChild(el('span', { style: 'font-family:var(--font-mono);font-size:9px;color:var(--text-faint);margin-right:6px', text: 'NOTE' }));
    noteWrap.appendChild(document.createTextNode(item.reviewerNote)); // reviewer-authored free text — always textContent-equivalent, never HTML
    wrap.appendChild(noteWrap);
  }
  if (item.evidence && Object.keys(item.evidence).length) {
    const evWrap = el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:5px;font-family:var(--font-mono)' });
    const parts = Object.entries(item.evidence).map(([k, v]) => `${k}=${v}`);
    evWrap.textContent = parts.join(' \u00B7 '); // evidence values (e.g. "skinRisk=low") — plain text only, never HTML
    wrap.appendChild(evWrap);
  }

  if (!item.required) {
    wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--text-faint);margin-top:6px', text: 'Not required by current flags.' }));
  }

  return wrap;
}

/**
 * Main entry point. Renders the full Controlled Preview Review Console
 * into `container` (an existing DOM element — its previous content is
 * cleared and replaced, never appended-to indefinitely). PURE READ-ONLY:
 * there is no `opts.onAction` or any other mutation hook — this
 * function only ever reads `sandbox`/`reviewState` and renders static
 * DOM content. Safe to call with `sandbox`/`reviewState` both `null`
 * (renders an "unavailable" placeholder, never throws).
 */
export function renderReviewConsole(container, sandbox, reviewState) {
  if (!container) return;
  container.innerHTML = ''; // clearing our OWN previously-rendered (trusted, DOM-API-built) content — not an XSS vector

  if (!sandbox && !reviewState) {
    container.appendChild(el('div', { style: 'font-size:12.5px;color:var(--text-faint);padding:10px 0', text: 'No preview is available to review yet.' }));
    return;
  }

  // ── Top summary ──────────────────────────────────────────────────────────
  const summaryRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px' });
  if (sandbox) summaryRow.appendChild(badge(`Preview: ${sandbox.previewState ?? 'unknown'}`, sandbox.canGeneratePreview ? 'var(--success)' : 'var(--text-faint)'));
  if (reviewState) summaryRow.appendChild(badge(`Review: ${reviewState.approvalState ?? 'unknown'}`, APPROVAL_COLOR[reviewState.approvalState] ?? 'var(--text-faint)'));
  container.appendChild(summaryRow);

  const photographerLine = reviewState?.reviewSummary?.photographerMessage ?? sandbox?.photographerSummary ?? 'Preparing preview review information.';
  container.appendChild(el('div', { style: 'font-size:13px;color:var(--text);line-height:1.6;margin-bottom:4px', text: photographerLine }));

  // ── Explicit, always-true-in-this-phase confirmations (per spec — never inferred, always read from the objects that enforce them) ──
  const confirmWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px;margin:14px 0;padding:12px 14px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--success)' });
  const confirmLine = (text) => confirmWrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--text-dim);display:flex;align-items:center;gap:6px', text: `\u2713  ${text}` }));
  confirmLine('This preview is non-production and does not affect your exported preset.');
  confirmLine(`Export remains disabled${sandbox ? ` (canExportPreview=${sandbox.canExportPreview === false})` : ''}.`);
  confirmLine(`Production Mapping remains legacy${sandbox ? ` (selectedOutputSource=${sandbox.selectedOutputSource ?? 'legacy'})` : ''}.`);
  container.appendChild(confirmWrap);

  // ── Review progress ───────────────────────────────────────────────────────
  if (reviewState?.reviewProgress) {
    const p = reviewState.reviewProgress;
    container.appendChild(sectionHeading('Review Progress', 'fact_check'));
    const progWrap = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:6px' });
    const barOuter = el('div', { style: 'flex:1;height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden' });
    const pct = Math.max(0, Math.min(100, p.percentage ?? 0));
    const barInner = el('div', { style: `height:100%;width:${pct}%;background:var(--accent);border-radius:3px` });
    barOuter.appendChild(barInner);
    progWrap.appendChild(barOuter);
    progWrap.appendChild(el('span', { style: 'font-family:var(--font-mono);font-size:11px;color:var(--text-dim);white-space:nowrap', text: `${p.completed}/${p.required}` }));
    container.appendChild(progWrap);
    if (reviewState.reviewSummary?.nextRequiredItem) {
      container.appendChild(el('div', { style: 'font-size:11px;color:var(--text-faint)', text: `Next: ${reviewState.reviewSummary.nextRequiredItem}` }));
    }
  }

  // ── Checklist (pure display — no actions) ───────────────────────────────
  if (reviewState?.reviewItems?.length) {
    container.appendChild(sectionHeading('Human Review Checklist', 'checklist'));
    const listWrap = el('div');
    for (const item of reviewState.reviewItems) {
      listWrap.appendChild(renderChecklistItem(item));
    }
    container.appendChild(listWrap);
  }

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = reviewState?.blockers ?? sandbox?.blockers ?? [];
  if (blockers.length) {
    container.appendChild(sectionHeading('Blockers', 'block'));
    const blkWrap = el('div', { style: 'display:flex;flex-direction:column;gap:5px' });
    for (const b of blockers) {
      const text = typeof b === 'string' ? b : (b?.blocker ?? JSON.stringify(b));
      blkWrap.appendChild(el('div', { style: 'font-size:11.5px;color:var(--danger);padding:6px 9px;background:var(--surface-2);border-radius:3px;border-left:2px solid var(--danger)', text }));
    }
    container.appendChild(blkWrap);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = reviewState?.warnings ?? [];
  if (warnings.length) {
    container.appendChild(sectionHeading('Warnings', 'warning'));
    const warnWrap = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    for (const w of warnings) {
      warnWrap.appendChild(el('div', { style: 'font-size:11px;color:var(--warn)', text: `\u26A0  ${w}` }));
    }
    container.appendChild(warnWrap);
  }

  // ── Rollback ──────────────────────────────────────────────────────────────
  const rollback = reviewState?.rollbackPlan ?? sandbox?.rollbackPlan ?? null;
  if (rollback) {
    container.appendChild(sectionHeading('Rollback', 'settings_backup_restore'));
    container.appendChild(listRow('Available', rollback.available ? 'Yes' : 'No'));
    if (rollback.restoreSource) container.appendChild(listRow('Restore source', rollback.restoreSource));
    if (Array.isArray(rollback.steps) && rollback.steps.length) {
      const stepsList = el('ol', { style: 'margin:6px 0 0;padding-left:18px;font-size:11.5px;color:var(--text-dim);line-height:1.7' });
      for (const step of rollback.steps) stepsList.appendChild(el('li', { text: step }));
      container.appendChild(stepsList);
    }
  }
}
