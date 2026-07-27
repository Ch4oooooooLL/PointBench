@echo off
setlocal
title Pack PointBench Dependencies (Uncompressed)

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-dependencies.ps1" -ProjectDir "%~dp0.."
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
