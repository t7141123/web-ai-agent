# setup.ps1 — GOLEM Agent Windows PowerShell 安裝腳本
# 執行方式（以系統管理員執行 PowerShell）:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
#   .\setup.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # 加速下載

# ── 顏色函數 ─────────────────────────────────────────────────────
function Write-Ok($msg)   { Write-Host "  ✅  $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  →   $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "  ⚠   $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ❌  $msg" -ForegroundColor Red }
function Write-Step($n, $t) {
    Write-Host ""
    Write-Host "[$n/6] $t" -ForegroundColor White -BackgroundColor DarkBlue
}

# ── Banner ────────────────────────────────────────────────────────
Clear-Host
Write-Host @"
  ██████╗  ██████╗ ██╗     ███████╗███╗   ███╗
 ██╔════╝ ██╔═══██╗██║     ██╔════╝████╗ ████║
 ██║  ███╗██║   ██║██║     █████╗  ██╔████╔██║
 ██║   ██║██║   ██║██║     ██╔══╝  ██║╚██╔╝██║
 ╚██████╔╝╚██████╔╝███████╗███████╗██║ ╚═╝ ██║
  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚═╝
"@ -ForegroundColor Cyan

Write-Host "  零成本自主 AI 智能體 — Windows 安裝程式" -ForegroundColor White
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ════════════════════════════════════════════════
# 步驟 1 — 檢查 / 安裝 Node.js
# ════════════════════════════════════════════════
Write-Step 1 "檢查 / 安裝 Node.js"

function Install-NodeJS {
    # 方法 1：winget（Windows 11 / 更新的 Windows 10）
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "使用 winget 安裝 Node.js LTS..."
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        # 重新整理 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path","User")
        if (Get-Command node -ErrorAction SilentlyContinue) { return $true }
    }

    # 方法 2：直接下載 MSI 安裝
    Write-Info "下載 Node.js 安裝程式..."
    $nodeUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    $msiPath = "$env:TEMP\nodejs_installer.msi"

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
        Write-Info "安裝中（可能需要 1-2 分鐘）..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait
        Remove-Item $msiPath -ErrorAction SilentlyContinue

        # 重新整理 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path","User")
        return $true
    } catch {
        return $false
    }
}

$needNode = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = (node --version).TrimStart('v')
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    if ($nodeMajor -lt 18) {
        Write-Warn "Node.js $nodeVer 版本過舊（需要 18+），更新中..."
        $needNode = $true
    } else {
        Write-Ok "Node.js v$nodeVer"
    }
} else {
    $needNode = $true
}

if ($needNode) {
    Write-Info "安裝 Node.js LTS..."
    $installed = Install-NodeJS
    if (-not $installed -or -not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js 安裝失敗"
        Write-Host ""
        Write-Host "  請手動安裝 Node.js:" -ForegroundColor Yellow
        Write-Host "  https://nodejs.org/en/download" -ForegroundColor Cyan
        Write-Host ""
        Read-Host "  按 Enter 退出"
        exit 1
    }
    Write-Ok "Node.js $(node --version) 安裝完成"
}

# ════════════════════════════════════════════════
# 步驟 2 — npm 套件
# ════════════════════════════════════════════════
Write-Step 2 "安裝套件依賴"
Set-Location $ScriptDir

try {
    Write-Info "執行 npm install..."
    npm install --silent 2>$null
    Write-Ok "套件安裝完成"
} catch {
    Write-Warn "重試中..."
    npm cache clean --force 2>$null
    npm install
    Write-Ok "套件安裝完成（重試）"
}

# ════════════════════════════════════════════════
# 步驟 3 — Playwright + Chromium
# ════════════════════════════════════════════════
Write-Step 3 "安裝 Chromium 瀏覽器（自動化用）"
Write-Info "首次安裝約需 1-3 分鐘..."

try {
    npx playwright install chromium 2>$null
    Write-Ok "Chromium 就緒"
} catch {
    Write-Warn "嘗試備用方式..."
    try {
        npx playwright install chromium
        Write-Ok "Chromium 就緒（備用方式）"
    } catch {
        Write-Warn "Chromium 安裝失敗，如有 Chrome 仍可使用"
    }
}

# ════════════════════════════════════════════════
# 步驟 4 — 設定 .env
# ════════════════════════════════════════════════
Write-Step 4 "設定環境"

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Info "已建立 .env"
} else {
    Write-Ok ".env 已存在"
}

# 建立目錄
@("browser","memory","projects","logs") | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}
Write-Ok "目錄結構就緒"

# 設定 API Key
$envContent = Get-Content ".env" -Raw
if ($envContent -match "your_gemini_api_key_here") {
    Write-Host ""
    Write-Host "  ╔════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "  ║  需要設定 Gemini API Key（完全免費）              ║" -ForegroundColor Yellow
    Write-Host "  ║  1. 前往：https://aistudio.google.com/app/apikey  ║" -ForegroundColor Yellow
    Write-Host "  ║  2. 點擊「Create API Key」                        ║" -ForegroundColor Yellow
    Write-Host "  ║  3. 複製後貼到下方                                ║" -ForegroundColor Yellow
    Write-Host "  ╚════════════════════════════════════════════════════╝" -ForegroundColor Yellow
    Write-Host ""

    $apiKey = Read-Host "  請貼上 API Key（Enter 跳過）"
    if ($apiKey -and $apiKey.Length -gt 10) {
        $envContent = $envContent -replace "your_gemini_api_key_here", $apiKey
        Set-Content ".env" $envContent -Encoding UTF8
        Write-Ok "API Key 已儲存"
    } else {
        Write-Warn "跳過 API Key 設定，請稍後手動編輯 .env"
    }
} else {
    Write-Ok "API Key 已設定"
}

# ════════════════════════════════════════════════
# 步驟 5 — 建立啟動腳本
# ════════════════════════════════════════════════
Write-Step 5 "建立快速啟動"

"@echo off`r`nchcp 65001 >nul`r`ncd /d `"%~dp0`"`r`nnode index.js`r`npause" | Set-Content "start.bat" -Encoding ASCII
"@echo off`r`nchcp 65001 >nul`r`ncd /d `"%~dp0`"`r`nnode scripts/login.js`r`npause" | Set-Content "login.bat" -Encoding ASCII
Write-Ok "start.bat + login.bat 已建立"

# ════════════════════════════════════════════════
# 步驟 6 — Gemini 登入
# ════════════════════════════════════════════════
Write-Step 6 "Gemini 網頁版登入"

Write-Host ""
Write-Host "  不需要 Google 帳號，以訪客身份直接使用 Gemini" -ForegroundColor Cyan
$doTest = Read-Host "  立即開啟瀏覽器測試訪客模式連線? [Y/n]"
if ($doTest -ne 'n' -and $doTest -ne 'N') {
    Write-Info "開啟瀏覽器驗證訪客模式..."
    node scripts/login.js
    Write-Ok "連線驗證完成"
} else {
    Write-Warn "跳過，直接執行 start.bat 或 npm start"
}

# ════════════════════════════════════════════════
# 完成
# ════════════════════════════════════════════════
Write-Host ""
Write-Host "  ══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "    🎉 GOLEM Agent 安裝完成！" -ForegroundColor Green
Write-Host "  ══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  啟動方式：" -ForegroundColor White
Write-Host "    雙擊 start.bat          " -NoNewline -ForegroundColor Cyan
Write-Host "# 最簡單" -ForegroundColor DarkGray
Write-Host "    npm start               " -NoNewline -ForegroundColor Cyan
Write-Host "# 命令列" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  對話範例（啟動後輸入）：" -ForegroundColor White
Write-Host "    你 → 幫我寫一個 Python 爬蟲" -ForegroundColor DarkGray
Write-Host "    你 → build 一個 Express.js API" -ForegroundColor DarkGray
Write-Host "    你 → auto 分析最新 AI 框架趨勢" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  按 Enter 啟動 GOLEM..."
node index.js
