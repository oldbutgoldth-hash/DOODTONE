/**
 * core/processing-log/index.js
 *
 * Processing Log Engine
 *
 * Records every step of the analysis pipeline with timing, inputs,
 * outputs, and decision rationale. Lives as a singleton per analysis
 * run — reset when a new image is loaded.
 *
 * ─── Structure ────────────────────────────────────────────────────────────────
 *
 *  ProcessingLog
 *  ├── session         { id, startedAt, imageInfo }
 *  ├── stages[]        ordered list of StageRecord
 *  │   ├── stage       name of pipeline stage
 *  │   ├── startMs     performance.now() at start
 *  │   ├── durationMs  elapsed when end() called
 *  │   ├── status      'running' | 'ok' | 'error' | 'skipped'
 *  │   ├── inputs      key-value summary of what was fed in
 *  │   ├── outputs     key-value summary of what was produced
 *  │   ├── decisions[] reasoning entries (why this value was chosen)
 *  │   └── warnings[]  non-fatal issues detected
 *  └── finalPreset     snapshot of the preset that was applied to sliders
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *  import { processingLog } from '../core/processing-log/index.js';
 *
 *  processingLog.reset(imageInfo);
 *
 *  const s = processingLog.startStage('WhiteBalance', { skinPct, category });
 *  // ... run engine ...
 *  s.output({ temp, tint, confidence });
 *  s.decide('tint', tint, 'Green BG detected → attenuation applied');
 *  s.end('ok');
 *
 *  processingLog.setFinalPreset(finalPreset);
 *  const snapshot = processingLog.snapshot();  // plain object, safe to JSON.stringify
 */

// ─── Singleton ─────────────────────────────────────────────────────────────────

class ProcessingLog {
  constructor() {
    this._session    = null;
    this._stages     = [];
    this._finalPreset= null;
    this._active     = null;   // currently running stage handle
  }

  // ─── Session management ─────────────────────────────────────────────────────

  /**
   * Reset for a new image. Must be called before each analysis run.
   * @param {{ width:number, height:number, fileName?:string, sizeKB?:number }} imageInfo
   */
  reset(imageInfo = {}) {
    this._session = {
      id:         _uid(),
      startedAt:  new Date().toISOString(),
      startMs:    _now(),
      image: {
        width:    imageInfo.width    ?? 0,
        height:   imageInfo.height   ?? 0,
        fileName: imageInfo.fileName ?? '(unknown)',
        sizeKB:   imageInfo.sizeKB   ?? null,
        aspectRatio: imageInfo.width && imageInfo.height
          ? +( imageInfo.width / imageInfo.height).toFixed(3)
          : null,
      },
    };
    this._stages      = [];
    this._finalPreset = null;
    this._active      = null;
  }

  // ─── Stage lifecycle ─────────────────────────────────────────────────────────

  /**
   * Begin a new pipeline stage.
   * Returns a StageHandle with .output(), .decide(), .warn(), .end() methods.
   *
   * @param {string} name   e.g. 'SkinClassifier', 'WhiteBalance', 'DecisionEngine'
   * @param {object} inputs key-value summary of inputs (scalars / short strings only)
   * @returns {StageHandle}
   */
  startStage(name, inputs = {}) {
    if (this._active && this._active._status === 'running') {
      // Auto-close previous unclosed stage
      this._active._close('ok');
    }
    const record = {
      stage:       name,
      startMs:     _now(),
      durationMs:  null,
      status:      'running',
      inputs:      _sanitise(inputs),
      outputs:     {},
      decisions:   [],
      warnings:    [],
    };
    this._stages.push(record);

    const handle = new StageHandle(record, () => { this._active = null; });
    this._active = handle;
    return handle;
  }

  /**
   * Mark a stage as skipped (engine returned null / failed gracefully).
   */
  skipStage(name, reason = '') {
    this._stages.push({
      stage: name, startMs: _now(), durationMs: 0, status: 'skipped',
      inputs: {}, outputs: {}, decisions: [], warnings: [reason].filter(Boolean),
    });
  }

  // ─── Final preset snapshot ────────────────────────────────────────────────

  /**
   * Store the finalPreset object (after applyPresetToSliders).
   * Stores only scalar slider values — no large typed arrays or internal structures.
   * @param {object} preset
   */
  setFinalPreset(preset) {
    if (!preset) return;
    this._finalPreset = {
      name:     preset.name     ?? '',
      category: preset.category ?? '',
      mode:     preset._decision?.mode ?? 'single-image-auto',
      // Basic panel
      exp:  preset.exp,  con:  preset.con,  hi:   preset.hi,
      sh:   preset.sh,   wh:   preset.wh,   bl:   preset.bl,
      // WB + presence
      temp: preset.temp, tint: preset.tint,
      vib:  preset.vib,  sat:  preset.sat,
      // Detail
      clarity: preset.clarity, dehaze:  preset.dehaze,
      texture: preset.texture, sharp:   preset.sharp, noise: preset.noise,
      // HSL summary (just the delta values)
      hsl:   preset.hsl   ?? {},
      grade: preset.grade ?? {},
      cal:   preset.cal   ?? {},
      // Decision trace (already structured in finalPreset)
      _decision: preset._decision ?? null,
      // Phase 6: Style Benchmark Lite result
      _benchmark: preset._benchmark ?? null,
      // Phase 6.1: Explainable AI Decision Report
      _report: preset._report ?? null,
    };
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Get the complete log as a plain serialisable object.
   */
  snapshot() {
    if (!this._session) return null;
    const now = _now();
    return {
      session: {
        ...this._session,
        totalDurationMs: +(now - this._session.startMs).toFixed(1),
      },
      stages:      this._stages.map(s => ({ ...s })),
      finalPreset: this._finalPreset,
      summary:     this._summary(),
    };
  }

  /**
   * Get just the latest stage by name (for quick inline access).
   */
  getStage(name) {
    return [...this._stages].reverse().find(s => s.stage === name) ?? null;
  }

  /**
   * True if the log has been initialised for this run.
   */
  get isActive() { return !!this._session; }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _summary() {
    const ok      = this._stages.filter(s => s.status === 'ok').length;
    const errors  = this._stages.filter(s => s.status === 'error').length;
    const skipped = this._stages.filter(s => s.status === 'skipped').length;
    const totalMs = this._stages.reduce((s, r) => s + (r.durationMs ?? 0), 0);
    const warns   = this._stages.flatMap(s => s.warnings);
    return { stagesOk: ok, stagesError: errors, stagesSkipped: skipped,
             totalEngineMs: +totalMs.toFixed(1), warnings: warns };
  }
}

// ─── StageHandle ──────────────────────────────────────────────────────────────

class StageHandle {
  constructor(record, onClose) {
    this._r      = record;
    this._onClose= onClose;
    this._status = 'running';
  }

  /**
   * Record one or more output values.
   * Can be called multiple times; values merge.
   * @param {object} kv key-value pairs (scalars / short strings)
   */
  output(kv = {}) {
    Object.assign(this._r.outputs, _sanitise(kv));
    return this;
  }

  /**
   * Record a decision entry: why a specific output value was chosen.
   * @param {string} param   slider / parameter name  e.g. 'tint'
   * @param {*}      value   the value that was chosen
   * @param {string} reason  human-readable rationale
   */
  decide(param, value, reason) {
    this._r.decisions.push({ param, value: _scalar(value), reason: String(reason) });
    return this;
  }

  /**
   * Record a non-fatal warning.
   */
  warn(msg) {
    this._r.warnings.push(String(msg));
    return this;
  }

  /**
   * Close the stage.
   * @param {'ok'|'error'} status
   * @param {string}       [errorMsg]
   */
  end(status = 'ok', errorMsg = '') {
    this._close(status, errorMsg);
    return this;
  }

  _close(status, msg = '') {
    if (this._status !== 'running') return;
    this._r.status     = status === 'error' ? 'error' : 'ok';
    this._r.durationMs = +(_now() - this._r.startMs).toFixed(2);
    if (msg) this._r.warnings.push(msg);
    this._status = this._r.status;
    this._onClose();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function _uid() {
  return `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
}

/** Keep only JSON-safe scalar/string values; drop arrays, typed arrays, functions */
function _sanitise(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    out[k] = _scalar(v);
  }
  return out;
}

function _scalar(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number')  return isFinite(v) ? +v.toFixed(4) : null;
  if (typeof v === 'string')  return v.slice(0, 200);
  if (Array.isArray(v) && v.length <= 8 && v.every(x => typeof x !== 'object'))
    return v.map(_scalar);
  if (typeof v === 'object')  return '[object]';
  return null;
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const processingLog = new ProcessingLog();
