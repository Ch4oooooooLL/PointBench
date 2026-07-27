@echo off
setlocal
title Pack PointBench Code and Dependencies

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-portable.ps1" -ProjectDir "%~dp0.."
pause
