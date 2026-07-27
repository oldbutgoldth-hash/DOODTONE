#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCalibrationLabDictionaryCoverage } from '../ui/calibration-lab/calibration-lab-i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let pass = 0;
function test(name, fn) { try { fn(); pass += 1; console.log(`✓ [PASS] ${name}`); } catch (e) { console.error(`✗ [FAIL] ${name}\n${e.stack || e}`); process.exitCode = 1; } }

const controller = read('ui/calibration-lab/calibration-lab-controller.js');
const renderer = read('ui/calibration-lab/calibration-lab-renderer.js');
const codes = read('core/calibration-lab/codes.js');
const pilot = read('core/calibration-lab/candidate-pilot.js');
const exporter = read('core/calibration-lab/export-candidate-pilot.js');

test('Calibration mode vocabulary includes PILOT', () => assert.match(codes, /'PILOT'/));
test('Controller exposes Candidate Pilot report and export', () => {
  assert.match(controller, /getCandidatePilotReport/);
  assert.match(controller, /exportCandidatePilotJson/);
  assert.match(controller, /candidatePilotCode/);
});
test('Renderer exposes a semantic Candidate Pilot mode and safe export control', () => {
  assert.match(renderer, /data-cal-role': 'candidate-pilot'/);
  assert.match(renderer, /data-cal-pilot-production-source/);
  assert.match(renderer, /export-candidate-pilot-report/);
  assert.match(renderer, /calibrationMode === 'PILOT'/);
});
test('Pilot core hard-locks Production values', () => {
  assert.match(pilot, /productionSource: 'legacy'/);
  assert.match(pilot, /productionWrite: false/);
  assert.match(pilot, /controlledV2Apply: false/);
  assert.match(pilot, /previewExport: false/);
  assert.doesNotMatch(pilot, /pilotStatus\s*=\s*['"]PRODUCTION_READY/);
});
test('Pilot exporter refuses image/XMP/preset-shaped keys', () => {
  assert.match(exporter, /base64\|dataurl\|objecturl\|filepath\|filename\|originalimage\|pixelbuffer\|xmp\|preset/i);
});
test('EN/TH Candidate Pilot dictionary coverage is complete', () => {
  const result = checkCalibrationLabDictionaryCoverage();
  assert.equal(result.ok, true, JSON.stringify(result.missing));
});

if (!process.exitCode) console.log(`\n${pass}/${pass} PASS, 0 FAIL`);
