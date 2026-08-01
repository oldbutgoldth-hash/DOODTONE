/**
 * ui/single-image-report-renderer.js
 *
 * EPIC 2E-P1B — AI Image Analysis Report renderer.
 *
 * Pure render function: `renderSingleImageReport(container, report, lang)`
 * reads ONLY the already-built `report` object (session.report, produced
 * by core/single-image/report/analysis-report-builder.js) and `lang`.
 * It NEVER:
 * - re-runs any Core module or the report builder itself
 * - reads DOM slider values or any other business state
 * - fabricates a value not already present in `report`
 *
 * Every visible label/observation/recommendation/warning string is
 * resolved through the existing i18n `t()` function from a stable
 * `report.<section>.<code>` key — this file holds no hardcoded
 * bilingual text. Every value is inserted via `textContent`/DOM APIs,
 * never `innerHTML`, matching this project's established XSS-safety
 * convention (see review-console-renderer.js).
 *
 * Calling this function twice with the same `report` (e.g. once on
 * report completion, once again on a pure language switch) produces
 * the same DOM content in the new language — it never triggers
 * analysis, never mutates `report`, and is safe to call as often as
 * the caller likes.
 */

import { t } from './i18n/index.js';

function _el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  return e;
}

function _clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

/** Resolve a {code, params} observation/recommendation/warning entry through t(). */
function _resolveEntry(entry, prefix, lang) {
  if (!entry || !entry.code) return '';
  return t(`report.${prefix}.${entry.code}`, entry.params ?? null, lang);
}

function _confidenceLabel(confidence, lang) {
  if (!confidence || confidence.level === 'UNAVAILABLE' || confidence.score === null) {
    return t('report.confidence.unavailable', null, lang);
  }
  const levelKey = `report.confidence.level.${confidence.level}`;
  return t('report.confidence.withScore', { level: t(levelKey, null, lang), score: confidence.score }, lang);
}

function _statusBadge(status, lang) {
  const badge = _el('span', {
    cls: 'lx-report-badge',
    text: t(`report.sectionStatus.${status}`, null, lang),
    style: {
      fontFamily: 'var(--font-mono)', fontSize: '9.5px', fontWeight: '700', letterSpacing: '.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: '2px', border: '1px solid var(--border)',
      color: 'var(--text-dim)',
    },
  });
  if (status === 'UNAVAILABLE' || status === 'FAILED') badge.style.opacity = '0.7';
  return badge;
}

function _list(items, prefix, lang, emptyKey) {
  const ul = _el('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-dim)', lineHeight: '1.6' } });
  if (!items || items.length === 0) {
    if (emptyKey) {
      const li = _el('li', { text: t(emptyKey, null, lang), style: { listStyle: 'none', marginLeft: '-18px', color: 'var(--text-faint)' } });
      ul.appendChild(li);
    }
    return ul;
  }
  for (const entry of items) {
    const text = _resolveEntry(entry, prefix, lang);
    if (!text) continue;
    ul.appendChild(_el('li', { text }));
  }
  return ul;
}

function _sectionBlock(titleKey, section, lang, { extraRows = [] } = {}) {
  const wrap = _el('details', { cls: 'lx-report-section', style: { border: '1px solid var(--border)', borderRadius: '3px', marginBottom: '8px', background: 'var(--surface-2)' } });
  wrap.open = section.status === 'AVAILABLE' || section.status === 'PARTIAL' || section.status === 'LOW_CONFIDENCE';

  const summary = _el('summary', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
      padding: '11px 14px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: '600', color: 'var(--text)',
    },
  });
  const left = _el('span', { text: t(titleKey, null, lang) });
  const right = _el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
  right.appendChild(_el('span', { text: _confidenceLabel(section.confidence, lang), style: { fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-faint)' } }));
  right.appendChild(_statusBadge(section.status, lang));
  summary.appendChild(left);
  summary.appendChild(right);
  wrap.appendChild(summary);

  const body = _el('div', { style: { padding: '0 14px 14px' } });

  if (section.status === 'UNAVAILABLE') {
    body.appendChild(_el('p', { text: t('report.section.unavailable', null, lang), style: { fontSize: '12.5px', color: 'var(--text-faint)', margin: '4px 0 0' } }));
    wrap.appendChild(body);
    return wrap;
  }

  if (extraRows.length) {
    const dl = _el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '8px', margin: '6px 0 10px', fontFamily: 'var(--font-mono)', fontSize: '11px' } });
    for (const [labelKey, value] of extraRows) {
      if (value === null || value === undefined) continue;
      const cell = _el('div');
      cell.appendChild(_el('div', { text: t(labelKey, null, lang), style: { color: 'var(--text-faint)', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '.05em' } }));
      cell.appendChild(_el('div', { text: String(value), style: { color: 'var(--text)', fontSize: '12.5px', marginTop: '2px' } }));
      dl.appendChild(cell);
    }
    body.appendChild(dl);
  }

  const obsLabel = _el('div', { text: t('report.label.observations', null, lang), style: { fontSize: '10px', fontWeight: '700', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: '4px' } });
  body.appendChild(obsLabel);
  body.appendChild(_list(section.observations, 'observations', lang, null));

  if (section.recommendations && section.recommendations.length) {
    body.appendChild(_el('div', { text: t('report.label.recommendations', null, lang), style: { fontSize: '10px', fontWeight: '700', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-faint)', marginTop: '10px' } }));
    body.appendChild(_list(section.recommendations, 'recommendations', lang, null));
  }
  if (section.warnings && section.warnings.length) {
    const warnWrap = _el('div', { style: { marginTop: '10px', padding: '8px 10px', borderRadius: '2px', background: 'var(--accent-soft)', border: '1px solid var(--border)' } });
    warnWrap.appendChild(_el('div', { text: t('report.label.warnings', null, lang), style: { fontSize: '10px', fontWeight: '700', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-dim)' } }));
    warnWrap.appendChild(_list(section.warnings, 'warnings', lang, null));
    body.appendChild(warnWrap);
  }

  wrap.appendChild(body);
  return wrap;
}

function _renderSummary(container, report, lang) {
  const box = _el('div', { style: { padding: '16px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface-1)', marginBottom: '12px' } });
  const head = _el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' } });
  head.appendChild(_el('div', { text: t('report.title', null, lang), style: { fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: '700', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' } }));
  const statusBadge = _statusBadge(report.status === 'COMPLETE' ? 'AVAILABLE' : (report.status === 'PARTIAL' ? 'PARTIAL' : 'UNAVAILABLE'), lang);
  head.appendChild(statusBadge);
  box.appendChild(head);

  if (report.status === 'PARTIAL') {
    box.appendChild(_el('p', { text: t('report.partialAnalysisNotice', null, lang), style: { fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 8px' } }));
  } else if (report.status === 'FAILED') {
    box.appendChild(_el('p', { text: t('report.analysisUnavailableNotice', null, lang), style: { fontSize: '12px', color: 'var(--text-dim)', margin: '0 0 8px' } }));
    container.appendChild(box);
    return;
  }

  const desc = report.summary?.shortDescriptionCode
    ? t(`report.${report.summary.shortDescriptionCode}`, report.summary.shortDescriptionParams, lang)
    : '';
  if (desc) box.appendChild(_el('p', { text: desc, style: { fontSize: '14px', color: 'var(--text)', margin: '0 0 10px', lineHeight: '1.5' } }));

  const confRow = _el('div', { style: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)' } });
  confRow.appendChild(document.createTextNode(`${t('report.label.overallConfidence', null, lang)}: `));
  confRow.appendChild(_el('span', { text: _confidenceLabel(report.summary?.overallConfidence, lang), style: { color: 'var(--text-dim)' } }));
  box.appendChild(confRow);

  if (report.summary?.qualityFlags?.length) {
    const flagsWrap = _el('div', { style: { marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    for (const code of report.summary.qualityFlags) {
      flagsWrap.appendChild(_el('span', {
        text: t(`report.issues.${code}.title`, null, lang),
        style: { fontSize: '10.5px', padding: '3px 8px', borderRadius: '2px', border: '1px solid var(--border)', color: 'var(--text-dim)' },
      }));
    }
    box.appendChild(flagsWrap);
  }

  container.appendChild(box);
}

function _renderCreativeCharacteristics(container, report, lang) {
  if (!report.creativeCharacteristics || report.creativeCharacteristics.length === 0) return;
  const wrap = _el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } });
  for (const tag of report.creativeCharacteristics) {
    wrap.appendChild(_el('span', {
      text: t(`report.creative.${tag.code}`, tag.params ?? null, lang),
      style: {
        fontFamily: 'var(--font-mono)', fontSize: '10.5px', padding: '4px 10px', borderRadius: '12px',
        border: '1px solid var(--border)', color: 'var(--accent)', background: 'var(--accent-soft)',
      },
    }));
  }
  container.appendChild(wrap);
}

function _renderTechnicalIssues(container, report, lang) {
  if (!report.technicalIssues || report.technicalIssues.length === 0) return;
  const wrap = _el('details', { style: { border: '1px solid var(--border)', borderRadius: '3px', marginBottom: '8px', background: 'var(--surface-2)' } });
  const summary = _el('summary', { text: t('report.technicalIssuesTitle', { count: report.technicalIssues.length }, lang), style: { padding: '11px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: 'var(--text)' } });
  wrap.appendChild(summary);
  const body = _el('div', { style: { padding: '0 14px 14px' } });
  for (const issue of report.technicalIssues) {
    const row = _el('div', { style: { padding: '8px 0', borderTop: '1px solid var(--border)' } });
    const titleRow = _el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } });
    titleRow.appendChild(_el('span', {
      text: t(`report.severity.${issue.severity}`, null, lang),
      style: { fontFamily: 'var(--font-mono)', fontSize: '9.5px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--accent)' },
    }));
    titleRow.appendChild(_el('span', { text: t(issue.titleKey, null, lang), style: { fontSize: '13px', fontWeight: '600', color: 'var(--text)' } }));
    row.appendChild(titleRow);
    row.appendChild(_el('p', { text: t(issue.descriptionKey, issue.descriptionParams, lang), style: { fontSize: '12px', color: 'var(--text-dim)', margin: '4px 0' } }));
    if (issue.recommendationKey) {
      row.appendChild(_el('p', { text: t(issue.recommendationKey, null, lang), style: { fontSize: '12px', color: 'var(--text-faint)', margin: '0' } }));
    }
    body.appendChild(row);
  }
  wrap.appendChild(body);
  container.appendChild(wrap);
}

function _renderAdvancedDiagnostics(container, report, lang) {
  const wrap = _el('details', { style: { border: '1px solid var(--border)', borderRadius: '3px', marginBottom: '8px', background: 'var(--surface-2)' } });
  wrap.appendChild(_el('summary', { text: t('report.advancedDiagnosticsTitle', null, lang), style: { padding: '11px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: 'var(--text-dim)' } }));
  const body = _el('div', { style: { padding: '0 14px 14px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)' } });

  body.appendChild(_el('div', { text: `${t('report.diagnostics.completedEvidence', null, lang)}: ${(report.diagnostics.completedEvidence || []).join(', ') || '—'}` }));
  body.appendChild(_el('div', { text: `${t('report.diagnostics.unavailableEvidence', null, lang)}: ${(report.diagnostics.unavailableEvidence || []).join(', ') || '—'}` }));
  if (report.diagnostics.softFailedModules?.length) {
    body.appendChild(_el('div', { text: `${t('report.diagnostics.softFailedModules', null, lang)}: ${report.diagnostics.softFailedModules.join(', ')}` }));
  }
  body.appendChild(_el('div', { text: `reportId: ${report.reportId}` }));
  body.appendChild(_el('div', { text: `sessionId: ${report.sessionId}` }));
  body.appendChild(_el('div', { text: `schemaVersion: ${report.schemaVersion}` }));
  body.appendChild(_el('div', { text: `reportBuildCount: ${report.reportBuildCount}` }));

  const lineageKeys = Object.keys(report.lineage || {});
  if (lineageKeys.length) {
    body.appendChild(_el('div', { text: t('report.diagnostics.lineageTitle', null, lang), style: { marginTop: '8px', fontWeight: '700', color: 'var(--text-dim)' } }));
    for (const key of lineageKeys) {
      const entry = report.lineage[key];
      const line = `${key}: ${entry.sourceModules.join('+')} [${entry.evidenceKeys.join(',')}]${entry.fallbackUsed ? ' (legacy fallback used)' : ''}`;
      body.appendChild(_el('div', { text: line, style: { marginTop: '2px' } }));
    }
  }

  wrap.appendChild(body);
  container.appendChild(wrap);
}

/**
 * Render the full AAI Image Analysis Report. `report` may be null
 * (WAITING_FOR_ANALYSIS placeholder) — callers pass null while no
 * analysis has completed yet for the active Session.
 */
export function renderSingleImageReport(container, report, lang) {
  if (!container) return;
  _clear(container);
  container.dataset.reportLayoutBuilt = '1';

  if (!report || report.status === 'WAITING_FOR_ANALYSIS') {
    container.appendChild(_el('p', { text: t('report.waitingForAnalysis', null, lang), style: { fontSize: '12.5px', color: 'var(--text-faint)', padding: '12px' } }));
    return;
  }

  _renderSummary(container, report, lang);
  if (report.status === 'FAILED') return;
  _renderCreativeCharacteristics(container, report, lang);

  container.appendChild(_sectionBlock('report.section.exposure', report.exposure, lang, {
    extraRows: [
      ['report.field.meanLuminance', report.exposure.meanLuminance],
      ['report.field.clippedHighlightsPercent', report.exposure.clippedHighlightsPercent],
      ['report.field.crushedShadowsPercent', report.exposure.crushedShadowsPercent],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.dynamicRange', report.dynamicRange, lang, {
    extraRows: [
      ['report.field.drStops', report.dynamicRange.score],
      ['report.field.shadowHeadroom', report.dynamicRange.shadowHeadroom],
      ['report.field.highlightHeadroom', report.dynamicRange.highlightHeadroom],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.whiteBalance', report.whiteBalance, lang, {
    extraRows: [
      ['report.field.temperatureDirection', report.whiteBalance.temperatureDirection ? t(`report.direction.${report.whiteBalance.temperatureDirection}`, null, lang) : null],
      ['report.field.tintDirection', report.whiteBalance.tintDirection ? t(`report.direction.${report.whiteBalance.tintDirection}`, null, lang) : null],
      ['report.field.neutralConfidence', _confidenceLabel(report.whiteBalance.neutralConfidence, lang)],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.tone', report.tone, lang, {
    extraRows: [
      ['report.field.blackPoint', report.tone.blackPoint],
      ['report.field.whitePoint', report.tone.whitePoint],
      ['report.field.contrastProfile', report.tone.contrastProfile ? t(`report.contrastProfile.${report.tone.contrastProfile}`, null, lang) : null],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.color', report.color, lang, {
    extraRows: [
      ['report.field.saturationProfile', report.color.saturationProfile ? t(`report.saturationProfile.${report.color.saturationProfile}`, null, lang) : null],
      ['report.field.harmonyScheme', report.color.harmony?.scheme ?? null],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.skin', report.skin, lang, {
    extraRows: [
      ['report.field.skinPercentage', report.skin.detected ? report.skin.percentage : null],
    ],
  }));
  container.appendChild(_sectionBlock('report.section.scene', report.scene, lang, {
    extraRows: [
      ['report.field.primaryType', report.scene.primaryType],
    ],
  }));

  _renderTechnicalIssues(container, report, lang);
  _renderAdvancedDiagnostics(container, report, lang);
}

/** Clear the report UI entirely (used on Reset / new upload). */
export function clearSingleImageReportDisplay(container, lang) {
  if (!container) return;
  _clear(container);
  delete container.dataset.reportLayoutBuilt;
  if (lang !== undefined) {
    container.appendChild(_el('p', { text: t('report.waitingForAnalysis', null, lang), style: { fontSize: '12.5px', color: 'var(--text-faint)', padding: '12px' } }));
  }
}
