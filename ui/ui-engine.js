/**
 * ui/ui-engine.js — LUMIXA AI
 * Pure DOM helpers — builds panels, manages sliders, switches tabs.
 * Adapted for the LUMIXA visual system: state is expressed via inline
 * style (CSS custom properties resolved with var()) instead of stylesheet
 * classes. Analysis logic is untouched from the original engine.
 */

import { HSL_CHANNELS, HSL_LABELS } from '../core/hsl-engine/index.js';

// ─── Slider fill ─────────────────────────────────────────────────────────────

export function fillSlider(el) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.setProperty('--pct', `${pct}%`);
}

export function formatSliderValue(id, v) {
  if (id === 'exp') return (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
  return (v >= 0 ? '+' : '') + v;
}

export function setSlider(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  fillSlider(el);
  const out = document.getElementById(id + 'V');
  if (out) out.textContent = formatSliderValue(id, val);
}

export function bindSliders(container) {
  container.querySelectorAll('input[type=range]').forEach((el) => {
    fillSlider(el);
    el.addEventListener('input', function () {
      fillSlider(this);
      const out = document.getElementById(this.id + 'V');
      if (out) out.textContent = formatSliderValue(this.id, +this.value);
    });
  });
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function styleTabBtn(btn, active) {
  btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
}

export function switchTab(event, panelName) {
  const group = event.currentTarget.closest('.tabs-row') || event.currentTarget.parentElement;
  group.querySelectorAll('.tab-btn').forEach((b) => styleTabBtn(b, false));
  styleTabBtn(event.currentTarget, true);

  document.querySelectorAll('[id^="p-"]')
    .forEach((p) => (p.style.display = 'none'));

  const panel = document.getElementById(`p-${panelName}`);
  if (panel) {
    panel.style.display = 'block';
    bindSliders(panel);
  }
}

// ─── Panel builders ───────────────────────────────────────────────────────────

const rowLabel = 'font-size:11px;color:var(--text-dim);width:11px;font-weight:700;font-family:var(--font-mono)';
const swatch   = 'font-family:var(--font-mono);font-size:11px;font-weight:700;min-width:38px;text-align:right;color:var(--accent);background:var(--accent-soft);padding:2px 6px;border-radius:3px';
const cardHd   = 'font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border)';
const zoneLbl  = 'font-size:10px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px;font-family:var(--font-mono)';
const rangeStyle = "flex:1;cursor:pointer;-webkit-appearance:none;height:3px;border-radius:2px;outline:none;background:linear-gradient(to right, var(--accent) 0%, var(--accent) var(--pct,50%), var(--surface-3) var(--pct,50%), var(--surface-3) 100%)";

export function renderHSLPanel(container) {
  let html = `<div style="${cardHd}">HSL Colour Mixer</div>`;

  for (const ch of HSL_CHANNELS) {
    html += `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <span style="min-width:64px;font-size:12px;font-weight:600;color:var(--text);font-family:var(--font-sans)">${HSL_LABELS[ch]}</span>
        ${['h', 's', 'l'].map((t) => `
          <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:96px">
            <label style="${rowLabel}">${t.toUpperCase()}</label>
            <input type="range" id="hsl_${t}_${ch}" min="-100" max="100" value="0" style="${rangeStyle}">
            <span class="sv" id="hsl_${t}_${ch}V" style="${swatch}">0</span>
          </div>`).join('')}
      </div>`;
  }

  container.innerHTML = html;
  bindSliders(container);
}

export function renderGradingPanel(container) {
  const zones = [
    { key: 'sh',  label: 'Shadows' },
    { key: 'mid', label: 'Midtones' },
    { key: 'hi',  label: 'Highlights' },
  ];

  let html = `<div style="${cardHd}">Colour Grading — Split Tone</div>`;

  for (const { key, label } of zones) {
    html += `
      <div style="margin-bottom:16px">
        <div style="${zoneLbl}">${label}</div>
        <div class="slider-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Hue</label>
          <input type="range" id="grd_${key}_h" min="0" max="360" value="0" style="${rangeStyle}">
          <span class="sv" id="grd_${key}_hV" style="${swatch}">0&deg;</span></div>
        <div class="slider-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Saturation</label>
          <input type="range" id="grd_${key}_s" min="0" max="100" value="0" style="${rangeStyle}">
          <span class="sv" id="grd_${key}_sV" style="${swatch}">0</span></div>
        <div class="slider-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Luminance</label>
          <input type="range" id="grd_${key}_l" min="-100" max="100" value="0" style="${rangeStyle}">
          <span class="sv" id="grd_${key}_lV" style="${swatch}">0</span></div>
      </div>`;
  }

  html += `
    <div>
      <div style="${zoneLbl}">Blending</div>
      <div class="slider-row" style="display:flex;align-items:center;gap:10px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Blend</label>
        <input type="range" id="grd_blend" min="0" max="100" value="50" style="${rangeStyle}">
        <span class="sv" id="grd_blendV" style="${swatch}">50</span></div>
    </div>`;

  container.innerHTML = html;

  container.querySelectorAll('input[type=range]').forEach((el) => {
    fillSlider(el);
    el.addEventListener('input', function () {
      fillSlider(this);
      const out = document.getElementById(this.id + 'V');
      if (out) {
        const isHue = this.id.endsWith('_h') && !this.id.startsWith('hsl');
        out.innerHTML = isHue ? `${this.value}&deg;` : formatSliderValue(this.id, +this.value);
      }
    });
  });
}

export function renderCalibrationPanel(container) {
  const channels = [
    { key: 'red',   label: 'Red' },
    { key: 'green', label: 'Green' },
    { key: 'blue',  label: 'Blue' },
  ];

  let html = `<div style="${cardHd}">Camera Calibration</div>`;

  for (const { key, label } of channels) {
    html += `
      <div style="margin-bottom:14px">
        <div style="${zoneLbl}">${label} Primary</div>
        <div class="slider-row" style="display:flex;align-items:center;gap:10px;margin-bottom:9px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Hue</label>
          <input type="range" id="cal_${key}_h" min="-100" max="100" value="0" style="${rangeStyle}">
          <span class="sv" id="cal_${key}_hV" style="${swatch}">0</span></div>
        <div class="slider-row" style="display:flex;align-items:center;gap:10px"><label style="font-size:12px;min-width:96px;color:var(--text);font-family:var(--font-sans)">Saturation</label>
          <input type="range" id="cal_${key}_s" min="-100" max="100" value="0" style="${rangeStyle}">
          <span class="sv" id="cal_${key}_sV" style="${swatch}">0</span></div>
      </div>`;
  }

  container.innerHTML = html;
  bindSliders(container);
}

export function renderAnalysisPanel(container, stats) {
  let rows = '';
  for (const [key, val] of Object.entries(stats)) {
    rows += `
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px">
        <span style="color:var(--text-dim);font-weight:500;font-family:var(--font-sans)">${key}</span>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--text)">${val}</span>
      </div>`;
  }
  container.innerHTML = `<div><div style="${cardHd}">Image Statistics</div>${rows}</div>`;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

export function setAnalysisBox(state, message) {
  const box = document.getElementById('aiBox');
  if (!box) return;
  box.style.display = 'block';

  const colors = {
    loading: 'var(--accent)',
    ok:      'var(--success)',
    error:   'var(--danger)',
  };
  const color = colors[state] ?? 'var(--accent)';

  const inner = state === 'loading'
    ? `<div style="display:flex;align-items:center;gap:10px">
         <div style="width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:lumixa-spin .7s linear infinite;flex-shrink:0"></div>
         ${message}
       </div>`
    : message;

  box.innerHTML = `<div style="padding:14px 17px;border-radius:2px;border-left:2px solid ${color};font-size:12.5px;line-height:1.65;background:var(--surface-2);color:${color};font-family:var(--font-sans)">${inner}</div>`;
}

export function flashSuccess(duration = 4000) {
  const el = document.getElementById('successMsg');
  if (!el) return;
  el.style.display = 'block';
  setTimeout(() => (el.style.display = 'none'), duration);
}
