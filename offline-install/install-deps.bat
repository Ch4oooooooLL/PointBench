@echo off
setlocal
title Install Dependencies - test-point-web

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%install-deps.ps1"

if not exist "%PS_SCRIPT%" (
    echo [ERROR] Missing install-deps.ps1
    echo Please copy the entire offline-install folder and try again.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
    echo Installation failed. Check offline-install\install-deps.log for details.
)
pause
exit /b %EXIT_CODE%
