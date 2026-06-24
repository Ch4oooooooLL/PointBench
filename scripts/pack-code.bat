@echo off
setlocal
title Pack Code - test-point-web

REM ============================================================
REM  Pack source code only (excludes dependencies and data)
REM  Output: test-point-web-code.zip in the project root
REM ============================================================

cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File "%~dp0pack-code.ps1" -ProjectDir "%~dp0.."
pause
