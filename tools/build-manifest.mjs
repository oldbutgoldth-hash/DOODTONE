#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE = new Set(['node_modules', '.git', 'LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R2.zip']);

async function walk(dir) {
  const entries = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...await walk(full));
    else entries.push(full);
  }
  return entries;
}

const files = await walk(ROOT);
const manifest = [];
for (const f of files.sort()) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const hash = crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
  manifest.push({ file: rel, sha256: hash });
}

await fs.writeFile(path.join(ROOT, 'SHA256_MANIFEST.txt'), manifest.map(m => `${m.file}\t${m.sha256}`).join('\n') + '\n', 'utf8');
console.log(`Manifest written: ${manifest.length} files`);
console.log('---');
for (const m of manifest.slice(0, 30)) console.log(`${m.file}: ${m.sha256}`);
console.log(`... and ${Math.max(0, manifest.length - 30)} more files`);
