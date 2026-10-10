@echo off
cd /d "%~dp0"
echo.
echo Image Studio запускается на http://127.0.0.1:3210
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
echo.
if not exist "node_modules\undici\package.json" (
    echo Устанавливаю локальную зависимость для поддержки прокси...
    call npm.cmd install
    if errorlevel 1 (
        echo Не удалось установить зависимости.
        pause
        exit /b 1
    )
)
node server.mjs
pause
