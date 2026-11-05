@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\photoshop-hot-update.ps1"
if errorlevel 1 (
  echo.
  echo Hot update failed. No Photoshop restart was requested.
  pause
  exit /b 1
)
echo.
echo Hot update finished. Reopen Photoshop only when the script reports host file changes.
pause
