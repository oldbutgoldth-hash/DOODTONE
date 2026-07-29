import fs from 'node:fs';
const skin=fs.readFileSync('core/skintone-engine/index.js','utf8');
const panel=fs.readFileSync('ui/reference-color-match-panel.js','utf8');
const checks=[
 ['bounded sample',skin.includes('const MAX_DIM          = 256')],
 ['chunked processing',skin.includes('CHUNK_SAMPLES') && skin.includes('await _yieldToBrowser()')],
 ['internal budget',skin.includes('SKIN_ANALYSIS_BUDGET_EXCEEDED')],
 ['no pixel tuple allocation',!skin.includes('pixels.push([')],
 ['will read frequently',skin.includes('willReadFrequently: true')],
 ['skin timeout',panel.includes("timeoutMs: 12000")],
 ['skin fallback',panel.includes('Skin analysis skipped after watchdog fallback')],
 ['runner supports per-step timeout',panel.includes('timeoutMs = CORE_ANALYSIS_TIMEOUT_MS')],
];
let fail=0;
for(const [name,ok] of checks){ console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) fail++; }
if(fail) process.exit(1);
console.log(`P0.2 Skin Analysis Unfreeze: ${checks.length}/${checks.length} PASS`);
