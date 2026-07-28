/**
 * EPIC 2E-O8 — Perceptual colour science for the candidate-only Color Match path.
 * Pure functions: sRGB ↔ linear RGB, XYZ/Lab, Oklab and CIEDE2000.
 * Production/Legacy mapping does not import this module.
 */
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const deg2rad = d => d * Math.PI / 180;
const rad2deg = r => r * 180 / Math.PI;

export function srgbChannelToLinear(value) {
  const c = clamp(value, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function linearChannelToSrgb(value) {
  const c = clamp(value, 0, 1);
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1 / 2.4)) - 0.055);
}
export function rgbToXyz({ r, g, b }) {
  const R = srgbChannelToLinear(r), G = srgbChannelToLinear(g), B = srgbChannelToLinear(b);
  return {
    x: (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) * 100,
    y: (0.2126729 * R + 0.7151522 * G + 0.0721750 * B) * 100,
    z: (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) * 100,
  };
}
export function xyzToLab({ x, y, z }) {
  const ref = { x: 95.047, y: 100, z: 108.883 };
  const f = value => {
    const n = value;
    return n > 216 / 24389 ? Math.cbrt(n) : (24389 / 27 * n + 16) / 116;
  };
  const fx = f(x / ref.x), fy = f(y / ref.y), fz = f(z / ref.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
export function rgbToLab(rgb) { return xyzToLab(rgbToXyz(rgb)); }

export function rgbToOklab({ r, g, b }) {
  const R = srgbChannelToLinear(r), G = srgbChannelToLinear(g), B = srgbChannelToLinear(b);
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}
export function oklabDistance(a, b) {
  return Math.hypot((a?.L || 0) - (b?.L || 0), (a?.a || 0) - (b?.a || 0), (a?.b || 0) - (b?.b || 0));
}
export function circularHueDelta(fromHue, toHue) {
  const from = ((Number(fromHue) % 360) + 360) % 360;
  const to = ((Number(toHue) % 360) + 360) % 360;
  return ((to - from + 540) % 360) - 180;
}
export function gaussianHueWeight(hue, center, sigma = 25) {
  const d = circularHueDelta(center, hue);
  return Math.exp(-0.5 * (d / Math.max(1, sigma)) ** 2);
}

/** CIEDE2000 following Sharma et al. (2005). */
export function deltaE2000(lab1, lab2) {
  const L1 = Number(lab1?.L) || 0, a1 = Number(lab1?.a) || 0, b1 = Number(lab1?.b) || 0;
  const L2 = Number(lab2?.L) || 0, a2 = Number(lab2?.a) || 0, b2 = Number(lab2?.b) || 0;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt((Cbar ** 7) / (Cbar ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (a, b) => { if (a === 0 && b === 0) return 0; const h = rad2deg(Math.atan2(b, a)); return h < 0 ? h + 360 : h; };
  const hp1 = hp(ap1, b1), hp2 = hp(ap2, b2);
  const dLp = L2 - L1, dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    const raw = hp2 - hp1;
    dhp = Math.abs(raw) <= 180 ? raw : raw > 180 ? raw - 360 : raw + 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(deg2rad(dhp / 2));
  const Lbar = (L1 + L2) / 2, Cpbar = (Cp1 + Cp2) / 2;
  let hpbar = hp1 + hp2;
  if (Cp1 * Cp2 === 0) hpbar = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hpbar = (hp1 + hp2) / 2;
  else hpbar = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos(deg2rad(hpbar - 30)) + 0.24 * Math.cos(deg2rad(2 * hpbar))
    + 0.32 * Math.cos(deg2rad(3 * hpbar + 6)) - 0.20 * Math.cos(deg2rad(4 * hpbar - 63));
  const dTheta = 30 * Math.exp(-(((hpbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt((Cpbar ** 7) / (Cpbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * ((Lbar - 50) ** 2)) / Math.sqrt(20 + ((Lbar - 50) ** 2));
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(deg2rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
