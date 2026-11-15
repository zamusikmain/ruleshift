@echo off
title RULESHIFT
cd /d "%~dp0"

echo.
echo ========================================
echo             RULESHIFT
echo ========================================
echo.
echo Game:
echo http://127.0.0.1:5173/
echo.
echo Starting RULESHIFT...
echo Press CTRL+C to stop.
echo ========================================
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:5173/"

npm run dev

pause