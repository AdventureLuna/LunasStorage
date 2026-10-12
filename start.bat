@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  exit /b 1
)
if not defined INVENTORY_PORT set "INVENTORY_PORT=8000"
".venv\Scripts\python.exe" -m backend.cli serve --port "%INVENTORY_PORT%"
if errorlevel 1 (
  echo Server could not start. Check the message above, the port, and setup.bat.
  pause
)
