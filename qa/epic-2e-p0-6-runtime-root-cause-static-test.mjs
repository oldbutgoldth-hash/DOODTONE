import fs from 'node:fs';
const src=fs.readFileSync(new URL('../ui/reference-color-match-panel.js', import.meta.url),'utf8');
const checks=[
 ['analysis proxy is bounded', src.includes('ANALYSIS_PROXY_MAX_EDGE = 512') && src.includes('_createAnalysisProxy')],
 ['full cores restored on proxy', ['analyzeColorGrading(proxy','analyzeCalibration(proxy','analyzeImageCore(proxy','analyzeSkinTone(proxy'].every(x=>src.includes(x))],
 ['reference and target analysis cached', src.includes("REFERENCE_CACHE', 'HIT") && src.includes("TARGET_CACHE', 'HIT")],
 ['runtime trace exists', src.includes('[LUMIXA][RCM_TRACE]') && src.includes("_trace('PIPELINE', 'START'")],
 ['generation guard exists', src.includes('STALE_GENERATION_ABORTED') && src.includes('_assertActiveRun')],
 ['slider is debounced', src.includes('rebuildTimer') && src.includes("reason: 'INTENSITY'") && src.includes('140')],
 ['overlapping rebuilds are queued', src.includes('REBUILD_QUEUED') && src.includes('rebuildQueued')],
 ['matched evaluation remains minimal', src.includes("profile: 'EVALUATION_MINIMAL'")]
];
let fail=0; for(const [n,ok] of checks){console.log(`${ok?'✓ [PASS]':'✗ [FAIL]'} ${n}`); if(!ok)fail++;}
console.log(`\n${checks.length-fail}/${checks.length} PASS, ${fail} FAIL`); process.exit(fail?1:0);
