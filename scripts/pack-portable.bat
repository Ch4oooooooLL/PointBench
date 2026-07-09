@echo off
setlocal
title Pack PointBench Windows Portable

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-portable.ps1" -ProjectDir "%~dp0.."
pause
