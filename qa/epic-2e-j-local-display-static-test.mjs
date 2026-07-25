#!/usr/bin/env node
/**
 * LOCAL-FIRST DISPLAY REGRESSION — protects the real QA alignment
 * contract and the LAN-capable local server used during daily work.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveContainedPath, listLanIpv4Addresses } from '../tools/local-static-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(test, condition, evidence='') {
  const result = condition === true ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence: String(evidence) });
  console.log(`${result === 'PASS' ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const app = await readFile(path.join(ROOT, 'ui', 'app.js'), 'utf8');
const server = await readFile(path.join(ROOT, 'tools', 'local-static-server.mjs'), 'utf8');

check('package.json declares ES-module parse semantics', pkg.type === 'module', `type=${pkg.type}`);
check('LAN development command exists on port 3000 / host 0.0.0.0', pkg.scripts?.['dev:lan'] === 'node tools/local-static-server.mjs 3000 0.0.0.0', pkg.scripts?.['dev:lan']);
check('QA snapshot no longer reads the invalid metadata.alignment.status path', !app.includes('ibaState?.metadata?.alignment?.status'), 'old path absent');
check('QA snapshot derives Exact dimensions from canonical exactSourcePixelMatch', app.includes("qaAlignment.exactSourcePixelMatch === true) alignmentStatus = 'Exact dimensions'"), 'canonical path present');
check('QA snapshot preserves honest not-evaluated tri-state', app.includes("alignmentStatus = 'Not evaluated — both previews are required'"), 'tri-state label present');
check('local server accepts HOST environment override', server.includes('process.env.HOST'), 'HOST override present');
check('local server accepts PORT environment override', server.includes('process.env.PORT'), 'PORT override present');
check('local server binds using the requested host', server.includes('server.listen(port, host'), 'host passed to listen');
check('local server disables cache during development', server.includes("'Cache-Control': 'no-store, max-age=0'"), 'no-store present');
check('LAN address helper deduplicates IPv4 addresses', JSON.stringify(listLanIpv4Addresses({ a:[{family:'IPv4',internal:false,address:'192.168.1.105'}], b:[{family:'IPv4',internal:false,address:'192.168.1.105'}] })) === JSON.stringify(['192.168.1.105']), 'deduplicated');
check('path traversal is rejected', resolveContainedPath('/../../outside.txt', ROOT) === null, 'rejected');
check('index root resolves inside project', resolveContainedPath('/', ROOT) === path.join(ROOT, 'index.html'), 'index.html');

const failed = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
