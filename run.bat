@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
cd /d "%PROJECT_DIR%"
title PointBench
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%\scripts\launcher.ps1" -ProjectDir "%PROJECT_DIR%" -ShowLogs
echo.
echo PointBench stopped.
pause
