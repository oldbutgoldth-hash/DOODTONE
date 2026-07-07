/**
 * ui/tone-curve-editor.js
 *
 * Interactive Tone Curve Editor — rendered onto a <canvas> element.
 *
 * Features
 * ────────
 *   • 4 channels: Master (RGB) · Red · Green · Blue
 *   • Drag existing control points
 *   • Click empty area → add point
 *   • Double-click point → remove it
 *   • Luminance histogram as background overlay
 *   • Live LUT preview line
 *   • Catmull-Rom spline rendering
 *   • Exports XMP-ready point strings
 *   • onChange callback fires on every edit
 *
 * Usage
 * ─────
 *   const editor = new ToneCurveEditor(canvas, { onChange, histStats });
 *   editor.setChannel('red');
 *   editor.loadPreset(scenePreset('Portrait'));
 *   editor.getCurveSet();   // → { master, red, green, blue }
 */

import {
  evaluateCurve, buildLUT, insertPoint, removeNearestPoint,
  movePoint, defaultCurveSet, scenePreset, serializeCurvePoints,
} from '../core/curve-engine/index.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const PAD      = 28;    // inner canvas padding (px, CSS)
const PT_R     = 6;     // control point radius
const HIT_R    = 12;    // hit-test radius
const GRID_DIV = 4;     // grid divisions

const CHANNEL_CFG = {
  master: { label: 'RGB',   color: '#f07320',               fillA: 'rgba(240,115,32,0.12)' },
  red:    { label: 'Red',   color: 'rgba(220,60,60,1)',      fillA: 'rgba(220,60,60,0.10)'  },
  green:  { label: 'Green', color: 'rgba(50,180,70,1)',      fillA: 'rgba(50,180,70,0.10)'  },
  blue:   { label: 'Blue',  color: 'rgba(60,110,220,1)',     fillA: 'rgba(60,110,220,0.10)' },
};

// ─── Editor class ─────────────────────────────────────────────────────────────

export class ToneCurveEditor {
  /**
   * @param {HTMLCanvasElement}  canvas
   * @param {{
   *   onChange?: (curveSet: object) => void,
   *   histStats?: object,
   *   dark?: boolean,
   * }} opts
   */
  constructor(canvas, opts = {}) {
    this._canvas   = canvas;
    this._onChange = opts.onChange ?? (() => {});
    this._hist     = opts.histStats ?? null;
    this._dark     = opts.dark ?? document.documentElement.classList.contains('dark');
    this._channel  = 'master';
    this._curves   = defaultCurveSet();
    this._drag     = null;    // { index: number }
    this._hover    = null;    // index of hovered point

    this._dpr  = Math.min(window.devicePixelRatio || 1, 2);
    this._size = 0;           // CSS px side length (computed in resize)

    this._bindEvents();
    this._resize();
    this.render();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setChannel(ch) {
    if (!CHANNEL_CFG[ch]) return;
    this._channel = ch;
    this._drag    = null;
    this._hover   = null;
    this.render();
  }

  setDark(dark) { this._dark = dark; this.render(); }

  setHistStats(stats) { this._hist = stats; this.render(); }

  loadPreset(curveSet) {
    this._curves = {
      master: [...(curveSet.master ?? defaultCurveSet().master)],
      red:    [...(curveSet.red    ?? defaultCurveSet().red   )],
      green:  [...(curveSet.green  ?? defaultCurveSet().green )],
      blue:   [...(curveSet.blue   ?? defaultCurveSet().blue  )],
    };
    this.render();
    this._onChange(this.getCurveSet());
  }

  resetChannel() {
    this._curves[this._channel] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    this.render();
    this._onChange(this.getCurveSet());
  }

  resetAll() {
    this._curves = defaultCurveSet();
    this.render();
    this._onChange(this.getCurveSet());
  }

  getCurveSet() {
    return {
      master: [...this._curves.master],
      red:    [...this._curves.red   ],
      green:  [...this._curves.green ],
      blue:   [...this._curves.blue  ],
    };
  }

  /** Returns XMP-ready strings for all channels */
  getXMPStrings() {
    return {
      master: serializeCurvePoints(this._curves.master),
      red:    serializeCurvePoints(this._curves.red   ),
      green:  serializeCurvePoints(this._curves.green ),
      blue:   serializeCurvePoints(this._curves.blue  ),
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  render() {
    const canvas = this._canvas;
    const dpr    = this._dpr;
    const size   = this._size;

    canvas.width  = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const inner = size - PAD * 2;  // drawable square side

    this._drawBackground(ctx, size, inner);
    this._drawHistOverlay(ctx, inner);
    this._drawGrid(ctx, inner);
    this._drawDiagonal(ctx, inner);
    this._drawAllChannelGhosts(ctx, inner);
    this._drawActiveCurve(ctx, inner);
    this._drawControlPoints(ctx, inner);
    this._drawLabels(ctx, size, inner);
  }

  _drawBackground(ctx, size) {
    const dark = this._dark;
    // Background
    ctx.fillStyle = dark ? '#1e1710' : '#fdfaf5';
    ctx.beginPath();
    ctx.roundRect?.(0, 0, size, size, 12) || ctx.rect(0, 0, size, size);
    ctx.fill();

    // Border
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  _drawHistOverlay(ctx, inner) {
    const hist = this._hist?.histL;
    if (!hist) return;
    const max = Math.max(...hist);
    if (!max) return;

    ctx.save();
    ctx.translate(PAD, PAD);
    ctx.fillStyle = this._dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
    ctx.beginPath();
    ctx.moveTo(0, inner);
    for (let i = 0; i < 256; i++) {
      const hx = (i / 255) * inner;
      const hy = inner - (hist[i] / max) * inner * 0.92;
      ctx.lineTo(hx, hy);
    }
    ctx.lineTo(inner, inner);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawGrid(ctx, inner) {
    ctx.save();
    ctx.translate(PAD, PAD);
    ctx.strokeStyle = this._dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)';
    ctx.lineWidth   = 0.5;
    for (let i = 1; i < GRID_DIV; i++) {
      const v = (inner / GRID_DIV) * i;
      ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, inner); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(inner, v); ctx.stroke();
    }
    // Border
    ctx.strokeStyle = this._dark ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.15)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0, 0, inner, inner);
    ctx.restore();
  }

  _drawDiagonal(ctx, inner) {
    ctx.save();
    ctx.translate(PAD, PAD);
    ctx.strokeStyle = this._dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)';
    ctx.lineWidth   = 0.75;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, inner); ctx.lineTo(inner, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawAllChannelGhosts(ctx, inner) {
    // Draw non-active RGB channels faintly behind the active one
    for (const ch of ['red', 'green', 'blue', 'master']) {
      if (ch === this._channel) continue;
      const cfg = CHANNEL_CFG[ch];
      const pts = this._curves[ch];
      ctx.save();
      ctx.translate(PAD, PAD);
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth   = 1;
      this._traceCurve(ctx, pts, inner);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  _drawActiveCurve(ctx, inner) {
    const ch  = this._channel;
    const cfg = CHANNEL_CFG[ch];
    const pts = this._curves[ch];

    ctx.save();
    ctx.translate(PAD, PAD);

    // Fill under curve
    ctx.beginPath();
    this._traceCurve(ctx, pts, inner);
    ctx.lineTo(inner, inner);
    ctx.lineTo(0, inner);
    ctx.closePath();
    ctx.fillStyle = cfg.fillA;
    ctx.fill();

    // Curve line
    ctx.beginPath();
    this._traceCurve(ctx, pts, inner);
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    ctx.restore();
  }

  _traceCurve(ctx, pts, inner) {
    ctx.moveTo(0, inner - (evaluateCurve(pts, 0) / 255) * inner);
    for (let x = 1; x <= 255; x++) {
      const cx = (x / 255) * inner;
      const cy = inner - (evaluateCurve(pts, x) / 255) * inner;
      ctx.lineTo(cx, cy);
    }
  }

  _drawControlPoints(ctx, inner) {
    const ch   = this._channel;
    const cfg  = CHANNEL_CFG[ch];
    const pts  = this._curves[ch];

    ctx.save();
    ctx.translate(PAD, PAD);

    pts.forEach((pt, i) => {
      const cx = (pt.x / 255) * inner;
      const cy = inner - (pt.y / 255) * inner;
      const isHover  = this._hover === i;
      const isDragging = this._drag?.index === i;

      // Shadow glow
      if (isHover || isDragging) {
        ctx.shadowColor   = cfg.color;
        ctx.shadowBlur    = 10;
      }

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, isDragging ? PT_R + 2 : PT_R, 0, Math.PI * 2);
      ctx.fillStyle   = cfg.color;
      ctx.fill();

      // Inner white dot
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, PT_R - 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Input/output label on hover
      if (isHover || isDragging) {
        const label = `${Math.round(pt.x)} → ${Math.round(pt.y)}`;
        const lx    = cx + (cx > inner / 2 ? -(ctx.measureText(label).width + 8) : 8);
        const ly    = cy + (cy < PAD ? 16 : -8);
        ctx.fillStyle = this._dark ? 'rgba(30,20,10,.85)' : 'rgba(255,255,255,.9)';
        ctx.strokeStyle = cfg.color; ctx.lineWidth = 1;
        const tw = ctx.measureText(label).width;
        ctx.beginPath(); ctx.roundRect?.(lx - 4, ly - 12, tw + 8, 16, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = this._dark ? '#f0e6d8' : '#1c160e';
        ctx.font      = '600 9px "JetBrains Mono",monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, lx, ly + 2);
      }
    });

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawLabels(ctx, size, inner) {
    const dark = this._dark;
    ctx.save();
    ctx.fillStyle    = dark ? '#7a6248' : '#9e8468';
    ctx.font         = '500 9px Inter, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    // X axis labels
    ctx.fillText('0',   PAD,           size - PAD + 4);
    ctx.fillText('128', PAD + inner/2, size - PAD + 4);
    ctx.fillText('255', PAD + inner,   size - PAD + 4);

    // Y axis labels
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('0',   PAD - 4, PAD + inner);
    ctx.fillText('128', PAD - 4, PAD + inner / 2);
    ctx.fillText('255', PAD - 4, PAD);

    // Channel label top-left
    const ch  = this._channel;
    const cfg = CHANNEL_CFG[ch];
    ctx.fillStyle = cfg.color;
    ctx.font      = '700 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(cfg.label + ' CURVE', PAD + 4, PAD + 4);

    // Point count top-right
    const pts = this._curves[ch];
    ctx.fillStyle = dark ? '#7a6248' : '#9e8468';
    ctx.font      = '500 9px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${pts.length} pts`, PAD + inner - 2, PAD + 4);

    ctx.restore();
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this._canvas;
    c.addEventListener('mousedown',  e => this._onDown(e));
    c.addEventListener('mousemove',  e => this._onMove(e));
    c.addEventListener('mouseup',    e => this._onUp(e));
    c.addEventListener('mouseleave', e => this._onUp(e));
    c.addEventListener('dblclick',   e => this._onDbl(e));
    c.addEventListener('touchstart', e => this._onDown(this._touch(e)), { passive: false });
    c.addEventListener('touchmove',  e => this._onMove(this._touch(e)), { passive: false });
    c.addEventListener('touchend',   e => this._onUp(e));
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const c    = this._canvas;
    const side = c.parentElement?.offsetWidth ?? 300;
    this._size = Math.max(200, Math.min(side, 480));
    c.style.width  = this._size + 'px';
    c.style.height = this._size + 'px';
    this.render();
  }

  _touch(e) {
    e.preventDefault();
    const t = e.touches[0] ?? e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} };
  }

  _canvasXY(e) {
    const r  = this._canvas.getBoundingClientRect();
    const sx = this._size / r.width;
    return {
      cx: (e.clientX - r.left) * sx - PAD,
      cy: (e.clientY - r.top)  * sx - PAD,
    };
  }

  _toDataXY(cx, cy) {
    const inner = this._size - PAD * 2;
    return {
      x: Math.round((cx / inner) * 255),
      y: Math.round((1 - cy / inner) * 255),
    };
  }

  _nearestPoint(cx, cy) {
    const inner = this._size - PAD * 2;
    const pts   = this._curves[this._channel];
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const px = (pts[i].x / 255) * inner;
      const py = inner - (pts[i].y / 255) * inner;
      const d  = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestD < HIT_R ? bestI : -1;
  }

  _onDown(e) {
    const { cx, cy } = this._canvasXY(e);
    const hitIdx     = this._nearestPoint(cx, cy);

    if (hitIdx >= 0) {
      this._drag = { index: hitIdx };
    } else {
      // Add new point
      const { x, y } = this._toDataXY(cx, cy);
      if (x >= 0 && x <= 255 && y >= 0 && y <= 255) {
        const newPts = insertPoint(this._curves[this._channel], { x, y });
        this._curves[this._channel] = newPts;
        this._drag = { index: newPts.findIndex(p => p.x === Math.max(0, Math.min(255, x))) };
        this._onChange(this.getCurveSet());
      }
    }
    this.render();
  }

  _onMove(e) {
    const { cx, cy } = this._canvasXY(e);

    if (this._drag !== null) {
      const { x, y }   = this._toDataXY(cx, cy);
      this._curves[this._channel] = movePoint(
        this._curves[this._channel], this._drag.index, x, y
      );
      this._onChange(this.getCurveSet());
      this.render();
    } else {
      const hitIdx = this._nearestPoint(cx, cy);
      if (hitIdx !== this._hover) {
        this._hover = hitIdx;
        this._canvas.style.cursor = hitIdx >= 0 ? 'grab' : 'crosshair';
        this.render();
      }
    }
  }

  _onUp() {
    if (this._drag !== null) {
      this._drag = null;
      this.render();
    }
  }

  _onDbl(e) {
    const { cx, cy } = this._canvasXY(e);
    const { x, y }   = this._toDataXY(cx, cy);
    const pts         = this._curves[this._channel];
    this._curves[this._channel] = removeNearestPoint(pts, x, y);
    this._drag  = null;
    this._hover = null;
    this.render();
    this._onChange(this.getCurveSet());
  }
}
