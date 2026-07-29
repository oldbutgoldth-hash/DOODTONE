import fs from 'node:fs';
const src = fs.readFileSync(new URL('../ui/reference-color-match-panel.js', import.meta.url), 'utf8');
const checks = [
  ['image core deferred', src.includes("source: 'REFERENCE_COLOR_MATCH_FAST_PATH'")],
  ['image core does not block', src.includes('Image Analysis Core deferred; it does not block Target Matched Preview.')],
  ['no awaited image core in evidence', !src.includes("label: 'Image Analysis Core', task: () => analyzeImageCore(img)")],
  ['skin remains deferred', src.includes('FAST_SKIN_CLASSIFICATION_FALLBACK')],
  ['pairwise fusion remains', src.includes('buildCoreColorMatchPipeline')],
  ['preview render remains', src.includes('renderColorMatchCandidateToCanvas')],
  ['matched preview state remains', src.includes("_setMatchedPreviewState('READY')")],
  ['error surface remains', src.includes("_setMatchedPreviewState('ERROR'")],
];
let pass = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (ok) pass++; }
console.log(`EPIC 2E-P0.4 static: ${pass}/${checks.length} PASS`);
if (pass !== checks.length) process.exit(1);
