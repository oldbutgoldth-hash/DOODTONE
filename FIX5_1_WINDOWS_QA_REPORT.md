# EPIC 2E-K-R2-FIX5.1 — Windows QA Closure

## Root causes confirmed from the Windows release-gate evidence

1. Windows browser paths were built with JavaScript template-literal backslashes, which removed separators and produced paths such as `C:\Program FilesGoogleChromeApplicationchrome.exe`.
2. The native IndexedDB runner called browser detection without passing the dynamically loaded Playwright Chromium handle.
3. The browser contract static test used a Unix shell-script fixture, so it was not deterministic on Windows.
4. The final release gate treated `node_modules` created by the required `npm ci` step as a dirty release package.

## Corrections

- Browser paths now use `path.join()`.
- Added Chrome, Edge, PATH, Chrome for Testing, Playwright cache and bundled Playwright Chromium discovery.
- Native IndexedDB runner passes Playwright Chromium into the unified browser detector.
- Browser contract test uses `process.execPath`, which is executable on Windows, macOS and Linux.
- The QA workspace may contain `node_modules`; release ZIP packaging still excludes it.
- Added a keep-open Windows launcher for easier troubleshooting.

## Verification completed in the repair environment

- ESM syntax: 185/185 PASS
- Full static suites: PASS
- Browser detection contract: 16/16 PASS
- Storage contract: 24/24 PASS
- Preview-before-review safety: 19/19 PASS
- Production remains Legacy and Candidate Review cannot enable Production/XMP.

Native IndexedDB remained NOT_VERIFIED in the repair environment only because its Chromium policy blocks loopback origins. Re-run the Windows launcher to obtain the authoritative Windows result.
