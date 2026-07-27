@echo off
setlocal
title Setup PointBench Portable Dependencies

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-portable-deps.ps1" -ProjectDir "%~dp0.."
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
