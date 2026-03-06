@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title GOLEM Agent — 安裝程式

:: ════════════════════════════════════════════════════════════
::  GOLEM Agent v3.1 — Windows 一鍵安裝腳本
::  支援 Windows 10 / 11
:: ════════════════════════════════════════════════════════════

echo.
echo  ██████╗  ██████╗ ██╗     ███████╗███╗   ███╗
echo ██╔════╝ ██╔═══██╗██║     ██╔════╝████╗ ████║
echo ██║  ███╗██║   ██║██║     █████╗  ██╔████╔██║
echo ██║   ██║██║   ██║██║     ██╔══╝  ██║╚██╔╝██║
echo ╚██████╔╝╚██████╔╝███████╗███████╗██║ ╚═╝ ██║
echo  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚═╝
echo.
echo  零成本自主 AI 智能體 - Windows 安裝程式
echo  ══════════════════════════════════════════
echo.

:: ── 步驟 1：檢查 Node.js ─────────────────────────────────────
echo [1/5] 檢查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ⚠  未偵測到 Node.js，正在自動安裝...
    echo.

    :: 嘗試用 winget 安裝（Windows 10/11 內建）
    winget --version >nul 2>&1
    if %errorlevel% equ 0 (
        echo  → 使用 winget 安裝 Node.js LTS...
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 goto :nodejs_manual
    ) else (
        goto :nodejs_manual
    )

    :: 重新整理 PATH
    call :refresh_path
    node --version >nul 2>&1
    if %errorlevel% neq 0 goto :nodejs_manual
    goto :nodejs_ok
)

:nodejs_manual
echo.
echo  ╔════════════════════════════════════════════════════╗
echo  ║  無法自動安裝 Node.js，請手動安裝：               ║
echo  ║                                                    ║
echo  ║  1. 前往 https://nodejs.org                       ║
echo  ║  2. 下載 LTS 版本並安裝                           ║
echo  ║  3. 重新開啟此視窗，再次執行 setup.bat            ║
echo  ╚════════════════════════════════════════════════════╝
echo.
pause
exit /b 1

:nodejs_ok
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo  ✅ Node.js %NODE_VER% 已就緒

:: ── 步驟 2：安裝 npm 套件 ────────────────────────────────────
echo.
echo [2/5] 安裝套件依賴...
call npm install --silent
if %errorlevel% neq 0 (
    echo  ❌ npm install 失敗，嘗試清除快取後重試...
    call npm cache clean --force
    call npm install
    if %errorlevel% neq 0 (
        echo  ❌ 安裝失敗，請檢查網路連線
        pause
        exit /b 1
    )
)
echo  ✅ 套件安裝完成

:: ── 步驟 3：安裝 Playwright 瀏覽器 ──────────────────────────
echo.
echo [3/5] 安裝 Chromium 瀏覽器（供自動化使用）...
echo  （首次安裝約需 1-3 分鐘，請耐心等待）
call npx playwright install chromium --with-deps
if %errorlevel% neq 0 (
    echo  ⚠  自動安裝失敗，嘗試備用方式...
    call npx playwright install chromium
    if %errorlevel% neq 0 (
        echo  ⚠  Chromium 安裝失敗，將使用系統 Chrome
        echo  （如果你有安裝 Chrome，程式仍可正常執行）
    )
)
echo  ✅ 瀏覽器就緒

:: ── 步驟 4：設定環境設定檔 ───────────────────────────────────
echo.
echo [4/5] 設定環境...
if not exist .env (
    copy .env.example .env >nul
    echo  📄 已建立 .env 設定檔
) else (
    echo  ✅ .env 已存在，跳過
)

:: 檢查 API Key 是否已設定
findstr /c:"your_gemini_api_key_here" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo  ╔════════════════════════════════════════════════════╗
    echo  ║  需要設定 Gemini API Key（免費）                  ║
    echo  ║                                                    ║
    echo  ║  1. 前往：https://aistudio.google.com/app/apikey  ║
    echo  ║  2. 點擊「Create API Key」取得免費 Key            ║
    echo  ║  3. 複製 Key 後貼到下方                           ║
    echo  ╚════════════════════════════════════════════════════╝
    echo.
    set /p "API_KEY=  請貼上你的 Gemini API Key: "

    if "!API_KEY!"=="" (
        echo  ⚠  跳過 API Key 設定，之後請手動編輯 .env
    ) else (
        :: 寫入 API Key 到 .env
        powershell -Command "(Get-Content .env) -replace 'your_gemini_api_key_here', '!API_KEY!' | Set-Content .env"
        echo  ✅ API Key 已儲存
    )
) else (
    echo  ✅ API Key 已設定
)

:: 建立必要目錄
if not exist browser mkdir browser
if not exist memory mkdir memory
if not exist projects mkdir projects
if not exist logs mkdir logs

:: ── 步驟 5：完成 ─────────────────────────────────────────────
echo.
echo [5/5] 建立快速啟動捷徑...
:: 建立 start.bat 快速啟動
echo @echo off > start.bat
echo chcp 65001 ^>nul >> start.bat
echo node index.js >> start.bat
echo. >> start.bat
echo  ✅ 已建立 start.bat 快速啟動

echo.
echo  ══════════════════════════════════════════════════════
echo   ✅ 安裝完成！
echo  ══════════════════════════════════════════════════════
echo.

:: 檢查是否需要登入
if not exist browser\session.json (
    echo  下一步：登入 Gemini 網頁版（只需一次）
    echo.
    echo  ┌─────────────────────────────────────────┐
    echo  │  執行登入程序？（建議：是）              │
    echo  └─────────────────────────────────────────┘
    set /p "DO_LOGIN=  立即測試訪客模式? [Y/n]: "
    if /i "!DO_LOGIN!" neq "n" (
        echo.
        echo  🌐 開啟瀏覽器，驗證訪客模式連線...
        node scripts/login.js
    )
) else (
    echo  ✅ 訪客模式，直接可用
)

echo.
echo  ┌──────────────────────────────────────┐
echo  │  啟動 GOLEM Agent：                  │
echo  │                                      │
echo  │    雙擊 start.bat                    │
echo  │    或執行: node index.js             │
echo  └──────────────────────────────────────┘
echo.
pause
goto :eof

:: 重新整理環境變數（讓新安裝的程式生效）
:refresh_path
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USR_PATH=%%b"
set "PATH=%SYS_PATH%;%USR_PATH%"
goto :eof
