@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title LUMIXA EPIC 2E-M Guided Cohort QA

echo ============================================================
echo LUMIXA EPIC 2E-M - GUIDED COHORT INTAKE RELEASE GATE
echo Production remains Legacy. This script does not deploy.
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js was not found.
  set EXIT_CODE=1
  goto :done
)
call npm ci
if errorlevel 1 (
  echo [FAIL] npm ci failed.
  set EXIT_CODE=1
  goto :done
)
call npm run test:2e-m
set EXIT_CODE=%ERRORLEVEL%
:done
echo.
echo ============================================================
if "%EXIT_CODE%"=="0" echo EPIC 2E-M RESULT: FINAL_PASS
if "%EXIT_CODE%"=="1" echo EPIC 2E-M RESULT: FAIL
if "%EXIT_CODE%"=="2" echo EPIC 2E-M RESULT: NOT_VERIFIED
echo 0 = FINAL_PASS, 1 = FAIL, 2 = NOT_VERIFIED
echo ============================================================
pause
exit /b %EXIT_CODE%
