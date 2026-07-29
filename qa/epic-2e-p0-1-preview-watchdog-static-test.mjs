import fs from "node:fs";
const s=fs.readFileSync(new URL("../ui/reference-color-match-panel.js", import.meta.url),"utf8");
const checks=[
["watchdog timeout",s.includes("CORE_ANALYSIS_TIMEOUT_MS = 45000")],
["staged runner",s.includes("_runCoreAnalysisStep")],
["ui paint yield",s.includes("_nextPaint")],
["stable timeout code",s.includes("CORE_TIMEOUT_")],
["reference phase",s.includes("phase: 'REFERENCE'")],
["target phase",s.includes("phase: 'TARGET'")],
["matched preview phase",s.includes("phase: 'MATCHED PREVIEW'")],
["sequential palette",s.includes("await _runCoreAnalysisStep({ phase, label: 'Colour Palette · K-Means'")]
];
let pass=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`); if(ok) pass++;}
console.log(`EPIC 2E-P0.1 static: ${pass}/${checks.length} PASS`); if(pass!==checks.length) process.exit(1);
