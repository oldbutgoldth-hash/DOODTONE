# EPIC 2E-K-R2-FIX4 — Preview Before Candidate Review QA Report

## Release decision

**WORKFLOW_PASS / STORAGE_DEPENDENCY_NOT_VERIFIED**

The requested workflow is implemented and verified in a real Chromium runtime. Full repository static aggregation is not reported as a complete PASS in this environment because `fake-indexeddb` could not be installed from the package registry. The two storage-dependent Node suites therefore remain unverified here; their source and lockfile are retained for `npm ci` on a connected machine.

## Correct workflow

1. Upload and analyze an image.
2. Safety and render eligibility build the Legacy and Controlled V2 preview plans.
3. Both preview canvases render before any human approval.
4. Candidate Review begins as pending.
5. Review actions become available only after current-generation pixel evidence is ready.
6. Approval affects only `candidateReviewStatus`.
7. Production source, write, apply, export, and XMP remain locked.

## Real Chromium evidence

Runtime strategy: `NATIVE_CDP_ABOUT_BLANK_IN_MEMORY`  
Browser: Chromium 144.0.7559.96  
Result: **7/7 PASS**, 0 Page/Console errors.

Before approval:

- `canGeneratePreview = true`
- `previewGenerationDependsOnReview = false`
- Legacy canvas rendered at 96×72
- Controlled V2 canvas rendered at 96×72
- `previewEvidenceReady = true`
- `visualPassed = 0`
- `candidateReviewComplete = false`
- `candidateReviewStatus = in-progress`

After all six visual checks were approved:

- `visualPassed = 6`
- `candidateReviewComplete = true`
- `candidateReviewStatus = approved`
- `productionSource = legacy`
- `productionWrite = false`
- `controlledV2Apply = false`
- `previewExport = false`
- Sandbox `canWriteProduction = false`
- Sandbox `canExportPreview = false`

## XMP runtime invariant

Before and after Candidate Review approval:

- Length: 2,964 characters
- SHA-256: `e609d864bcbb2fdab75a195bd823a86428490c8e9347f40201d3aee53168f799`
- Exact text equality: true

## Production code invariant

The following hashes are unchanged from the input ZIP:

- `core/lightroom-mapping-engine/index.js` — `f6ff6490a4676579fd86b9eff121041211d6d52aa2430771ed9c9ff1742a0099`
- `core/xmp-validator/index.js` — `ef942bcc612811477b712ccfe521c343704759b2b3e44c8855686819d830060f`
- `core/preset-engine/index.js` — `42f3bb83bf850bed3dd4d2a5b66019264c0a0e5561ff07c2e7e3d644c00dedde`
- `ui/ui-engine.js` — `147a55ca9acb75b6b5fa05fbede5d246ddc0b37a8ceacd055ff5c1a4d11f6711`

## Automated results

- ESM syntax: **181/181 PASS**
- FIX4 preview-before-review static/functional: **19/19 PASS**
- Production-lock manifest: **92/92 PASS**
- i18n parity: **969/969 keys**, module suite **17/17 PASS**
- Browser workflow: **7/7 PASS**
- Full static aggregate: all available suites passed; two suites could not start because `fake-indexeddb` was unavailable.

## Safety boundary

This release does not:

- deploy the application;
- activate Controlled V2 in Production;
- change Production Mapping;
- change Production XMP output;
- allow Candidate Review to write or export a preset;
- use approval as a preview-generation gate.
