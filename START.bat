@echo off
setlocal
cd /d "%~dp0"

set "PYEXE="
set "NODEEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py -3"
if not defined PYEXE (
  where python >nul 2>nul
  if not errorlevel 1 set "PYEXE=python"
)
where node >nul 2>nul
if not errorlevel 1 set "NODEEXE=node"

if defined NODEEXE (
  echo Starting LOF monitor with Node...
  %NODEEXE% "%~dp0server.js"
  goto :check
)

if defined PYEXE (
  echo Starting LOF monitor with Python...
  %PYEXE% "%~dp0server.py"
  goto :check
)

echo Python 3 and Node.js were not found.
echo Install Python 3.10 or newer, or install Node.js 18 or newer.
pause
exit /b 1

:check
if errorlevel 1 (
  echo.
  echo The server stopped with an error.
  pause
  exit /b 1
)
endlocal
