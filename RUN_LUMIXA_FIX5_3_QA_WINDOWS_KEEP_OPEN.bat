@echo off
setlocal
cd /d "%~dp0"
title LUMIXA FIX5.3 FINAL QA - DO NOT CLOSE

echo ============================================================
echo LUMIXA FIX5.3 WINDOWS FINAL GATE
echo ============================================================
echo.

if not exist package.json (
  echo ERROR: package.json was not found in this folder.
  echo Extract the ZIP fully and run this file from lumixa_r9.
  echo.
  pause
  exit /b 1
)

call npm ci
if errorlevel 1 (
  echo.
  echo FIX5 RESULT: FAIL
  echo npm ci failed.
  echo.
  pause
  exit /b 1
)

call npm run test:fix5
set "RESULT=%ERRORLEVEL%"

echo.
echo ============================================================
if "%RESULT%"=="0" (
  echo FIX5 RESULT: FINAL_PASS
) else if "%RESULT%"=="2" (
  echo FIX5 RESULT: NOT_VERIFIED
) else (
  echo FIX5 RESULT: FAIL
)
echo LUMIXA FIX5.3 finished with exit code %RESULT%
echo 0 = FINAL_PASS, 1 = FAIL, 2 = NOT_VERIFIED
echo ============================================================
echo.
pause
exit /b %RESULT%
