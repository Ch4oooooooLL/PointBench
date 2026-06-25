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
if exist "%SCRIPT_DIR%node_modules" rmdir /s /q "%SCRIPT_DIR%node_modules"
if exist "%SCRIPT_DIR%node-modules" rmdir /s /q "%SCRIPT_DIR%node-modules"
if exist "%SCRIPT_DIR%package-lock.json" del "%SCRIPT_DIR%package-lock.json"
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

curl --fail -L --retry 3 --progress-bar -o "%INSTALLER_DIR%\python-installer.exe" "%PYTHON_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download Python installer
    echo   Please check your internet connection
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%INSTALLER_DIR%\python-installer.exe'; if ((Get-Item $p).Length -lt 10485760) { throw 'Python installer is too small; download may be incomplete.' }"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Python installer validation failed
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

curl --fail -L --retry 3 --progress-bar -o "%INSTALLER_DIR%\nodejs.zip" "%NODE_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download Node.js
    echo   Please check your internet connection
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $p='%INSTALLER_DIR%\nodejs.zip'; $z=[System.IO.Compression.ZipFile]::OpenRead($p); try { if (-not ($z.Entries | Where-Object { $_.FullName -like 'node-v*/node.exe' } | Select-Object -First 1)) { throw 'node.exe was not found in the Node.js zip.' }; Write-Host '  [OK] Node.js zip verified' } finally { $z.Dispose() }"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Node.js zip validation failed
    echo   Delete installers\nodejs.zip and run this script again.
    pause
    exit /b 1
)
echo   [OK] Node.js zip saved

echo   Extracting Node.js for encrypted-file environments...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%INSTALLER_DIR%\nodejs.zip' -DestinationPath '%INSTALLER_DIR%' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to extract Node.js zip
    pause
    exit /b 1
)
echo   [OK] Node.js extracted under installers\
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
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $p='%SCRIPT_DIR%node-modules.zip'; $z=[System.IO.Compression.ZipFile]::OpenRead($p); try { if (-not ($z.Entries | Where-Object { $_.FullName -like 'node_modules/*' } | Select-Object -First 1)) { throw 'node_modules was not found in the archive.' }; Write-Host '  [OK] node-modules.zip verified' } finally { $z.Dispose() }"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] node-modules.zip validation failed
    pause
    exit /b 1
)

echo   Copying extracted node_modules for encrypted-file environments...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -LiteralPath '%PROJECT_DIR%\frontend\node_modules' -Destination '%SCRIPT_DIR%node_modules' -Recurse -Force; Copy-Item -LiteralPath '%PROJECT_DIR%\frontend\package-lock.json' -Destination '%SCRIPT_DIR%package-lock.json' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to copy extracted node_modules
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
echo     installers\node-v24.16.0-win-x64\  (preferred on encrypted PCs)
echo     pip-packages\          (Python wheel files)
echo     node-modules.zip       (frontend deps)
echo     node_modules\          (preferred on encrypted PCs)
echo     package-lock.json
echo.
echo   Next step:
echo     1. Copy the entire offline-install\ folder to the target PC
echo     2. On the target PC, double-click install-deps.bat
echo.
pause
