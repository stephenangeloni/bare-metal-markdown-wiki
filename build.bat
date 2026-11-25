@echo off
REM Offline snapshot of articles\ -> data.js. No network, no server. Runs build.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
exit /b %errorlevel%
