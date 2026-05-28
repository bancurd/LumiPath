@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\stop-site.ps1"
echo.
echo Press any key to close this window.
pause >nul
endlocal
