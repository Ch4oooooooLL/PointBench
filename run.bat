@echo off
setlocal

rem Keep this legacy entry point aligned with the portable launcher.
call "%~dp0start.bat"
exit /b %ERRORLEVEL%
