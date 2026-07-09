@echo off
setlocal

rem Compatibility entry point. The portable package launches from the project root.
call "%~dp0..\start.bat"
exit /b %ERRORLEVEL%
