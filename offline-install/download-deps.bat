@echo off
setlocal enabledelayedexpansion
title Download Dependencies - test-point-web

REM ============================================================
REM  Offline Dependency Download Script
REM  Run this on a computer WITH internet access
REM  It will download everything needed for the target machine
REM ============================================================

REM ---------- Config (change versions here if needed) ----------
set "PYTHON_URL=https://www.python.org/ftp/python/3.14.6/python-3.14.6-amd64.exe"
set "NODE_URL=https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip"
REM -------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "INSTALLER_DIR=%SCRIPT_DIR%installers"
set "PIP_DIR=%SCRIPT_DIR%pip-packages"

echo ========================================
echo   Offline Dependency Downloader
echo   Project: test-point-web
echo ========================================
echo.
echo   This script will download:
echo     - Python 3.14 installer
echo     - Node.js 24 LTS (portable zip)
echo     - Python project dependencies (pip)
echo     - Node.js project dependencies (npm)
echo.

REM ============================================================
REM  Clean up old files
REM ============================================================
echo [Prep] Cleaning up old files...
if exist "%INSTALLER_DIR%" rmdir /s /q "%INSTALLER_DIR%"
if exist "%PIP_DIR%"       rmdir /s /q "%PIP_DIR%"
if exist "%SCRIPT_DIR%node-modules.zip" del "%SCRIPT_DIR%node-modules.zip"

mkdir "%INSTALLER_DIR%" 2>nul
mkdir "%PIP_DIR%"       2>nul
echo.

REM ============================================================
REM  1. Download Python installer
REM ============================================================
echo ========================================
echo   [1/4] Downloading Python installer
echo ========================================
echo.
echo   URL: %PYTHON_URL%
echo.

curl -L --progress-bar -o "%INSTALLER_DIR%\python-installer.exe" "%PYTHON_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download Python installer
    echo   Please check your internet connection
    pause
    exit /b 1
)
echo   [OK] Python installer saved
echo.

REM ============================================================
REM  2. Download Node.js
REM ============================================================
echo ========================================
echo   [2/4] Downloading Node.js (portable)
echo ========================================
echo.
echo   URL: %NODE_URL%
echo.

curl -L --progress-bar -o "%INSTALLER_DIR%\nodejs.zip" "%NODE_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download Node.js
    echo   Please check your internet connection
    pause
    exit /b 1
)
echo   [OK] Node.js zip saved
echo.

REM ============================================================
REM  3. Download Python packages (wheel files)
REM ============================================================
echo ========================================
echo   [3/4] Downloading Python packages
echo ========================================
echo.

pip download -r "%PROJECT_DIR%\backend\requirements.txt" -d "%PIP_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] pip download failed
    echo   Please make sure pip is installed and working
    pause
    exit /b 1
)
echo.
echo   [OK] Python packages downloaded to pip-packages\
echo.

REM ============================================================
REM  4. Download and pack Node.js dependencies
REM ============================================================
echo ========================================
echo   [4/4] Installing and packing npm deps
echo ========================================
echo.

cd /d "%PROJECT_DIR%\frontend"

echo   Running npm install...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] npm install failed
    echo   Please make sure Node.js is installed
    pause
    exit /b 1
)

echo   Packing node_modules into zip...
powershell -Command "Compress-Archive -Path '%PROJECT_DIR%\frontend\node_modules', '%PROJECT_DIR%\frontend\package-lock.json' -DestinationPath '%SCRIPT_DIR%node-modules.zip' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to create zip archive
    pause
    exit /b 1
)

echo   [OK] node_modules packed to node-modules.zip
echo.

REM ============================================================
REM  Done
REM ============================================================
echo ========================================
echo   All downloads complete!
echo ========================================
echo.
echo   Offline package contents:
echo     installers\python-installer.exe
echo     installers\nodejs.zip
echo     pip-packages\          (Python wheel files)
echo     node-modules.zip       (frontend deps)
echo.
echo   Next step:
echo     1. Copy the entire offline-install\ folder to the target PC
echo     2. On the target PC, double-click install-deps.bat
echo.
pause
