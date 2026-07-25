// Deliberately broken fixture (LOCAL-FIRST GEOMETRY R3 -- Phase A2).
// Mirrors the exact shape of the real fatal defect found in ui/app.js's
// _syncInteractivePreviewObservation(): two `const rawAlignment = ...`
// declarations in the same function scope, no intervening block.
function syncSomething(ibaState) {
  const rawAlignment = ibaState.alignment;
  const usedFirst = rawAlignment ? rawAlignment.exactSourcePixelMatch : null;

  const rawAlignment = ibaState.alignment;
  const usedSecond = rawAlignment ? rawAlignment.sameAspectRatio : null;

  return { usedFirst, usedSecond };
}
export { syncSomething };
