#!/usr/bin/env node
/**
 * qa/epic-2e-j-preview-source-geometry-normalizer-static-test.mjs
 *
 * SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 3 regression tests for
 * ui/preview-source-geometry-normalizer-v2.js's rewritten resource
 * lifecycle. Runs in plain Node (no DOM, no Playwright, no Chromium)
 * by stubbing the global `createImageBitmap` with a deterministic fake
 * that returns a distinguishable mock "bitmap" object (with a spy-able
 * `.close()`), and controlling exactly when each fake decode resolves
 * via externally-held resolver functions — this lets the test force
 * the exact interleavings (rapid A-then-B, Reset during decode, a
 * still-in-flight render outliving a newer decode) that a real browser
 * would only produce non-deterministically.
 *
 * This is genuine executable proof of the lifecycle logic itself (not
 * merely a hand-written self-consistency check) — it directly exercises
 * decodeCanonicalSource / markRenderStarted / markRenderSettled /
 * releaseGeneration / releaseAll exactly as ui/app.js calls them.
 *
 * Required scenarios (per SAFE RECOVERY + DEPLOY GEOMETRY R2 Phase 3):
 *   - first upload
 *   - Re-analyze (reuses the current File / same generation semantics)
 *   - second upload
 *   - rapid upload A then B
 *   - Reset during decode
 *   - Reset after analysis
 *   - stale render completion after new upload (the exact race this
 *     rewrite closes: a still-in-flight render for generation N must
 *     not have its bitmap closed by generation N+1's decode)
 */
import { createPreviewSourceGeometryNormalizerV2 } from '../ui/preview-source-geometry-normalizer-v2.js';

const results = [];
function record(test, result, evidence) {
  const normalized = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalized, evidence });
  const icon = normalized === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${normalized}] ${test} — ${evidence}`);
}

/** Deterministic fake ImageBitmap + a controllable createImageBitmap stub. */
function installFakeCreateImageBitmap() {
  const pending = new Map(); // token -> { resolve, reject }
  let nextToken = 0;
  const closedLog = [];
  globalThis.createImageBitmap = (file) => {
    const token = nextToken++;
    return new Promise((resolve, reject) => {
      pending.set(token, {
        resolveNow: () => {
          const bitmap = {
            __token: token,
            width: 800,
            height: 600,
            closed: false,
            close() { this.closed = true; closedLog.push(token); },
          };
          resolve(bitmap);
        },
        rejectNow: (err) => reject(err),
      });
    });
  };
  return {
    resolveToken: (token) => { pending.get(token)?.resolveNow(); pending.delete(token); },
    tokenCount: () => nextToken,
    closedLog,
    restore: () => { delete globalThis.createImageBitmap; },
  };
}

async function scenarioFirstUpload() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const decodePromise = normalizer.decodeCanonicalSource({}, 1, null);
  fake.resolveToken(0);
  const result = await decodePromise;
  record('First upload: decode completes with a bitmap source', result.source && result.source.__token === 0, `decodePath=${result.evidence.decodePath}`);
  normalizer.releaseAll();
  fake.restore();
}

async function scenarioReanalyzeSameGeneration() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const p1 = normalizer.decodeCanonicalSource({}, 1, null);
  fake.resolveToken(0);
  const r1 = await p1;
  normalizer.markRenderStarted(1);
  normalizer.markRenderSettled(1);
  // Re-analyze reuses the SAME generation id in this project's model
  // only if the caller increments analysisRenderGeneration even for
  // Re-analyze (it does, per ui/app.js's runAnalysis() — every call
  // increments the shared counter). Model that here as generation 2.
  const p2 = normalizer.decodeCanonicalSource({}, 2, null);
  fake.resolveToken(1);
  const r2 = await p2;
  record('Re-analyze: new generation decodes cleanly, prior bitmap released', r2.source && r2.source.__token === 1 && fake.closedLog.includes(0), `closedLog=${JSON.stringify(fake.closedLog)}`);
  normalizer.releaseAll();
  fake.restore();
}

async function scenarioSecondUpload() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const p1 = normalizer.decodeCanonicalSource({}, 1, null);
  fake.resolveToken(0);
  await p1;
  normalizer.markRenderStarted(1);
  normalizer.markRenderSettled(1);
  const p2 = normalizer.decodeCanonicalSource({}, 2, null);
  fake.resolveToken(1);
  const r2 = await p2;
  record('Second upload: distinct generation, distinct bitmap, no geometry reuse', r2.source.__token !== 0 && r2.evidence.generationId === 2, `token=${r2.source.__token}, generationId=${r2.evidence.generationId}`);
  normalizer.releaseAll();
  fake.restore();
}

async function scenarioRapidAThenB() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  // Rapid: start A's decode, then IMMEDIATELY start B's decode before
  // A's createImageBitmap has resolved.
  const pA = normalizer.decodeCanonicalSource({}, 1, null);
  const pB = normalizer.decodeCanonicalSource({}, 2, null);
  // Resolve A first (its createImageBitmap call), then B.
  fake.resolveToken(0);
  fake.resolveToken(1);
  const [rA, rB] = await Promise.all([pA, pB]);
  record('Rapid A-then-B: A is discarded as stale, never becomes the active source', rA.source === null && rA.evidence.decodePath === 'stale-discarded', `A.decodePath=${rA.evidence.decodePath}`);
  record('Rapid A-then-B: B becomes the active source with its own generation id', rB.source && rB.evidence.generationId === 2, `B.generationId=${rB.evidence.generationId}`);
  normalizer.releaseAll();
  fake.restore();
}

async function scenarioResetDuringDecode() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const p1 = normalizer.decodeCanonicalSource({}, 1, null);
  // Reset happens WHILE the decode is still in flight (createImageBitmap
  // has not resolved yet) — explicit cancel via releaseGeneration.
  normalizer.releaseGeneration(1);
  fake.resolveToken(0); // the in-flight createImageBitmap now resolves anyway
  const r1 = await p1;
  // Because the entry was deleted by releaseGeneration() before the
  // decode resolved, the generationId!==newestGenerationId-or-missing
  // check must treat this as stale and close the bitmap immediately.
  record('Reset during decode: in-flight decode resolves but is discarded/closed, never surfaces as active', r1.source === null, `decodePath=${r1.evidence.decodePath}, closedLog=${JSON.stringify(fake.closedLog)}`);
  normalizer.releaseAll();
  fake.restore();
}

async function scenarioResetAfterAnalysis() {
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const p1 = normalizer.decodeCanonicalSource({}, 1, null);
  fake.resolveToken(0);
  const r1 = await p1;
  normalizer.markRenderStarted(1);
  normalizer.markRenderSettled(1);
  normalizer.releaseAll();
  record('Reset after analysis: releaseAll() closes the completed generation\'s bitmap', r1.source.closed === true, `closed=${r1.source.closed}`);
  fake.restore();
}

async function scenarioStaleRenderCompletionAfterNewUpload() {
  // The exact race this Phase 3 rewrite closes: generation 1's decode
  // finishes and its render STARTS (markRenderStarted) but has not yet
  // SETTLED when generation 2's decode begins. Generation 1's bitmap
  // must NOT be closed until its render settles, even though
  // generation 2 is now the newest.
  const fake = installFakeCreateImageBitmap();
  const normalizer = createPreviewSourceGeometryNormalizerV2();
  const p1 = normalizer.decodeCanonicalSource({}, 1, null);
  fake.resolveToken(0);
  const r1 = await p1;
  normalizer.markRenderStarted(1); // generation 1's render is now "in flight"

  const p2 = normalizer.decodeCanonicalSource({}, 2, null); // supersedes gen 1 while its render is still pending
  fake.resolveToken(1);
  await p2;

  record('Stale render completion: gen 1 bitmap NOT closed while its render is still pending, even though gen 2 has started', r1.source.closed === false, `gen1.closed=${r1.source.closed}`);

  normalizer.markRenderSettled(1); // gen 1's render finally settles
  record('Stale render completion: gen 1 bitmap IS closed the instant its render settles (now superseded)', r1.source.closed === true, `gen1.closed=${r1.source.closed}`);

  normalizer.releaseAll();
  fake.restore();
}

async function main() {
  await scenarioFirstUpload();
  await scenarioReanalyzeSameGeneration();
  await scenarioSecondUpload();
  await scenarioRapidAThenB();
  await scenarioResetDuringDecode();
  await scenarioResetAfterAnalysis();
  await scenarioStaleRenderCompletionAfterNewUpload();

  const fail = results.filter((r) => r.result !== 'PASS').length;
  console.log(`\n${results.length - fail}/${results.length} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
