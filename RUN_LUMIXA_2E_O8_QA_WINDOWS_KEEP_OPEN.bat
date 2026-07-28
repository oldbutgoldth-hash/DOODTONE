@echo off
setlocal
cd /d "%~dp0"
title LUMIXA EPIC 2E-O8 QA - KEEP OPEN
echo === LUMIXA EPIC 2E-O8 QA ===
where node >nul 2>&1 || (echo Node.js not found.& pause & exit /b 1)
call npm run test:2e-o8
set CODE=%ERRORLEVEL%
echo.
if "%CODE%"=="0" (echo O8 RESULT: FINAL_PASS) else if "%CODE%"=="2" (echo O8 RESULT: NOT_VERIFIED) else (echo O8 RESULT: FAIL)
echo Exit code: %CODE%
pause
exit /b %CODE%
