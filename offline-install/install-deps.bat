@echo off
setlocal enabledelayedexpansion
title Install Dependencies - test-point-web

REM ============================================================
REM  Offline Dependency Install Script
REM  Run this on the target PC (NO internet required)
REM  It will install everything from scratch
REM  No administrator privileges needed
REM ============================================================

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "INSTALLER_DIR=%SCRIPT_DIR%installers"
set "PIP_DIR=%SCRIPT_DIR%pip-packages"
set "NODE_DIR=C:\nodejs"

echo ========================================
echo   Offline Dependency Installer
echo   Project: test-point-web
echo ========================================
echo.
echo   This script will install:
echo     - Python 3.14
echo     - Node.js 24 LTS
echo     - Python project dependencies
echo     - Node.js project dependencies
echo.
echo   No internet. No admin rights required.
echo.

REM ============================================================
REM  Verify offline package integrity
REM ============================================================
echo [Check] Verifying offline package...
echo.

set "MISSING=0"
if not exist "%INSTALLER_DIR%\python-installer.exe" (
    echo   [MISSING] installers\python-installer.exe
    set "MISSING=1"
)
if not exist "%INSTALLER_DIR%\nodejs.zip" (
    echo   [MISSING] installers\nodejs.zip
    set "MISSING=1"
)
if not exist "%PIP_DIR%" (
    echo   [MISSING] pip-packages\
    set "MISSING=1"
)
if not exist "%SCRIPT_DIR%node-modules.zip" (
    echo   [MISSING] node-modules.zip
    set "MISSING=1"
)

if "!MISSING!"=="1" (
    echo.
    echo   [ERROR] Offline package is incomplete!
    echo   Please run download-deps.bat on a PC with internet first,
    echo   then copy the ENTIRE offline-install\ folder to this machine.
    pause
    exit /b 1
)
echo   [OK] All offline packages present
echo.

REM ============================================================
REM  1. Install Python
REM ============================================================
echo ========================================
echo   [1/4] Installing Python 3.14
echo ========================================
echo.
echo   Running silent install (may take 1-2 min, please wait)...

set "PY_EXE=%INSTALLER_DIR%\python-installer.exe"

REM  InstallAllUsers=0  = current user only (no admin needed)
REM  PrependPath=1      = auto-add to PATH
REM  Include_test=0     = skip test suite (faster)
REM  Include_pip=1      = include pip (default)
"%PY_EXE%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0

if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Python installation failed (exit code: %ERRORLEVEL%)
    pause
    exit /b 1
)

REM Refresh PATH for current session
REM Python 3.14 per-user default location:
set "PY_BASE=%LOCALAPPDATA%\Programs\Python\Python314"
set "PATH=%PY_BASE%\Scripts;%PY_BASE%;%PATH%"

REM Verify
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    REM Try all-users install path
    set "PY_BASE=C:\Program Files\Python314"
    set "PATH=!PY_BASE!\Scripts;!PY_BASE!;%PATH%"
    python --version >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo   [WARNING] Python installed but not usable in this window
        echo   Please restart your PC and run this script again
        pause
        exit /b 1
    )
)

echo.
python --version
echo   [OK] Python installed successfully
echo.

REM ============================================================
REM  2. Install Node.js
REM ============================================================
echo ========================================
echo   [2/4] Installing Node.js 24 LTS
echo ========================================
echo.

if exist "%NODE_DIR%" (
    echo   Found existing %NODE_DIR%, replacing...
    rmdir /s /q "%NODE_DIR%" 2>nul
)

echo   Extracting...

powershell -Command "Expand-Archive -Path '%INSTALLER_DIR%\nodejs.zip' -DestinationPath '%NODE_DIR%' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to extract Node.js
    pause
    exit /b 1
)

REM Add to current session PATH
set "PATH=%NODE_DIR%;%PATH%"

REM Permanently add to user PATH
echo   Setting PATH environment variable...
setx PATH "%PATH%" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [WARNING] setx failed (PATH may exceed 1024 chars)
    echo   Please manually add %NODE_DIR% to your system PATH
)

REM Verify
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Node.js is not runnable
    pause
    exit /b 1
)

echo.
node --version
call npm --version
echo   [OK] Node.js installed successfully
echo.

REM ============================================================
REM  3. Install Python project dependencies
REM ============================================================
echo ========================================
echo   [3/4] Installing Python project deps
echo ========================================
echo.

echo   Installing from offline packages (pip install --no-index)...
echo   About 12 packages, please wait...
echo.

REM Note: dwdatareader may fail due to missing DWDataReaderLib native library
REM This is expected - CSV/TXT imports still work fine
pip install --no-index --find-links="%PIP_DIR%" -r "%PROJECT_DIR%\backend\requirements.txt"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   ========================================
    echo   NOTE: Some packages failed to install
    echo   ========================================
    echo.
    echo   If dwdatareader failed, this is NORMAL --
    echo   it requires the DWDataReaderLib native C++ library
    echo   which must be downloaded from www.dewesoft.com separately.
    echo.
    echo   CSV / TXT / Excel imports are NOT affected.
    echo.
) else (
    echo.
    echo   [OK] All Python packages installed successfully
)
echo.

REM ============================================================
REM  4. Install Node.js project dependencies
REM ============================================================
echo ========================================
echo   [4/4] Installing Node.js project deps
echo ========================================
echo.

echo   Extracting node_modules...

powershell -Command "Expand-Archive -Path '%SCRIPT_DIR%node-modules.zip' -DestinationPath '%PROJECT_DIR%\frontend' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to extract node_modules
    pause
    exit /b 1
)

echo   [OK] node_modules extracted
echo.

REM ============================================================
REM  Verify installation
REM ============================================================
echo ========================================
echo   Verifying installation
echo ========================================
echo.

echo   Python environment:
echo   ----------------------------------------
python --version >nul 2>&1 && (
    echo     Python ........... OK
) || (
    echo     Python ........... FAIL
)
python -c "import fastapi;          print('    fastapi ......... OK')" 2>nul || echo     fastapi ......... FAIL
python -c "import sqlalchemy;       print('    sqlalchemy ...... OK')" 2>nul || echo     sqlalchemy ...... FAIL
python -c "import pydantic;         print('    pydantic ........ OK')" 2>nul || echo     pydantic ........ FAIL
python -c "import openpyxl;         print('    openpyxl ........ OK')" 2>nul || echo     openpyxl ........ FAIL
python -c "import uvicorn;          print('    uvicorn ......... OK')" 2>nul || echo     uvicorn ......... FAIL

echo.
echo   Node.js environment:
echo   ----------------------------------------
node  --version >nul 2>&1 && echo     Node.js ......... OK || echo     Node.js ......... FAIL
npm   --version >nul 2>&1 && echo     npm .............. OK || echo     npm .............. FAIL
if exist "%PROJECT_DIR%\frontend\node_modules" (
    echo     node_modules ..... OK
) else (
    echo     node_modules ..... FAIL
)

echo.

REM ============================================================
REM  Done
REM ============================================================
echo ========================================
echo   Installation complete!
echo ========================================
echo.
echo   How to start the project:
echo.
echo    [1] Start backend (open a new terminal):
echo       cd /d "%PROJECT_DIR%\backend"
echo       python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
echo.
echo    [2] Start frontend (open another terminal):
echo       cd /d "%PROJECT_DIR%\frontend"
echo       npm run dev
echo.
echo    [3] Open browser:
echo       http://localhost:5173
echo.
echo   (If python or node is not found, restart your PC to refresh PATH)
echo.
pause
