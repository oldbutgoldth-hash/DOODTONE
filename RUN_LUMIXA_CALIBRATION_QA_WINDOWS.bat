@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat
REM
REM  EPIC 2E-K-R2-FIX1 -- Section 9: local-first, Windows-native
REM  QA runner for the Controlled V2 Calibration Lab. Every step
REM  below runs a REAL command and checks its REAL exit code --
REM  nothing here is hardcoded to "PASS". If any REQUIRED step
REM  fails, this script reports FAIL and returns a non-zero exit
REM  code; it never claims success it did not actually observe.
REM
REM  Run from the project root (double-click, or from a Command
REM  Prompt / PowerShell window opened in this folder).
REM ============================================================

set "OVERALL_FAIL=0"
set "SUMMARY_FILE=%~dp0QA_SUMMARY_WINDOWS.txt"
echo LUMIXA Calibration Lab QA run started %DATE% %TIME% > "%SUMMARY_FILE%"

echo.
echo ============================================================
echo  Step 1/12: Check Node.js is installed
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js was not found on PATH. Install Node.js 18+ from https://nodejs.org and re-run this script.
  echo Step 1 Node.js check: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
  goto :summary
)
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo [OK] Node.js found: %NODE_VERSION%
echo Step 1 Node.js check: OK (%NODE_VERSION%) >> "%SUMMARY_FILE%"

echo.
echo ============================================================
echo  Step 2/12: npm ci (clean, reproducible install)
echo ============================================================
call npm ci
if errorlevel 1 (
  echo [FAIL] npm ci failed.
  echo Step 2 npm ci: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
  goto :summary
)
echo [OK] npm ci completed.
echo Step 2 npm ci: OK >> "%SUMMARY_FILE%"

echo.
echo ============================================================
echo  Step 3/12: Check for a real Chrome or Edge browser
echo ============================================================
set "BROWSER_FOUND=0"
where chrome >nul 2>nul
if not errorlevel 1 set "BROWSER_FOUND=1"
where msedge >nul 2>nul
if not errorlevel 1 set "BROWSER_FOUND=1"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER_FOUND=1"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER_FOUND=1"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER_FOUND=1"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_FOUND=1"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_FOUND=1"
if "%BROWSER_FOUND%"=="1" (
  echo [OK] A Chrome or Edge installation was found.
  echo Step 3 Browser detection: OK >> "%SUMMARY_FILE%"
) else (
  echo [NOT_VERIFIED] No Chrome/Edge install was found via PATH or common install locations.
  echo               Playwright's own bundled Chromium may still be used by the Browser suite below --
  echo               this step is informational only and does not by itself fail the run.
  echo Step 3 Browser detection: NOT_VERIFIED >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 4/12: Preflight (qa:preflight)
echo ============================================================
REM EPIC 2E-K-R2-FIX2 -- Section 8: a non-zero Preflight exit code
REM (Required item Missing/NOT_VERIFIED -- Browser unavailable, a
REM missing fixture, a missing source-hash input, etc.) must FAIL this
REM run overall, never be downgraded to a mere [WARN] that leaves
REM OVERALL_FAIL untouched (the exact reported gap: this step used to
REM be the only one in this script that could report a real failure
REM and still let the run finish "green").
call npm run qa:preflight
if errorlevel 1 (
  echo [FAIL] Preflight reported one or more Required MISSING/NOT_VERIFIED items -- see output above.
  echo Step 4 Preflight: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Preflight passed with no gaps.
  echo Step 4 Preflight: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 5/12: Syntax gate (ESM syntax check, every source file)
echo ============================================================
call npm run test:syntax
if errorlevel 1 (
  echo [FAIL] Syntax gate failed.
  echo Step 5 Syntax gate: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Syntax gate passed.
  echo Step 5 Syntax gate: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 6/12: Static suites (test:static -- includes Pixel Truth hostile tests)
echo ============================================================
call npm run test:static
if errorlevel 1 (
  echo [FAIL] One or more Static suites failed.
  echo Step 6 Static suites: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] All Static suites passed.
  echo Step 6 Static suites: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 7/12: Calibration Lab Storage test (real IndexedDB via fake-indexeddb)
echo ============================================================
call npm run test:calibration-storage
if errorlevel 1 (
  echo [FAIL] Calibration Lab Storage test failed.
  echo Step 7 Storage test: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Calibration Lab Storage test passed.
  echo Step 7 Storage test: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 8/12: Migration V1-^>V2 test (same Storage suite -- backup/idempotency/fail-closed)
echo ============================================================
call npm run test:calibration-migration
if errorlevel 1 (
  echo [FAIL] Migration test failed.
  echo Step 8 Migration test: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Migration test passed.
  echo Step 8 Migration test: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 9/12: Calibration Lab Browser suite (REAL Chromium/Chrome/Edge)
echo ============================================================
call npm run test:calibration-browser
if errorlevel 1 (
  echo [FAIL or NOT_VERIFIED] Browser suite did not exit 0 -- see output above.
  echo               Per project policy this is NEVER treated as a silent pass.
  echo Step 9 Browser suite: FAIL_OR_NOT_VERIFIED >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Browser suite genuinely passed.
  echo Step 9 Browser suite: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 10/12: Pixel Truth hostile tests (standalone signal)
echo ============================================================
call npm run test:calibration-pixel
if errorlevel 1 (
  echo [FAIL] Pixel Truth hostile tests failed.
  echo Step 10 Pixel Truth tests: FAIL >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Pixel Truth hostile tests passed.
  echo Step 10 Pixel Truth tests: OK >> "%SUMMARY_FILE%"
)

echo.
echo ============================================================
echo  Step 11/12: Local Gate (full ordered suite, test:local-gate)
echo ============================================================
call npm run test:local-gate
if errorlevel 1 (
  echo [FAIL or NOT_VERIFIED] Local Gate reported a failure or an unverifiable (Browser-dependent) step.
  echo Step 11 Local Gate: FAIL_OR_NOT_VERIFIED >> "%SUMMARY_FILE%"
  set "OVERALL_FAIL=1"
) else (
  echo [OK] Local Gate passed in full.
  echo Step 11 Local Gate: OK >> "%SUMMARY_FILE%"
)

:summary
echo.
echo ============================================================
echo  Step 12/12: QA Summary
echo ============================================================
type "%SUMMARY_FILE%"
echo.
if "%OVERALL_FAIL%"=="1" (
  echo ================================================================
  echo  OVERALL RESULT: NOT ALL STEPS PASSED. See QA_SUMMARY_WINDOWS.txt
  echo  and the console output above for exactly which step(s) failed
  echo  or could not be verified. This run is NOT a closed/complete QA
  echo  pass -- per project policy, a gap is reported honestly, never
  echo  hidden or upgraded to a false PASS.
  echo ================================================================
  exit /b 1
) else (
  echo ================================================================
  echo  OVERALL RESULT: ALL STEPS PASSED.
  echo ================================================================
  exit /b 0
)
