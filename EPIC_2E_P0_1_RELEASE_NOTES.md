# EPIC 2E-P0.1 — Preview Analysis Watchdog

- Replaced the all-at-once Reference analysis Promise.all with controlled staged execution.
- Added a 45-second watchdog and stable `CORE_TIMEOUT_*` error codes for every Core module.
- Optional analysis modules now fall back safely instead of leaving the preview overlay stuck forever.
- UI yields between Core modules so status text and browser painting remain responsive.
- Reference, Target, Matched Preview, and Lightroom Result phases identify their active module.
- Production remains Legacy and locked.
