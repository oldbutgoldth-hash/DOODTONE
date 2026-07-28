@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LUMIXA EPIC 2E-O QA - KEEP OPEN

echo ============================================================
echo LUMIXA EPIC 2E-O TARGET-AWARE / LIGHTROOM ROUND-TRIP QA
echo ============================================================
where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Node.js was not found in PATH.
  echo Install Node.js 20 or newer, then run this file again.
  set EXIT_CODE=1
  goto :finish
)

if not exist node_modules (
  echo [1/2] Installing locked QA dependencies with npm ci...
  call npm ci
  if errorlevel 1 (
    echo [FAIL] npm ci failed.
    set EXIT_CODE=1
    goto :finish
  )
) else (
  echo [1/2] node_modules already present; using current locked dependencies.
)

echo [2/2] Running EPIC 2E-O fail-closed release gate...
call npm run test:2e-o
set EXIT_CODE=%ERRORLEVEL%

:finish
echo.
echo ============================================================
if "%EXIT_CODE%"=="0" echo EPIC 2E-O RESULT: FINAL_PASS
if "%EXIT_CODE%"=="1" echo EPIC 2E-O RESULT: FAIL
if "%EXIT_CODE%"=="2" echo EPIC 2E-O RESULT: NOT_VERIFIED
echo Exit code: %EXIT_CODE%
echo This window will stay open.
echo ============================================================
pause
exit /b %EXIT_CODE%
