/**
 * EPIC 2E-P1B — Report Lineage
 *
 * Records, for each major report field/section, which evidence keys
 * and Core source modules contributed to it, whether a legacy-state
 * fallback was used, and the confidence inputs that fed the
 * aggregator. Lineage is for debugging/QA (rendered only under
 * "Advanced Diagnostics" in the UI) and is never used to alter
 * rendering decisions elsewhere. Never includes filenames or image
 * binary data — see buildLineageEntry()'s callers, none of which pass
 * either.
 */

/**
 * @param {object} opts
 * @param {string[]} opts.evidenceKeys   - session.evidence keys read
 * @param {string[]} opts.sourceModules  - Core module names (from the
 *                                          analysis profile's sourceEngine,
 *                                          or a short label)
 * @param {boolean}  [opts.fallbackUsed] - true if a legacy-state fallback
 *                                          was used instead of session.evidence
 * @param {Array}    [opts.confidenceInputs] - raw confidence values that fed
 *                                          combineConservative()/levelFromScore()
 * @param {string}   [opts.notes]
 */
export function buildLineageEntry({ evidenceKeys = [], sourceModules = [], fallbackUsed = false, confidenceInputs = [], notes = null } = {}) {
  return {
    evidenceKeys: [...evidenceKeys],
    sourceModules: [...sourceModules],
    fallbackUsed: !!fallbackUsed,
    // `undefined` entries (e.g. `stats?.confidence` when stats is
    // null) are normalized to `null` -- lineage must stay
    // JSON-serializable (undefined is not) while still recording
    // "this input genuinely had no confidence value" rather than
    // silently dropping the slot.
    confidenceInputs: confidenceInputs.map((v) => (v === undefined ? null : v)),
    notes: notes ?? null,
  };
}

/** Assemble the full report.lineage map: { [fieldPath]: lineageEntry }. Never mutates inputs. */
export function assembleLineage(entries) {
  const lineage = {};
  for (const [fieldPath, entry] of Object.entries(entries || {})) {
    if (!fieldPath || !entry) continue;
    lineage[fieldPath] = buildLineageEntry(entry);
  }
  return lineage;
}
