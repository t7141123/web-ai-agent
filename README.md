# 🤖 GOLEM Agent v3.1 — 零成本自主 AI 智能體

> **一鍵安裝 · 跨平台 · 零成本**
> Playwright 操控 Gemini 網頁版 × Flash API 智能路由 × 自動修復 Selector

---

## ⚡ 一鍵安裝

### Windows
```cmd
# 方法 1：雙擊執行（最簡單）
setup.bat

# 方法 2：PowerShell（功能更完整）
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
.\setup.ps1
```

### macOS / Linux
```bash
chmod +x setup.sh && ./setup.sh
```

### 已有 Node.js（任何平台）
```bash
node setup/install.js
```

安裝程式會自動完成：
- ✅ 偵測並安裝 Node.js 18+（如未安裝）
- ✅ 安裝所有 npm 套件
- ✅ 下載 Chromium 瀏覽器
- ✅ 建立 .env 設定檔並引導設定 API Key
- ✅ 引導完成 Gemini 網頁版登入

---

## 🚀 啟動

```bash
# Windows
start.bat  或  npm start

# macOS / Linux
./start.sh  或  npm start
```

---

## 💬 使用範例

啟動後直接輸入：

```
你 → 你好！幫我解釋什麼是 REST API
  → [Flash API] 180ms

你 → 幫我寫一個完整的 Express.js 用戶認證 API
  → [網頁版·免費] 12340ms

你 → build 一個 Python FastAPI + SQLite 任務管理系統
  → 自動建立完整專案...

你 → auto 研究 2025 年最熱門的 AI 框架，整理成比較表
  → 自主執行多步驟任務...
```

### 所有指令

| 指令 | 說明 |
|------|------|
| `auto <目標>` | 自主模式，自動規劃並完成複雜目標 |
| `build <描述>` | 一鍵建立完整軟體專案 |
| `selectors` | 查看 Gemini UI selector 快取狀態 |
| `rediscover` | 強制重新偵測所有 selector（Google 改版後用）|
| `headed` | 下次開啟瀏覽器時顯示視窗 |
| `headless` | 下次開啟瀏覽器時背景執行 |
| `stats` | 路由統計（API vs 免費網頁版比例）|
| `memory` | 查看記憶庫 |
| `clear` | 清除對話歷史 |
| `exit` | 退出並關閉瀏覽器 |

---

## 🏗️ 系統架構

```
用戶輸入
   │
   ▼
SmartRouter（複雜度評估）
   │
   ├─ 簡單任務 ──→ Gemini Flash API（極低成本）
   │
   └─ 複雜任務 ──→ Playwright 控制 Chrome
                   │
                   ▼
             gemini.google.com（完全免費）
                   │
                   ▼
          SelectorDiscovery 自動偵測
          ┌─ 策略1: 候選清單掃描（最快）
          ├─ 策略2: DOM 啟發式分析
          └─ 策略3: Flash API 視覺推理（最後手段）
```

---

## ⚙️ 進階設定

編輯 `.env`：

```env
# 路由閾值（0=全用API, 1=全用免費網頁版）
COMPLEXITY_THRESHOLD=0.6

# 瀏覽器模式
BROWSER_MODE=headed   # 有視窗 | headless=背景

# 使用更強的思考模型
GEMINI_MODEL=gemini-2.0-flash-thinking-exp
```

---

## 🔧 故障排除

**Chromium 無法啟動（Linux）**
```bash
npx playwright install-deps chromium
```

**Selector 失效（Google 更新了 Gemini 介面）**
```
你 → rediscover
```

**Session 過期（需重新登入）**
```bash
npm run login   # 或 login.sh / login.bat
```

**Windows 執行政策錯誤**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

---

## 📁 檔案結構

```
golem-agent/
├── setup.bat          # Windows 一鍵安裝
├── setup.ps1          # Windows PowerShell 安裝（功能更完整）
├── setup.sh           # macOS/Linux 一鍵安裝
├── setup/
│   └── install.js     # 跨平台 Node.js 安裝主程式
├── index.js           # 主程式入口
├── core/
│   ├── brain.js       # 思考引擎
│   ├── agent.js       # 自主循環協調器
│   ├── executor.js    # 工具執行器
│   ├── memory.js      # 持久記憶系統
│   └── logger.js      # 日誌
├── browser/
│   ├── gemini-web.js        # Playwright 控制器
│   └── selector-discovery.js # 自動偵測引擎
├── router/
│   └── smart-router.js   # 智能路由（API/Web 動態切換）
├── scripts/
│   └── login.js       # 首次登入腳本
├── .env.example       # 設定範本
└── README.md
```
