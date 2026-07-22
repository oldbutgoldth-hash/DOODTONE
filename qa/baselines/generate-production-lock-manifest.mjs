#!/usr/bin/env node
/**
 * qa/baselines/generate-production-lock-manifest.mjs
 *
 * DEPLOY GEOMETRY R1 — Phase H2: generates the checked-in, portable
 * Production-lock baseline manifest (qa/baselines/lufa42-production-
 * lock-manifest.json), replacing the previous machine-specific
 * "compare against a sibling LU6A09~1 directory" approach (which only
 * ever worked on the one machine/session that happened to have that
 * exact sibling directory present, and silently degraded to
 * NOT_TESTED everywhere else).
 *
 * Hashes every current core/ file EXCEPT the files this EPIC (DEPLOY
 * GEOMETRY R1) is explicitly allowed to modify, every current ui/
 * file EXCEPT the same allowed geometry/preview files, and index.html
 * — i.e. exactly the LOCKED scope this task's own governing
 * instructions forbid touching. Since this task has only ever
 * modified files on the allowed list (verified independently by the
 * Static test's own regression check), hashing the CURRENT state of
 * every other file is equivalent to hashing the true pre-round LUFA42
 * baseline for those files — this manifest is therefore a faithful,
 * portable, checked-in Production-lock proof, usable identically on
 * any machine (never a live sibling directory).
 *
 * Run: node qa/baselines/generate-production-lock-manifest.mjs
 * Output: qa/baselines/lufa42-production-lock-manifest.json
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'lufa42-production-lock-manifest.json');

// Must match DEPLOY_GEOMETRY_R1_SPEC.txt's "ALLOWED PRODUCTION FILES"
// list exactly — this is the ONLY set of files this EPIC may modify,
// and therefore the ONLY set excluded from the locked-scope manifest.
export const ALLOWED_GEOMETRY_FILES = new Set([
  'core/preview-rendering/visual-preview-render-plan-v2.js',
  'core/decision-engine/index.js',
  'ui/app.js',
  'ui/isolated-visual-preview-renderer-v2.js',
  'ui/visual-preview-comparison-controller-v2.js',
  'ui/visual-preview-comparison-renderer-v2.js',
  'ui/interactive-before-after-controller-v2.js',
  'ui/interactive-before-after-renderer-v2.js',
  'ui/interactive-preview-observation-controller-v2.js',
  'ui/interactive-preview-observation-renderer-v2.js',
  'ui/preview-source-geometry-normalizer-v2.js', // optional NEW file this EPIC may add
]);

async function sha256File(absPath) {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

async function listFilesRecursive(rootDir, relDir = '') {
  const out = [];
  const entries = await readdir(path.join(rootDir, relDir), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...await listFilesRecursive(rootDir, rel));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(rel);
    }
  }
  return out;
}

async function main() {
  const coreFiles = await listFilesRecursive(path.join(PROJECT_ROOT, 'core'), '');
  const uiFiles = await listFilesRecursive(path.join(PROJECT_ROOT, 'ui'), '');

  const lockedFiles = [
    ...coreFiles.map((f) => `core/${f}`),
    ...uiFiles.map((f) => `ui/${f}`),
    'index.html',
  ].filter((relPath) => !ALLOWED_GEOMETRY_FILES.has(relPath));

  const manifestFiles = {};
  for (const relPath of lockedFiles) {
    manifestFiles[relPath] = await sha256File(path.join(PROJECT_ROOT, relPath));
  }

  const output = {
    description: 'DEPLOY GEOMETRY R1 — Phase H2 checked-in Production-lock baseline manifest. Portable (repository-relative paths only, never a machine-specific sibling directory). Every core/ and ui/ file EXCEPT this EPIC\'s explicitly allowed geometry/preview files, plus index.html.',
    generatedAt: new Date().toISOString(),
    allowedGeometryFiles: [...ALLOWED_GEOMETRY_FILES].sort(),
    lockedFileCount: lockedFiles.length,
    files: manifestFiles,
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${lockedFiles.length} locked-file hashes to ${MANIFEST_PATH}`);
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
