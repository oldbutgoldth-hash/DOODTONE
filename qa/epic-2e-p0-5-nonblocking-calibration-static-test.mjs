import fs from 'node:fs';
const src = fs.readFileSync(new URL('../ui/reference-color-match-panel.js', import.meta.url), 'utf8');
const checks = [
  ['profile contract', src.includes("profile = 'PAIRWISE_FAST'")],
  ['calibration deferred', src.includes('Calibration Engine is intentionally deferred')],
  ['no awaited calibration call', !src.includes("label: 'Calibration Engine', task: () => analyzeCalibration")],
  ['minimal matched evaluation', src.includes("profile: 'EVALUATION_MINIMAL'")],
  ['honest deferred source', src.includes("REFERENCE_COLOR_MATCH_FAST_PATH")],
  ['calibration ledger retained', src.includes('calibrationEngine:{confidence:calibration?.confidence')],
];
let fail=0;
for (const [name, ok] of checks) { console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) fail++; }
if(fail) process.exit(1);
console.log(`P0.5 ${checks.length}/${checks.length} PASS`);
