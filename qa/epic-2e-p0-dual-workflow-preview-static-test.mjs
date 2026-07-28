import fs from 'node:fs';
import assert from 'node:assert/strict';
const panel = fs.readFileSync(new URL('../ui/reference-color-match-panel.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const checks = [
  ['workflow namespace', panel.includes("REFERENCE_COLOR_MATCH_BETA")],
  ['preview state renderer', panel.includes('_setMatchedPreviewState')],
  ['auto reference analysis', panel.includes('กำลังเรียก Core Analysis สำหรับ Reference โดยอัตโนมัติ')],
  ['stale generation guard', panel.includes('STALE_GENERATION')],
  ['candidate unavailable error', panel.includes('MATCH_CANDIDATE_UNAVAILABLE')],
  ['render failure error', panel.includes('TARGET_RENDER_FAILED')],
  ['preview overlay surface', html.includes('rcmMatchedPreviewState')],
  ['try catch around pipeline', panel.includes("console.error('[LUMIXA][REFERENCE_MATCH_PREVIEW]'")],
];
for (const [name, ok] of checks) { assert.equal(ok, true, name); console.log(`PASS ${name}`); }
console.log(`EPIC 2E-P0 static: ${checks.length}/${checks.length} PASS`);
