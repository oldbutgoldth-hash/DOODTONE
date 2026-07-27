/** EPIC 2E-L -- safe Candidate Pilot report export (never image/XMP data). */
import { computeCandidatePilotReport, isCandidatePilotReportProductionSafe } from './candidate-pilot.js';

const FORBIDDEN_KEYS = /(?:base64|dataurl|objecturl|filepath|filename|originalimage|pixelbuffer|xmp|preset)/i;

function assertSafe(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafe(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new Error(`candidate-pilot export refused forbidden field at ${path}.${key}`);
    assertSafe(child, `${path}.${key}`);
  }
}

export function buildCandidatePilotExport(session, records, { generatedAt } = {}) {
  const report = computeCandidatePilotReport(records, undefined, {
    sourceSessionId: session?.sessionId ?? null,
    generatedAt,
  });
  if (!isCandidatePilotReportProductionSafe(report)) {
    throw new Error('candidate-pilot export refused an unsafe report');
  }
  const payload = {
    exportType: 'LUMIXA_CONTROLLED_V2_CANDIDATE_PILOT_REPORT',
    exportSchemaVersion: 1,
    report,
  };
  assertSafe(payload);
  return payload;
}
