# EPIC 2E-P0.6.1 — Analysis Proxy Contract Repair

## Root cause
P0.6 created a bounded `<canvas>` proxy and passed it into Core engines. Most existing Core engines require an `HTMLImageElement` and read `naturalWidth` / `naturalHeight`. A canvas only exposes `width` / `height`, so the first K-Means stage could fail before the pipeline advanced. The progress overlay remained on the last announced stage, making it look like K-Means was still computing.

## Repair
- Keep the bounded 512 px canvas for downsampling.
- Encode it to PNG in memory.
- Decode it into an `HTMLImageElement`.
- Validate `naturalWidth` and `naturalHeight` before any Core receives it.
- Preserve full Core participation, cache, trace, generation guard and slider debounce.

## No quality reduction
No Core was removed or deferred by this patch.
