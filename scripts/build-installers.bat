@echo off
setlocal
title Build PointBench EXE Installers

for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installers.ps1" -ProjectDir "%PROJECT_DIR%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%

