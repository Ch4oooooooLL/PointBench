@echo off
setlocal enabledelayedexpansion
title test-point-web

REM ============================================================
REM  test-point-web — Portable Runtime Launcher
REM  Double-click to start. No installation required.
REM
REM  Auto-detects portable runtime\ or falls back to system
REM  Python / Node.js.
REM ============================================================

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

REM --- Detect Python ---
set "PYTHON_EXE="
if exist "%PROJECT_DIR%\runtime\python\python.exe" (
    set "PYTHON_EXE=%PROJECT_DIR%\runtime\python\python.exe"
    set "PYTHON_SCRIPTS=%PROJECT_DIR%\runtime\python\Scripts"
    set "USING_PORTABLE_PYTHON=1"
) else if exist "%PROJECT_DIR%\backend\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%PROJECT_DIR%\backend\.venv\Scripts\python.exe"
    set "USING_VENV=1"
) else (
    set "PYTHON_EXE=python"
    set "USING_SYSTEM_PYTHON=1"
)

REM --- Detect Node.js ---
set "NODE_EXE="
set "NODE_DIR="
if exist "%PROJECT_DIR%\runtime\node\node.exe" (
    set "NODE_EXE=%PROJECT_DIR%\runtime\node\node.exe"
    set "NODE_DIR=%PROJECT_DIR%\runtime\node"
    set "USING_PORTABLE_NODE=1"
) else (
    set "NODE_EXE=node"
    set "USING_SYSTEM_NODE=1"
)

REM --- Add to PATH as needed ---
if defined USING_PORTABLE_PYTHON (
    set "PATH=%PROJECT_DIR%\runtime\python;%PYTHON_SCRIPTS%;%PATH%"
)
if defined USING_PORTABLE_NODE (
    set "PATH=%NODE_DIR%;%PATH%"
)
set "PYTHONPATH=%PROJECT_DIR%\backend"

echo ========================================
echo   test-point-web — Starting...
echo ========================================
echo.
echo   Project: %PROJECT_DIR%
echo.

REM --- Verify runtimes ---
echo   --- Runtime detection ---
if defined USING_PORTABLE_PYTHON (
    echo   Python:  portable ^(runtime\python\python.exe^)
) else if defined USING_VENV (
    echo   Python:  venv ^(backend\.venv^)
) else (
    echo   Python:  system ^(python^)
)

if defined USING_PORTABLE_NODE (
    echo   Node.js: portable ^(runtime\node\node.exe^)
) else (
    echo   Node.js: system ^(node^)
)
echo.

REM --- Quick validation ---
"%PYTHON_EXE%" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Python is not runnable: %PYTHON_EXE%
    pause
    exit /b 1
)

"%NODE_EXE%" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Node.js is not runnable: %NODE_EXE%
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%\frontend\node_modules\vite\bin\vite.js" (
    echo   [ERROR] Frontend dependencies not found.
    echo   Run: cd frontend ^&^& npm install
    pause
    exit /b 1
)

echo   [OK] All runtimes verified
echo.

REM --- Start backend ---
echo   Starting backend on http://localhost:8000 ...
set "BACKEND_CMD=cd /d "%PROJECT_DIR%\backend" && "%PYTHON_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "PointBench Backend" /MIN cmd /c "%BACKEND_CMD%"

REM --- Start frontend ---
echo   Starting frontend on http://localhost:5173 ...
set "FRONTEND_CMD=cd /d "%PROJECT_DIR%\frontend" && "%NODE_EXE%" node_modules\vite\bin\vite.js --host 0.0.0.0"
start "PointBench Frontend" /MIN cmd /c "%FRONTEND_CMD%"

REM --- Wait for services ---
echo   Waiting for services to start...
timeout /t 5 /nobreak >nul

REM --- Open browser ---
echo   Opening browser...
start http://localhost:5173

echo.
echo ========================================
echo   test-point-web is running!
echo ========================================
echo.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo.
echo   --- Runtime in use ---
if defined USING_PORTABLE_PYTHON (
    echo   Python:  portable ^(runtime\python\python.exe^)
) else if defined USING_VENV (
    echo   Python:  venv ^(backend\.venv^)
) else (
    echo   Python:  system ^(from PATH^)
)
if defined USING_PORTABLE_NODE (
    echo   Node.js: portable ^(runtime\node\node.exe^)
) else (
    echo   Node.js: system ^(from PATH^)
)
echo.
echo   Close the backend/frontend windows
echo   or press Ctrl+C in each to stop.
echo.
echo   Press any key in THIS window to
echo   stop all services...
pause >nul

REM --- Cleanup ---
echo.
echo   Stopping services...
taskkill /FI "WINDOWTITLE eq PointBench Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq PointBench Frontend*" /T /F >nul 2>&1
echo   Services stopped.
pause
