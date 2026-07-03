@echo off
setlocal enabledelayedexpansion
title Setup Portable Runtime - test-point-web

REM ============================================================
REM  Portable Runtime Setup Script
REM  Run this on a computer WITH internet access.
REM  It downloads portable Python + Node.js and installs all
REM  project dependencies into self-contained runtime/ directory.
REM
REM  After running this, use pack-portable.bat to create a
REM  single zip for distribution to offline computers.
REM ============================================================

REM ---------- Config (change versions here if needed) ----------
set "PYTHON_VERSION=3.14.6"
set "PYTHON_EMBED_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/python-%PYTHON_VERSION%-embed-amd64.zip"
set "GET_PIP_URL=https://bootstrap.pypa.io/get-pip.py"
set "NODE_VERSION=v24.16.0"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip"
REM -------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "RUNTIME_DIR=%PROJECT_DIR%\runtime"
set "PYTHON_DIR=%RUNTIME_DIR%\python"
set "NODE_DIR=%RUNTIME_DIR%\node"

echo ========================================
echo   Portable Runtime Setup
echo   Project: test-point-web
echo ========================================
echo.
echo   This script will set up a portable,
echo   self-contained runtime environment:
echo.
echo     - Python %PYTHON_VERSION% (embeddable)
echo     - Node.js %NODE_VERSION% (portable)
echo     - All Python project dependencies
echo     - All Node.js project dependencies
echo.
echo   Everything is placed under runtime\ and
echo   frontend\node_modules — no system-level
echo   installation, no admin rights required.
echo.

REM ============================================================
REM  Clean up old runtime
REM ============================================================
echo [Prep] Cleaning up old runtime...
if exist "%RUNTIME_DIR%" rmdir /s /q "%RUNTIME_DIR%"
mkdir "%RUNTIME_DIR%" 2>nul
echo.

REM ============================================================
REM  1. Download and extract embeddable Python
REM ============================================================
echo ========================================
echo   [1/5] Setting up portable Python
echo ========================================
echo.
echo   Downloading Python %PYTHON_VERSION% embeddable...
echo   URL: %PYTHON_EMBED_URL%
echo.

set "PYTHON_ZIP=%RUNTIME_DIR%\python-embed.zip"
curl --fail -L --retry 3 --progress-bar -o "%PYTHON_ZIP%" "%PYTHON_EMBED_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download embeddable Python
    echo   Check your internet connection or Python version.
    pause
    exit /b 1
)

echo   Extracting to %PYTHON_DIR%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%PYTHON_ZIP%' -DestinationPath '%PYTHON_DIR%' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to extract Python archive
    pause
    exit /b 1
)
del "%PYTHON_ZIP%"

REM Verify python.exe exists
if not exist "%PYTHON_DIR%\python.exe" (
    echo   [FAIL] python.exe not found after extraction
    pause
    exit /b 1
)
echo   [OK] Python extracted

REM ============================================================
REM  1b. Configure embeddable Python for pip
REM ============================================================
echo.
echo   Configuring embeddable Python for pip...

REM Find the ._pth file (e.g. python314._pth)
set "PTH_FILE="
for %%f in ("%PYTHON_DIR%\python*._pth") do set "PTH_FILE=%%f"
if "!PTH_FILE!"=="" (
    echo   [FAIL] Could not find ._pth file in Python directory
    pause
    exit /b 1
)

REM Uncomment "import site" in the ._pth file
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pth = Get-ChildItem '%PYTHON_DIR%' -Filter 'python*._pth' | Select-Object -First 1; " ^
  "$content = Get-Content $pth.FullName; " ^
  "$newContent = $content -replace '^#import site', 'import site'; " ^
  "if ($content -eq $newContent) { Write-Host '  [WARN] Could not find #import site line; site-packages may not work.' } " ^
  "else { Write-Host '  [OK] Enabled site-packages in ' $pth.Name; $newContent | Set-Content $pth.FullName -Encoding ASCII }"
if %ERRORLEVEL% NEQ 0 (
    echo   [WARN] Failed to configure ._pth file; pip may not work
)

REM Create Lib\site-packages directory
mkdir "%PYTHON_DIR%\Lib\site-packages" 2>nul
echo   [OK] Created Lib\site-packages

REM ============================================================
REM  1c. Bootstrap pip into the portable Python
REM ============================================================
echo.
echo   Bootstrapping pip into portable Python...

set "GET_PIP_PATH=%RUNTIME_DIR%\get-pip.py"
curl --fail -L --retry 3 --progress-bar -o "%GET_PIP_PATH%" "%GET_PIP_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download get-pip.py
    pause
    exit /b 1
)

"%PYTHON_DIR%\python.exe" "%GET_PIP_PATH%" --no-warn-script-location
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to bootstrap pip
    pause
    exit /b 1
)
del "%GET_PIP_PATH%"
echo   [OK] pip bootstrapped

REM Verify pip works
"%PYTHON_DIR%\python.exe" -m pip --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [WARN] pip --version check failed; continuing anyway
) else (
    echo   [OK] pip verified
)

echo.
echo   [OK] Portable Python setup complete
echo.

REM ============================================================
REM  2. Install Python project dependencies
REM ============================================================
echo ========================================
echo   [2/5] Installing Python project deps
echo ========================================
echo.

set "REQUIREMENTS=%PROJECT_DIR%\backend\requirements.txt"
if not exist "%REQUIREMENTS%" (
    echo   [FAIL] requirements.txt not found: %REQUIREMENTS%
    pause
    exit /b 1
)

echo   Installing from %REQUIREMENTS%...
echo   This may take several minutes...
echo.

"%PYTHON_DIR%\python.exe" -m pip install ^
    -r "%REQUIREMENTS%" ^
    --no-warn-script-location
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [FAIL] Failed to install Python dependencies
    echo   Some packages may not have wheels for Python %PYTHON_VERSION%.
    echo   Try running: pip download -r requirements.txt -d .\pip-check
    echo   to see which packages are not available.
    pause
    exit /b 1
)

echo.
echo   [OK] Python dependencies installed

REM Verify key packages
echo.
echo   Verifying key packages...
"%PYTHON_DIR%\python.exe" -c "import fastapi, uvicorn, sqlalchemy, alembic, jose, pandas, numpy, openpyxl; print('  All key modules import OK')"
if %ERRORLEVEL% NEQ 0 (
    echo   [WARN] Some module imports failed; check the pip output above
) else (
    echo   [OK] All key modules verified
)
echo.

REM ============================================================
REM  3. Download and extract portable Node.js
REM ============================================================
echo ========================================
echo   [3/5] Setting up portable Node.js
echo ========================================
echo.
echo   Downloading Node.js %NODE_VERSION% portable...
echo   URL: %NODE_URL%
echo.

set "NODE_ZIP=%RUNTIME_DIR%\nodejs.zip"
curl --fail -L --retry 3 --progress-bar -o "%NODE_ZIP%" "%NODE_URL%"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to download Node.js
    pause
    exit /b 1
)

echo   Extracting Node.js...

REM Extract to a temp dir first, then move the inner folder to runtime\node
set "NODE_TEMP=%RUNTIME_DIR%\node-temp"
if exist "%NODE_TEMP%" rmdir /s /q "%NODE_TEMP%"
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%NODE_TEMP%' -Force"
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Failed to extract Node.js archive
    pause
    exit /b 1
)

REM Move the inner node-v* directory to runtime\node
for /d %%d in ("%NODE_TEMP%\node-v*") do (
    move "%%d" "%NODE_DIR%" >nul 2>&1
    goto :node_moved
)

REM Fallback: if no inner directory, move everything
move "%NODE_TEMP%" "%NODE_DIR%" >nul 2>&1

:node_moved
if exist "%NODE_TEMP%" rmdir /s /q "%NODE_TEMP%" 2>nul
del "%NODE_ZIP%" 2>nul

REM Verify node.exe
if not exist "%NODE_DIR%\node.exe" (
    REM Check one level deeper
    for /d %%d in ("%NODE_DIR%\node-v*") do (
        if exist "%%d\node.exe" (
            move "%%d\*" "%NODE_DIR%\" >nul 2>&1
            rmdir /s /q "%%d" 2>nul
        )
    )
)
if not exist "%NODE_DIR%\node.exe" (
    echo   [FAIL] node.exe not found after extraction
    pause
    exit /b 1
)

"%NODE_DIR%\node.exe" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [FAIL] Node.js executable is not runnable
    pause
    exit /b 1
)
echo   [OK] Node.js %NODE_VERSION% extracted and verified
echo.

REM ============================================================
REM  4. Install Node.js project dependencies
REM ============================================================
echo ========================================
echo   [4/5] Installing frontend project deps
echo ========================================
echo.

set "FRONTEND_DIR=%PROJECT_DIR%\frontend"
if not exist "%FRONTEND_DIR%\package.json" (
    echo   [FAIL] package.json not found: %FRONTEND_DIR%\package.json
    pause
    exit /b 1
)

echo   Running npm install using portable Node.js...
echo   This may take several minutes...
echo.

REM Add portable node to PATH for this session so npm can find it
set "PATH=%NODE_DIR%;%PATH%"

cd /d "%FRONTEND_DIR%"
call "%NODE_DIR%\npm.cmd" install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   [FAIL] npm install failed
    pause
    exit /b 1
)

cd /d "%PROJECT_DIR%"

echo.
echo   [OK] Frontend dependencies installed

REM Verify key packages
echo.
echo   Verifying node_modules...
if exist "%FRONTEND_DIR%\node_modules\vite\bin\vite.js" (
    echo   [OK] vite entry found
) else (
    echo   [WARN] vite entry not found
)
if exist "%FRONTEND_DIR%\node_modules\react" (
    echo   [OK] react found
) else (
    echo   [WARN] react not found
)
echo.

REM ============================================================
REM  5. Verify start.bat launcher
REM ============================================================
echo ========================================
echo   [5/5] Verifying launcher script
echo ========================================
echo.

set "START_BAT=%PROJECT_DIR%\start.bat"

if exist "%START_BAT%" (
    echo   [OK] start.bat found
    echo.
    echo   start.bat auto-detects portable runtime\ vs venv vs system
    echo   Python/Node.js. It works both for development and the
    echo   offline portable distribution.
) else (
    echo   [WARN] start.bat not found at project root.
    echo   The portable distribution needs start.bat to launch.
    echo   Make sure start.bat is committed in the repo.
)

REM ============================================================
REM  5b. Create runtime\setup-env.bat for manual PATH setup
REM ============================================================
set "ENV_BAT=%RUNTIME_DIR%\setup-env.bat"
(
echo @echo off
echo REM Add portable runtimes to current session PATH
echo REM Run this in a command prompt before manual startup:
echo REM   call runtime\setup-env.bat
echo set "RUNTIME_DIR=%%~dp0"
echo set "PATH=%%RUNTIME_DIR%%python;%%RUNTIME_DIR%%python\Scripts;%%RUNTIME_DIR%%node;%%PATH%%"
echo set "PYTHONPATH=%%RUNTIME_DIR%%..\backend"
echo echo Portable runtimes added to PATH. Python and Node.js are now available.
) > "%ENV_BAT%"
echo   [OK] Generated runtime\setup-env.bat

REM ============================================================
REM  Done
REM ============================================================
echo ========================================
echo   Portable runtime setup complete!
echo ========================================
echo.
echo   What was set up:
echo     runtime\python\      — Python %PYTHON_VERSION% + all deps
echo     runtime\node\        — Node.js %NODE_VERSION%
echo     frontend\node_modules\ — Frontend dependencies
echo     start.bat            — One-click offline launcher
echo.
echo   Project directory layout:
echo     %PROJECT_DIR%\
echo       runtime\            ← portable runtimes (NEW)
echo       backend\            ← Python source code
echo       frontend\           ← React source + node_modules
echo       start.bat           ← double-click to launch
echo.
echo   Next steps:
echo     1. Run scripts\pack-portable.bat to create a zip
echo        for distribution to offline computers.
echo.
echo     2. Copy the zip to the offline computer,
echo        extract anywhere, double-click start.bat.
echo.
echo   OR — to test locally right now:
echo     Double-click start.bat
echo.
pause
