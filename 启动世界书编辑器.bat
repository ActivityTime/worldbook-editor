@echo off
rem ============================================================
rem  Worldbook Editor - Web UI launcher
rem  Double-click to start. Close this window to stop the server.
rem  Optional port:  launch.bat 9090   (default 8080)
rem ============================================================
cd /d "%~dp0"
title Worldbook Editor - Web UI

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8080"

echo.
echo  [Worldbook Editor] Starting web UI...
echo  [Worldbook Editor] Port: %PORT%
echo  [Worldbook Editor] Browser will open at http://127.0.0.1:%PORT%/
echo  [Worldbook Editor] Keep this window open. Closing it stops the server.
echo.

node "%~dp0bin\wbedit.js" serve --port %PORT% --open

if errorlevel 1 (
  echo.
  echo  [ERROR] Failed to start. Possible causes:
  echo    1. Node.js not installed or not in PATH
  echo    2. Port %PORT% in use (try: launch.bat 9090)
  echo.
  pause
)
