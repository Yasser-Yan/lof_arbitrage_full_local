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
  echo Starting the Node version...
  %NODEEXE% "%~dp0server.js"
  goto :end
)

if not defined PYEXE (
  echo Python 3 and Node.js were not found.
  echo Install Python 3.10 or newer, or install Node.js 18 or newer.
  pause
  exit /b 1
)

echo [1/4] Checking Python...
%PYEXE% --version
if errorlevel 1 goto :fail

echo [2/4] Installing dependencies...
%PYEXE% -m pip install --upgrade pip
if errorlevel 1 goto :fail
%PYEXE% -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 goto :fail

echo [3/4] Validating files...
%PYEXE% "%~dp0validate_offline.py"
if errorlevel 1 goto :fail

echo [4/4] Starting server...
%PYEXE% "%~dp0server.py"
goto :end

:fail
echo.
echo Operation failed. Review the message above.
pause
exit /b 1

:end
endlocal
