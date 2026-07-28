@echo off
setlocal
cd /d "%~dp0"
title LUMIXA EPIC 2E-N1 QA - DO NOT CLOSE
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js was not found.
  pause
  exit /b 1
)
echo [1/3] Installing locked QA dependencies...
call npm ci
if errorlevel 1 goto fail
echo [2/3] Running EPIC 2E-N1 release gate...
call npm run test:2e-n1
if errorlevel 1 goto fail
echo [3/3] COMPLETE
echo.
echo EPIC 2E-N1 RESULT: FINAL_PASS
pause
exit /b 0
:fail
echo.
echo EPIC 2E-N1 RESULT: FAIL OR NOT_VERIFIED
pause
exit /b 1
