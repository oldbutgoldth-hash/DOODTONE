# LUMIXA FIX5.3 — Cross-platform Browser Contract Closure

## Root cause fixed

The FIX5.2 release gate failed only in `qa/epic-2e-k-r2-fix2-browser-contract-static-test.mjs` on Windows. The real Browser and IndexedDB run passed, but the static fixture required the detected Node executable version string to equal `process.version` byte-for-byte.

Windows may obtain `ProductVersion` through PowerShell (for example `22.16.0.0`) while `node --version` reports `v22.16.0`. These values represent the same executable version but have different display formats.

FIX5.3 compares the semantic major/minor/patch components instead of a platform-specific string representation.

## Unchanged safety boundary

- Production source remains Legacy.
- Production write remains disabled.
- Controlled V2 apply remains disabled.
- Preview export remains disabled.
- Candidate Review never activates Production or changes XMP.
