@echo off
setlocal
cd /d "%~dp0"

set "NODEEXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODEEXE set "NODEEXE=%%i"
)

if not defined NODEEXE (
  echo Node.js was not found.
  echo Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)

echo [1/5] Checking build tool...
if not exist "%~dp0node_modules\.bin\postject.cmd" (
  echo Installing postject locally...
  set "npm_config_cache=%~dp0.npm-cache"
  npm install
  if errorlevel 1 goto :fail
)

echo [2/5] Generating single-file entry...
if not exist "%~dp0dist" mkdir "%~dp0dist"
%NODEEXE% "%~dp0pack_exe\generate_sea_entry.js"
if errorlevel 1 goto :fail

echo [3/5] Preparing executable payload...
%NODEEXE% --experimental-sea-config "%~dp0dist\sea-config.json"
if errorlevel 1 goto :fail

echo [4/5] Building EXE...
copy /y "%NODEEXE%" "%~dp0dist\LOF_Arbitrage_Monitor.exe" >nul
if errorlevel 1 goto :fail
"%~dp0node_modules\.bin\postject.cmd" "%~dp0dist\LOF_Arbitrage_Monitor.exe" NODE_SEA_BLOB "%~dp0dist\sea-prep.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 goto :fail
%NODEEXE% "%~dp0pack_exe\patch_windows_subsystem.js" "%~dp0dist\LOF_Arbitrage_Monitor.exe"
if errorlevel 1 goto :fail
copy /y "%~dp0dist\LOF_Arbitrage_Monitor.exe" "%~dp0dist\LOF套利监控.exe" >nul
if not exist "%~dp0发布" mkdir "%~dp0发布"
copy /y "%~dp0dist\LOF_Arbitrage_Monitor.exe" "%~dp0发布\LOF套利监控.exe" >nul
copy /y "%~dp0funds_config.json" "%~dp0发布\funds_config.json" >nul

echo [5/5] Building installer...
%NODEEXE% "%~dp0pack_exe\generate_installer_embedded.js"
if errorlevel 1 goto :fail
%NODEEXE% --experimental-sea-config "%~dp0dist\installer-embedded-config.json"
if errorlevel 1 goto :fail
copy /y "%NODEEXE%" "%~dp0dist\LOF_Installer.exe" >nul
if errorlevel 1 goto :fail
"%~dp0node_modules\.bin\postject.cmd" "%~dp0dist\LOF_Installer.exe" NODE_SEA_BLOB "%~dp0dist\installer-embedded-prep.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if errorlevel 1 goto :fail
%NODEEXE% "%~dp0pack_exe\patch_windows_subsystem.js" "%~dp0dist\LOF_Installer.exe"
if errorlevel 1 goto :fail
copy /y "%~dp0dist\LOF_Installer.exe" "%~dp0发布\LOF套利监控安装包.exe" >nul

echo.
echo Build complete:
echo %~dp0发布\LOF套利监控安装包.exe
echo %~dp0发布\LOF套利监控.exe
pause
goto :end

:fail
echo.
echo Build failed. Review the message above.
pause
exit /b 1

:end
endlocal
