@echo off
setlocal

rem Normal entry point: hand off to the hidden VBS launcher and close this console.
wscript.exe "%~dp0run.vbs"
exit /b %ERRORLEVEL%
