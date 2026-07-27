@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set OVERALL_FAIL=0
set OVERALL_NOT_VERIFIED=0

echo ============================================================
echo LUMIXA AI - EPIC 2E-K-R2-FIX5 STORAGE / RELEASE GATE
echo ============================================================

echo [1/7] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  exit /b 1
)
node --version

echo [2/7] Installing locked QA dependencies...
call npm ci
if errorlevel 1 (
  echo ERROR: npm ci failed. Storage official verification cannot run.
  exit /b 1
)

echo [3/7] Running ESM syntax gate...
call npm run test:syntax
if errorlevel 1 set OVERALL_FAIL=1

echo [4/7] Running full static suites and deterministic storage contract...
call npm run test:static
if errorlevel 1 set OVERALL_FAIL=1
call npm run test:calibration-storage
if errorlevel 1 set OVERALL_FAIL=1

echo [5/7] Running official fake-indexeddb storage implementation test...
call npm run test:calibration-storage:official
if errorlevel 1 set OVERALL_FAIL=1

echo [6/7] Running native Chrome/Edge IndexedDB persistence test...
call npm run test:calibration-storage:native
if errorlevel 2 (
  set OVERALL_NOT_VERIFIED=1
) else if errorlevel 1 (
  set OVERALL_FAIL=1
)

echo [7/7] Running FIX5 release gate...
call npm run test:fix5
if errorlevel 2 (
  set OVERALL_NOT_VERIFIED=1
) else if errorlevel 1 (
  set OVERALL_FAIL=1
)

if "%OVERALL_FAIL%"=="1" (
  echo.
  echo FIX5 RESULT: FAIL
  exit /b 1
)
if "%OVERALL_NOT_VERIFIED%"=="1" (
  echo.
  echo FIX5 RESULT: NOT_VERIFIED
  echo Run again in a Browser environment that permits localhost origin storage.
  exit /b 2
)

echo.
echo FIX5 RESULT: FINAL_PASS
exit /b 0
