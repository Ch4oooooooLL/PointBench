@echo off
setlocal
title Build PointBench Dependencies Installer

for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installers.ps1" -ProjectDir "%PROJECT_DIR%" -Package Dependencies
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%

