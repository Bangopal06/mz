@echo off
REM ============================================================
REM start-services.bat — Auto-start semua service WA Broadcast CRM
REM ============================================================

echo [1/3] Starting Redis...
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="1" (
  start "" /min "C:\laragon\bin\redis\redis-x64-5.0.14.1\redis-server.exe" "%~dp0redis.conf"
  timeout /t 3 /nobreak >nul
  echo     Redis started.
) else (
  echo     Redis already running.
)

echo [2/3] Starting Gateway via PM2...
cd /d "%~dp0apps\gateway"
call npx pm2 resurrect 2>nul
call npx pm2 start ecosystem.config.cjs --update-env 2>nul
call npx pm2 save 2>nul
cd /d "%~dp0"

echo [3/3] Starting Next.js Web...
start "" cmd /k "cd /d %~dp0 && npm run dev:web"

echo.
echo All services started!
echo   Web    -^> http://localhost:3000
echo   Gateway -^> http://localhost:3001
echo   Redis  -^> localhost:6379
