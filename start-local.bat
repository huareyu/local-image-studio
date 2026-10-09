@echo off
cd /d "%~dp0"
echo.
echo Image Studio запускается на http://127.0.0.1:3210
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
echo.
node server.mjs
pause
