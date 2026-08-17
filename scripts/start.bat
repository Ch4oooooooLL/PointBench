@echo off
setlocal

for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
cd /d "%PROJECT_DIR%"
title PointBench Portable

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" -ProjectDir "%PROJECT_DIR%" -ShowLogs
set "EXIT_CODE=%ERRORLEVEL%"

echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:PROJECT_DIR; $latest=Join-Path $root 'logs\latest-run.txt'; if (Test-Path $latest) { $dir=(Get-Content $latest -Raw).Trim(); Write-Host ''; Write-Host 'Latest logs:' $dir; foreach ($name in 'errors.log','launcher.log','backend.log','frontend.log') { $p=Join-Path $dir $name; if (Test-Path $p) { Write-Host ''; Write-Host ('===== ' + $name + ' tail ====='); Get-Content $p -Tail 80 } } }"

echo.
echo PointBench stopped. Exit code: %EXIT_CODE%
pause
exit /b %EXIT_CODE%
