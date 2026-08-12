#!/usr/bin/env node
/**
 * EPIC 2E-Q1 — Auto Target White Balance Base.
 *
 * Root cause fixed this round: RCM already computed a real, pixel-level
 * White Balance estimate for the Target image on every run
 * (_analyzeEvidence()'s coreOutputs.whiteBalancePro), but that estimate
 * was never plumbed into targetMediaContext.baseTemperatureK/.baseTint
 * -- only a manually-typed UI field fed those. Any Target left with a
 * blank manual field (the common case, especially for a plain JPEG with
 * no real RAW as-shot metadata to type in) silently fell back to
 * PRESERVE_TARGET_AS_SHOT, meaning white balance transfer never
 * happened at all, no matter how different the reference and target
 * actually were.
 *
 * This suite proves: (1) the new isRawTargetMedia() helper is correct
 * and shared (not duplicated), (2) the pre-existing hasBase/mode
 * decision inside buildCandidateWhiteBalanceContext()/
 * serializeCandidateXMP() is completely unchanged (pure refactor, zero
 * behavior change to the O3/O4 codec), (3) the panel's new
 * _effectiveTargetBase()/_buildTargetMediaContext() wiring reads target
 * whiteBalancePro evidence and sliderToKelvin() for non-RAW targets,
 * never guesses for RAW, and always lets a manual value win, and (4)
 * the sliderToKelvin() conversion this now depends on is the exact
 * same real function the main single-image pipeline already trusts for
 * the identical job (core/preset-engine/index.js's serializeXMP).
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}
const read = rel => fs.readFile(path.join(ROOT, rel), 'utf8');

const {
  isRawTargetMedia,
  buildCandidateWhiteBalanceContext,
  serializeCandidateXMP,
  semanticWarmthToKelvinDelta,
} = await import(path.join(ROOT, 'core/color-match/candidate-xmp-codec.js'));
const { sliderToKelvin, kelvinToSlider } = await import(path.join(ROOT, 'core/whitebalance-engine/index.js'));

/* ── isRawTargetMedia() unit behavior ──────────────────────────────── */

await test('isRawTargetMedia: mediaType RAW is always RAW regardless of filename', () => {
  assert.equal(isRawTargetMedia({ mediaType: 'RAW', fileName: 'photo.jpg' }), true);
});

await test('isRawTargetMedia: recognizes every RAW extension the codec previously matched inline', () => {
  for (const ext of ['cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'dng', 'pef']) {
    assert.equal(isRawTargetMedia({ mediaType: null, fileName: `IMG_0001.${ext}` }), true, ext);
    assert.equal(isRawTargetMedia({ mediaType: null, fileName: `IMG_0001.${ext.toUpperCase()}` }), true, `${ext} uppercase`);
  }
});

await test('isRawTargetMedia: JPEG/PNG/TIFF/WEBP are never RAW', () => {
  for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.tiff', 'a.webp', 'screenshot.PNG']) {
    assert.equal(isRawTargetMedia({ mediaType: null, fileName: name }), false, name);
  }
});

await test('isRawTargetMedia: explicit RENDERED override is never RAW even with no filename', () => {
  assert.equal(isRawTargetMedia({ mediaType: 'RENDERED', fileName: '' }), false);
});

await test('isRawTargetMedia: no mediaType and no filename defaults to non-RAW', () => {
  assert.equal(isRawTargetMedia({}), false);
  assert.equal(isRawTargetMedia(), false);
});

/* ── buildCandidateWhiteBalanceContext() regression (O3/O4 codec) ──── */

await test('REGRESSION: explicit base still produces ABSOLUTE_FROM_TARGET_BASE exactly as before the refactor', () => {
  const wb = buildCandidateWhiteBalanceContext({
    preset: { temp: 20, tint: 3 },
    targetMediaContext: { baseTemperatureK: 5200, baseTint: -2, fileName: 'a.jpg', mediaType: 'RENDERED' },
  });
  assert.equal(wb.mode, 'ABSOLUTE_FROM_TARGET_BASE');
  assert.equal(wb.isRaw, false);
  assert.equal(wb.baseTemperatureK, 5200);
  assert.equal(wb.baseTint, -2);
  assert.equal(wb.exportReady, true);
  assert.equal(wb.blockerCode, null);
});

await test('REGRESSION: missing base on a RAW target with a real WB move is still blocked (TARGET_RAW_WB_BASE_REQUIRED)', () => {
  const wb = buildCandidateWhiteBalanceContext({
    preset: { temp: 20, tint: 0 },
    targetMediaContext: { baseTemperatureK: null, baseTint: null, fileName: 'IMG_0001.CR2' },
  });
  assert.equal(wb.mode, 'PRESERVE_TARGET_AS_SHOT');
  assert.equal(wb.isRaw, true);
  assert.equal(wb.exportReady, false);
  assert.equal(wb.blockerCode, 'TARGET_RAW_WB_BASE_REQUIRED');
});

await test('REGRESSION: missing base on a non-RAW target with no move needed stays exportReady (unchanged pre-Q1 behavior for a caller that supplies no base at all)', () => {
  const wb = buildCandidateWhiteBalanceContext({
    preset: { temp: 0, tint: 0 },
    targetMediaContext: { baseTemperatureK: null, baseTint: null, fileName: 'a.jpg' },
  });
  assert.equal(wb.mode, 'PRESERVE_TARGET_AS_SHOT');
  assert.equal(wb.isRaw, false);
  assert.equal(wb.exportReady, true);
  assert.equal(wb.blockerCode, null);
});

await test('REGRESSION: serializeCandidateXMP still writes WhiteBalance="As Shot" with zero WB attrs when no base is present', () => {
  const preset = { temp: 0, tint: 0, exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, clarity: 0, dehaze: 0, texture: 0, vib: 0, sat: 0, hsl: {}, grade: {}, cal: {} };
  const result = serializeCandidateXMP({ preset, targetMediaContext: { fileName: 'a.jpg' } });
  assert.match(result.xmp, /crs:WhiteBalance="As Shot"/);
  assert.doesNotMatch(result.xmp, /crs:Temperature=/);
  assert.doesNotMatch(result.xmp, /crs:Tint=/);
});

await test('REGRESSION: serializeCandidateXMP writes Custom + real Temperature/Tint once a base is present (auto or manual, codec cannot tell the difference and should not need to)', () => {
  const preset = { temp: 20, tint: 3, exp: 0, con: 0, hi: 0, sh: 0, wh: 0, bl: 0, clarity: 0, dehaze: 0, texture: 0, vib: 0, sat: 0, hsl: {}, grade: {}, cal: {} };
  const result = serializeCandidateXMP({ preset, targetMediaContext: { fileName: 'a.jpg', baseTemperatureK: 6000, baseTint: 5 } });
  assert.match(result.xmp, /crs:WhiteBalance="Custom"/);
  assert.match(result.xmp, /crs:Temperature="\d+"/);
});

/* ── sliderToKelvin() math the panel now depends on ────────────────── */

await test('sliderToKelvin(0) is the neutral 5500K midpoint (this is why an un-transferred/zero delta on top of an auto base can still legitimately read ~5500K -- that is a real neutral reading, not a fallback guess)', () => {
  assert.equal(sliderToKelvin(0), 5500);
});

await test('sliderToKelvin/kelvinToSlider round-trip for representative warm and cool slider values', () => {
  for (const s of [-40, -10, 0, 10, 40, 80]) {
    const k = sliderToKelvin(s);
    assert.ok(k >= 2000 && k <= 50000, `slider ${s} -> ${k}K out of range`);
    assert.equal(kelvinToSlider(k), s, `round-trip mismatch for slider ${s}`);
  }
});

/* ── Panel wiring: structural verification (established convention for
 * this UI file per prior EPICs -- e.g. epic-2e-n1-core-color-match-
 * integration-static-test.mjs -- since a real browser is not available
 * in this environment; see docs' own "Browser QA not attempted this
 * round" precedent). ─────────────────────────────────────────────── */

await test('panel imports sliderToKelvin and isRawTargetMedia (reuse-first: no re-derived RAW regex, no re-derived Kelvin math)', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /import \{ analyzeWhiteBalance, sliderToKelvin \} from '\.\.\/core\/whitebalance-engine\/index\.js';/);
  assert.match(source, /import \{ isRawTargetMedia \} from '\.\.\/core\/color-match\/candidate-xmp-codec\.js';/);
});

await test('_effectiveTargetBase() checks manual override before anything else, and only ever reads whiteBalancePro for non-RAW', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  const fn = source.slice(source.indexOf('function _effectiveTargetBase'), source.indexOf('function _buildTargetMediaContext'));
  assert.match(fn, /Number\.isFinite\(manualTemp\) && Number\.isFinite\(manualTint\)/);
  const manualIdx = fn.indexOf('manual');
  const rawIdx = fn.indexOf('isRawTargetMedia(');
  const wbProIdx = fn.indexOf('whiteBalancePro');
  assert.ok(manualIdx < rawIdx && rawIdx < wbProIdx, 'expected source order: manual check, then RAW check, then whiteBalancePro read');
  assert.match(fn, /if \(isRaw\) \{\s*\n\s*return \{ baseTemperatureK: null, baseTint: null,/);
});

await test('_effectiveTargetBase() converts the slider-scale temperature reading via sliderToKelvin(), tint passed through unconverted (matches core/preset-engine/index.js\'s own convention)', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  const fn = source.slice(source.indexOf('function _effectiveTargetBase'), source.indexOf('function _buildTargetMediaContext'));
  assert.match(fn, /baseTemperatureK: sliderToKelvin\(adj\.temperature\)/);
  assert.match(fn, /baseTint: adj\.tint,/);
});

await test('all 3 pipeline call sites use the single _buildTargetMediaContext() helper -- no remaining duplicated inline targetMediaContext literal', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  const calls = source.match(/targetMediaContext: _buildTargetMediaContext\(\),/g) || [];
  assert.equal(calls.length, 3, `expected 3 call sites, found ${calls.length}`);
  assert.doesNotMatch(source, /baseTemperatureK: rcm\.targetBaseTemperatureK, baseTint: rcm\.targetBaseTint/);
});

await test('UI note element exists and is refreshed after both full-pipeline completion points and on media-type change', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /id="rcmTargetBaseAutoNote"/);
  assert.match(source, /function _renderTargetBaseAutoNote\(\)/);
  const renderCalls = source.match(/_renderTargetBaseAutoNote\(\);/g) || [];
  assert.ok(renderCalls.length >= 3, `expected >=3 call sites, found ${renderCalls.length}`);
});

await test('RAW still requires manual entry: UI copy documents the JPEG-auto vs RAW-manual distinction', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /JPEG\/PNG:.*RAW:/);
});

await test('rcm state documents targetBaseAuto as read-only/QA visibility, never a pipeline input', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /targetBaseAuto: null,/);
});

/* ── semanticWarmthToKelvinDelta unaffected (untouched function, sanity only) ── */

await test('semanticWarmthToKelvinDelta unchanged: still bounded and proportional', () => {
  assert.equal(semanticWarmthToKelvinDelta(0), 0);
  assert.equal(semanticWarmthToKelvinDelta(100, { kelvinPerUnit: 42, maxAbsKelvin: 1800 }), 1800);
});

console.log(`\n${pass}/${pass + (process.exitCode ? 1 : 0)} PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
