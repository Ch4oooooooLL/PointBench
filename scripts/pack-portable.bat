@echo off
setlocal
title Build PointBench EXE Installers

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-portable.ps1" -ProjectDir "%~dp0.."
pause
