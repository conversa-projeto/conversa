@echo off
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

taskkill /F /IM nginx.exe >nul 2>&1
wt cmd /k "cd /d "%BASE%\nginx" && nginx.exe"
timeout /t 1 >nul

taskkill /F /IM mediamtx.exe >nul 2>&1
wt -w 0 new-tab -d "%BASE%\mediamtx" cmd /k mediamtx.exe mediamtx.yml
timeout /t 1 >nul

taskkill /F /IM conversa.rest.exe >nul 2>&1
wt -w 0 new-tab -d "%BASE%" cmd /k conversa.rest.exe
timeout /t 1 >nul