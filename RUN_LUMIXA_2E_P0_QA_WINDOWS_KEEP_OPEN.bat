@echo off
setlocal
cd /d "%~dp0"
echo LUMIXA EPIC 2E-P0 QA
echo.
call npm install --ignore-scripts
call node tools/esm-syntax-gate.mjs
call node qa/epic-2e-p0-dual-workflow-preview-static-test.mjs
call node qa/run-static-suites.mjs
call node qa/epic-2e-o8-best-of-both-browser-test.mjs
echo.
echo QA complete. Review any FAIL rows above.
pause
