@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-site.ps1"
echo.
echo Keep this window open if you want to copy the URL above.
echo Press any key to close this window. The LumiPath site will keep running in the background.
pause >nul
endlocal
