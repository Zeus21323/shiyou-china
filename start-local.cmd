@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js and reopen this file.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\package.json" (
  echo Dependencies are missing. Run npm ci in this folder first.
  pause
  exit /b 1
)
echo Open http://localhost:3000/ in your browser after the server is ready.
echo No ChatGPT login is needed. Keep this window open while using the site.
powershell -NoProfile -File "%~dp0scripts\check-local-lock.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
call npm run dev -- --host 127.0.0.1
if errorlevel 1 pause
