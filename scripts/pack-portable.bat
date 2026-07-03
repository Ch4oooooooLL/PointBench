@echo off
setlocal
title Pack Portable Distribution - test-point-web

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-portable.ps1" -ProjectDir "%~dp0.."
pause
