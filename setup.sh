#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  GOLEM Agent v3.1 — macOS / Linux 一鍵安裝腳本
#  支援: macOS 12+, Ubuntu 20.04+, Debian 11+, Fedora 36+,
#        Arch Linux, CentOS/RHEL 8+
# ════════════════════════════════════════════════════════════════

set -euo pipefail

# ── 顏色定義 ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✅  $*${RESET}"; }
info() { echo -e "  ${CYAN}→   $*${RESET}"; }
warn() { echo -e "  ${YELLOW}⚠   $*${RESET}"; }
err()  { echo -e "  ${RED}❌  $*${RESET}"; }
step() { echo -e "\n${BOLD}[$1/6] $2${RESET}"; }

# ── Banner ────────────────────────────────────────────────────────
clear
echo -e "${CYAN}${BOLD}"
cat << 'BANNER'
  ██████╗  ██████╗ ██╗     ███████╗███╗   ███╗
 ██╔════╝ ██╔═══██╗██║     ██╔════╝████╗ ████║
 ██║  ███╗██║   ██║██║     █████╗  ██╔████╔██║
 ██║   ██║██║   ██║██║     ██╔══╝  ██║╚██╔╝██║
 ╚██████╔╝╚██████╔╝███████╗███████╗██║ ╚═╝ ██║
  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚═╝
BANNER
echo -e "${RESET}"
echo -e "  ${BOLD}零成本自主 AI 智能體${RESET} — 安裝程式"
echo -e "  ${DIM}$(uname -s) / $(uname -m)${RESET}"
echo -e "  ══════════════════════════════════════════"

# 偵測作業系統
OS="$(uname -s)"
ARCH="$(uname -m)"
DISTRO=""
PKG_MGR=""

if [[ "$OS" == "Linux" ]]; then
    if   command -v apt-get &>/dev/null; then PKG_MGR="apt";    DISTRO="debian"
    elif command -v dnf     &>/dev/null; then PKG_MGR="dnf";    DISTRO="fedora"
    elif command -v yum     &>/dev/null; then PKG_MGR="yum";    DISTRO="rhel"
    elif command -v pacman  &>/dev/null; then PKG_MGR="pacman"; DISTRO="arch"
    elif command -v zypper  &>/dev/null; then PKG_MGR="zypper"; DISTRO="suse"
    fi
elif [[ "$OS" == "Darwin" ]]; then
    DISTRO="macos"
fi

info "作業系統: $OS ($DISTRO) | 架構: $ARCH"

# ════════════════════════════════════════════════════════════════
#  步驟 1 — 安裝系統依賴
# ════════════════════════════════════════════════════════════════
step 1 "安裝系統依賴"

install_sys_dep() {
    local pkg="$1"
    case "$PKG_MGR" in
        apt)    sudo apt-get install -y "$pkg" -qq ;;
        dnf)    sudo dnf install -y "$pkg" -q ;;
        yum)    sudo yum install -y "$pkg" -q ;;
        pacman) sudo pacman -S --noconfirm "$pkg" ;;
        zypper) sudo zypper install -y "$pkg" ;;
    esac
}

# macOS：確保 Homebrew 存在
if [[ "$DISTRO" == "macos" ]]; then
    if ! command -v brew &>/dev/null; then
        info "安裝 Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # 設定 PATH for Apple Silicon
        if [[ "$ARCH" == "arm64" ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
    ok "Homebrew 就緒"
fi

# Linux：確保 curl, git, build-essential 存在
if [[ "$OS" == "Linux" ]]; then
    if ! command -v curl &>/dev/null; then
        info "安裝 curl..."
        install_sys_dep curl
    fi
    if ! command -v git &>/dev/null; then
        info "安裝 git..."
        install_sys_dep git
    fi
    ok "系統工具就緒"
fi

# ════════════════════════════════════════════════════════════════
#  步驟 2 — 安裝 Node.js
# ════════════════════════════════════════════════════════════════
step 2 "檢查 / 安裝 Node.js"

install_nodejs() {
    info "安裝 Node.js LTS..."

    case "$DISTRO" in
        macos)
            brew install node@20
            brew link --overwrite node@20 2>/dev/null || true
            ;;
        debian)
            # NodeSource 官方 repo（最可靠）
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null
            sudo apt-get install -y nodejs -qq
            ;;
        fedora|rhel)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>/dev/null
            sudo ${PKG_MGR} install -y nodejs
            ;;
        arch)
            sudo pacman -S --noconfirm nodejs npm
            ;;
        suse)
            sudo zypper install -y nodejs20
            ;;
        *)
            # 通用：使用 nvm 安裝
            info "使用 nvm 安裝..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            nvm install --lts
            nvm use --lts
            ;;
    esac
}

# 檢查 Node.js 版本（需要 18+）
if command -v node &>/dev/null; then
    NODE_VER=$(node --version | tr -d 'v')
    NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
    if [[ "$NODE_MAJOR" -lt 18 ]]; then
        warn "Node.js $NODE_VER 版本過舊（需要 18+），重新安裝..."
        install_nodejs
    else
        ok "Node.js v$NODE_VER 已就緒"
    fi
else
    install_nodejs
    # 重新載入 PATH
    export PATH="/usr/local/bin:/usr/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"
    if ! command -v node &>/dev/null; then
        # 嘗試從 Homebrew 載入
        [[ -f /opt/homebrew/bin/node ]] && export PATH="/opt/homebrew/bin:$PATH"
        [[ -f /usr/local/bin/node ]] && export PATH="/usr/local/bin:$PATH"
    fi
fi

node --version &>/dev/null || { err "Node.js 安裝失敗，請手動安裝: https://nodejs.org"; exit 1; }
ok "Node.js $(node --version)"

# ════════════════════════════════════════════════════════════════
#  步驟 3 — 安裝 npm 套件
# ════════════════════════════════════════════════════════════════
step 3 "安裝 npm 套件依賴"

cd "$(dirname "$0")"  # 確保在專案目錄

npm install --silent 2>/dev/null || {
    warn "npm install 失敗，清除快取後重試..."
    npm cache clean --force 2>/dev/null
    npm install
}
ok "npm 套件安裝完成"

# ════════════════════════════════════════════════════════════════
#  步驟 4 — 安裝 Playwright + Chromium
# ════════════════════════════════════════════════════════════════
step 4 "安裝 Chromium 瀏覽器（自動化用）"
info "首次安裝約需 1-3 分鐘，請耐心等待..."

# Linux 需要額外的系統依賴
if [[ "$OS" == "Linux" ]]; then
    case "$PKG_MGR" in
        apt)
            # 安裝 Playwright 的 Linux 系統依賴
            sudo apt-get install -y \
                libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
                libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
                libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
                libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 \
                -qq 2>/dev/null || true
            ;;
    esac
fi

npx playwright install chromium 2>/dev/null || {
    warn "帶依賴安裝失敗，嘗試基礎安裝..."
    npx playwright install chromium 2>/dev/null || warn "Chromium 安裝可能不完整，如有問題執行: npx playwright install chromium"
}
ok "Chromium 就緒"

# ════════════════════════════════════════════════════════════════
#  步驟 5 — 設定 .env
# ════════════════════════════════════════════════════════════════
step 5 "設定環境"

if [[ ! -f ".env" ]]; then
    cp .env.example .env
    info "已建立 .env 設定檔"
else
    ok ".env 已存在，跳過"
fi

# 建立必要目錄
mkdir -p browser memory projects logs
ok "目錄結構建立完成"

# 檢查是否已設定 API Key
if grep -q "your_gemini_api_key_here" .env 2>/dev/null; then
    echo ""
    echo -e "  ${BOLD}╔════════════════════════════════════════════════════╗${RESET}"
    echo -e "  ${BOLD}║  需要設定 Gemini API Key（完全免費）              ║${RESET}"
    echo -e "  ${BOLD}║                                                    ║${RESET}"
    echo -e "  ${BOLD}║  1. 前往：https://aistudio.google.com/app/apikey  ║${RESET}"
    echo -e "  ${BOLD}║  2. 點擊「Create API Key」取得 Key                ║${RESET}"
    echo -e "  ${BOLD}║  3. 複製後貼到下方                                ║${RESET}"
    echo -e "  ${BOLD}╚════════════════════════════════════════════════════╝${RESET}"
    echo ""
    read -rp "  請貼上你的 Gemini API Key（直接 Enter 跳過）: " API_KEY
    if [[ -n "$API_KEY" ]]; then
        # 跨平台 sed（macOS 的 sed 語法不同）
        if [[ "$DISTRO" == "macos" ]]; then
            sed -i '' "s|your_gemini_api_key_here|$API_KEY|g" .env
        else
            sed -i "s|your_gemini_api_key_here|$API_KEY|g" .env
        fi
        ok "API Key 已儲存到 .env"
    else
        warn "跳過 API Key 設定，請之後手動編輯 .env"
    fi
else
    ok "API Key 已設定"
fi

# ════════════════════════════════════════════════════════════════
#  步驟 6 — 建立啟動腳本 + 登入
# ════════════════════════════════════════════════════════════════
step 6 "建立啟動腳本"

# 建立 start.sh
cat > start.sh << 'SH'
#!/usr/bin/env bash
cd "$(dirname "$0")"
node index.js
SH
chmod +x start.sh
ok "已建立 start.sh"

# ── 完成摘要 ──────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}${BOLD}  ✅ 安裝完成！${RESET}"
echo -e "  ${GREEN}${BOLD}══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${CYAN}不需要 Google 帳號，以訪客身份直接使用 Gemini${RESET}"
echo ""

info "開啟瀏覽器驗證訪客模式..."
node scripts/login.js

echo ""
echo -e "  ${BOLD}啟動方式：${RESET}"
echo -e "    ${CYAN}./start.sh${RESET}        ${DIM}# macOS/Linux${RESET}"
echo -e "    ${CYAN}npm start${RESET}         ${DIM}# 通用${RESET}"
echo ""
