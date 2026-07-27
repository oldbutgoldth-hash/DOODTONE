@echo off
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0RUN_LUMIXA_FIX5_QA_WINDOWS.bat"
set "LUMIXA_EXIT_CODE=%ERRORLEVEL%"
echo.
echo ============================================================
echo LUMIXA FIX5.1 finished with exit code %LUMIXA_EXIT_CODE%
echo 0 = FINAL_PASS, 1 = FAIL, 2 = NOT_VERIFIED
echo ============================================================
pause
exit /b %LUMIXA_EXIT_CODE%
