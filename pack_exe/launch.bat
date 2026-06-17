@echo off
setlocal
cd /d "%~dp0"
title LOF Arbitrage Monitor
echo Starting LOF Arbitrage Monitor...
echo.
node.exe server.js
if errorlevel 1 (
  echo.
  echo The monitor stopped with an error.
  pause
)
endlocal
