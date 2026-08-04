#!/usr/bin/env node
// Throwaway helper (not part of the required deliverable list) — runs
// a slice of run-static-suites.mjs's STATIC_SUITES array by index
// range, so the full 70-suite regression can be executed across
// several sub-45s bash calls instead of one long-running command.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const src = await import('node:fs').then(fs => fs.readFileSync(path.join(__dirname, 'run-static-suites.mjs'), 'utf8'));
const matches = [...src.matchAll(/'(qa\/[^']+\.mjs)'/g)].map(m => m[1]);

const [startArg, endArg] = process.argv.slice(2);
const start = parseInt(startArg ?? '0', 10);
const end = endArg ? parseInt(endArg, 10) : matches.length;

let pass = 0, fail = 0;
const failed = [];
for (let i = start; i < Math.min(end, matches.length); i++) {
  const rel = matches[i];
  const r = spawnSync(process.execPath, [path.join(PROJECT_ROOT, rel)], { encoding: 'utf8', timeout: 40000 });
  const ok = r.status === 0;
  if (ok) pass++; else { fail++; failed.push(rel); }
  console.log(`[${i}] ${ok ? 'PASS' : 'FAIL'} ${rel}${ok ? '' : ' (exit ' + r.status + ')'}`);
  if (!ok) {
    console.log('--- stdout tail ---');
    console.log((r.stdout || '').split('\n').slice(-15).join('\n'));
    console.log('--- stderr tail ---');
    console.log((r.stderr || '').split('\n').slice(-15).join('\n'));
  }
}
console.log(`\nRange [${start},${Math.min(end, matches.length)}) of ${matches.length}: ${pass} pass, ${fail} fail`);
if (failed.length) console.log('FAILED:', failed.join(', '));
process.exit(fail === 0 ? 0 : 1);
