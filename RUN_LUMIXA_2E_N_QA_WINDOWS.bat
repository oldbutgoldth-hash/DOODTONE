@echo off
setlocal
cd /d "%~dp0"
title LUMIXA EPIC 2E-N1-N5 QA - DO NOT CLOSE
cls
echo ============================================================
echo LUMIXA EPIC 2E-N1-N5 CORE COLOR MATCH QA
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js not found.
  goto :fail
)
echo [1/3] Installing exact QA dependencies...
call npm ci
if errorlevel 1 goto :fail
echo [2/3] Running fail-closed release gate...
node qa\epic-2e-n-release-gate.mjs
set EXITCODE=%ERRORLEVEL%
echo [3/3] Complete.
if "%EXITCODE%"=="0" (
  echo.
  echo EPIC 2E-N RESULT: FINAL_PASS
  goto :end
)
if "%EXITCODE%"=="2" (
  echo.
  echo EPIC 2E-N RESULT: NOT_VERIFIED
  goto :end
)
:fail
echo.
echo EPIC 2E-N RESULT: FAIL
set EXITCODE=1
:end
echo.
echo Evidence: qa\epic-2e-n-release-gate-results.json
echo Press any key to close.
pause >nul
exit /b %EXITCODE%
