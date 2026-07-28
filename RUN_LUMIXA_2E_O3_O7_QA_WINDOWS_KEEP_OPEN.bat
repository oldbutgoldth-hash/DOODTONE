@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LUMIXA EPIC 2E-O3-O7 QA - KEEP OPEN
set EXIT_CODE=1

echo ============================================================
echo LUMIXA EPIC 2E-O3-O7 TRUE PAIRWISE XMP LINEAGE QA
echo ============================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js was not found in PATH.
  echo Install Node.js 20 or newer, then run this file again.
  set EXIT_CODE=1
  goto :finish
)

echo [1/3] Installing locked QA dependencies with npm ci...
call npm ci
if errorlevel 1 (
  echo [FAIL] npm ci failed.
  set EXIT_CODE=1
  goto :finish
)

echo [2/3] Running XMP lineage and structural readback tests...
call npm run test:2e-o3-o7
if errorlevel 1 (
  echo [FAIL] O3-O7 lineage tests failed.
  set EXIT_CODE=1
  goto :finish
)

echo [3/3] Running fail-closed EPIC 2E-O release gate...
call npm run test:2e-o
set EXIT_CODE=%ERRORLEVEL%

:finish
echo.
echo ============================================================
if "%EXIT_CODE%"=="0" echo EPIC 2E-O3-O7 RESULT: FINAL_PASS
if "%EXIT_CODE%"=="1" echo EPIC 2E-O3-O7 RESULT: FAIL
if "%EXIT_CODE%"=="2" echo EPIC 2E-O3-O7 RESULT: NOT_VERIFIED
echo Exit code: %EXIT_CODE%
echo This window will stay open.
echo ============================================================
pause
exit /b %EXIT_CODE%
