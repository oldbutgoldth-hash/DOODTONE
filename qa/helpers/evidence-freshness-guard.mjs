/**
 * Cross-platform evidence freshness guard shared by Local Gate and hostile QA.
 * It verifies that a result object carries a sourceHash matching the current
 * manifest-derived hash. This avoids recursively spawning the entire Local
 * Gate from a static suite, which can time out or interfere with Browser QA on
 * Windows.
 */
import { computeCurrentSourceHash } from '../phase-c-suite-source-manifest.mjs';

export async function verifyManifestEvidenceFreshness({
  manifestKey,
  resultObj,
  projectRoot,
  computeHash = computeCurrentSourceHash,
}) {
  const reasons = [];
  if (!manifestKey) return { ok: true, reasons, currentHash: null, resultHash: resultObj?.sourceHash ?? null };
  if (!resultObj || typeof resultObj !== 'object') {
    return { ok: false, reasons: ['result JSON missing or unreadable'], currentHash: null, resultHash: null };
  }
  if (typeof resultObj.sourceHash !== 'string' || resultObj.sourceHash.length === 0) {
    return { ok: false, reasons: ['sourceHash missing from result — cannot prove freshness'], currentHash: null, resultHash: null };
  }
  try {
    const currentHash = await computeHash(manifestKey, projectRoot);
    if (currentHash !== resultObj.sourceHash) {
      reasons.push('STALE result: sourceHash does not match current source files — rerun this suite');
    }
    return { ok: reasons.length === 0, reasons, currentHash, resultHash: resultObj.sourceHash };
  } catch (error) {
    return {
      ok: false,
      reasons: [`could not verify freshness via suite-source-manifest: ${error?.message ?? String(error)}`],
      currentHash: null,
      resultHash: resultObj.sourceHash,
    };
  }
}
