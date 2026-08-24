@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo Installing dependencies if needed...
call npm install
echo Starting workshop app...
call npm run dev
pause
