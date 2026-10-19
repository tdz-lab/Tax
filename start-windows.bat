@echo off
title AU Tax and Trading Ledger
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo First run: installing and building - this needs internet once and takes a few minutes...
  call npm install
  call npm run build
)
node scripts\serve.mjs
pause
