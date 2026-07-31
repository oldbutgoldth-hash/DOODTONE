import fs from 'node:fs';
const src = fs.readFileSync(new URL('../ui/reference-color-match-panel.js', import.meta.url), 'utf8');
const checks = [
  ['proxy encoded from bounded canvas', /canvas\.toBlob\(/],
  ['proxy decoded as HTML image', /const proxyImage = new Image\(\)/],
  ['proxy decode awaited', /await proxyImage\.decode\(\)/],
  ['natural dimensions validated', /proxyImage\.naturalWidth.*proxyImage\.naturalHeight/s],
  ['canvas is not returned to naturalWidth-only cores', !/return canvas;/.test(src)],
  ['proxy decode has stable error code', /ANALYSIS_PROXY_DECODE_FAILED/],
  ['proxy dimensions have stable error code', /ANALYSIS_PROXY_DIMENSIONS_INVALID/],
];
let fail=0;
for (const [name,test] of checks) {
  const ok = typeof test === 'boolean' ? test : test.test(src);
  console.log(`${ok?'✓ [PASS]':'✗ [FAIL]'} ${name}`); if(!ok) fail++;
}
console.log(`\n${checks.length-fail}/${checks.length} PASS, ${fail} FAIL`);
if(fail) process.exit(1);
