#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archiver, ZipArchive } from 'archiver';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDE = new Set(['node_modules', '.git', 'LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R2.zip', 'LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R3.zip', 'qa/_probe-evidence-path.mjs']);

async function walk(dir) {
  const entries = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) entries.push(...await walk(full));
    else entries.push(full);
  }
  return entries;
}

const files = await walk(ROOT);
const outPath = path.join(ROOT, 'LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R3.zip');
const out = createWriteStream(outPath);
const archive = new ZipArchive({ zlib: { level: 6 } });
archive.pipe(out);

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  archive.file(f, { name: rel });
}

await archive.finalize();
await new Promise(resolve => out.on('close', resolve));
const size = (await stat(outPath)).size;
console.log(`ZIP created: ${(size / 1024 / 1024).toFixed(2)} MB (${files.length} files)`);
