# Gemini Web AI Agent (Telegram Bot 版本)

🧩 這是一個簡化的 Gemini Web AI Agent，透過 Telegram Bot 與用戶互動，類似 OpenClaw 的功能，但使用 **Gemini Web 免費版本**。

## ✨ 功能特點

- ✅ **完全免費** - 使用 Gemini Web 訪客模式，不需要 API Key
- ✅ **Telegram 整合** - 透過 Telegram Bot 與 AI 互動
- ✅ **使用預設模型** - 直接進入對話，不選擇特定模型
- ✅ **簡單架構** - 移除複雜的進化、記憶系統，專注於問答流程
- ✅ **固定 Selector** - 使用硬編碼的 UI 選擇器，穩定可靠

## 📋 系統需求

- Node.js >= 18.0.0
- npm 或 yarn
- Telegram 帳號

## 🚀 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 取得 Telegram Bot Token

1. 在 Telegram 搜尋 **@BotFather**
2. 傳送 `/newbot` 建立新機器人
3. 輸入機器人名稱（例如：`My Gemini AI`）
4. 輸入機器人 username（必須以 `bot` 結尾，例如：`my_gemini_ai_bot`）
5. BotFather 會回覆一個 Token，格式類似：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### 3. 配置環境

複製配置範例：

```bash
cp .env.simple.example .env
```

編輯 `.env` 文件，填入您的 Bot Token：

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

（可選）限制允許使用的用戶：

```env
TELEGRAM_ALLOWED_USERS=123456789,987654321
```

### 4. 啟動服務

```bash
npm run start:simple
```

### 5. 在 Telegram 中使用

1. 在 Telegram 搜尋您的機器人（使用您設定的 username）
2. 傳送 `/start` 開始使用
3. 直接輸入問題，AI 會轉發給 Gemini 並回覆您

## 📱 Telegram 指令

| 指令 | 說明 |
|------|------|
| `/start` | 開始使用機器人 |
| `/help` | 顯示使用說明 |
| `/reset` | 重置對話（開始新話題） |
| `/status` | 查看系統狀態 |

## 🏃 運行模式

### 有視窗模式（預設）
可以看到瀏覽器運作，方便除錯：

```env
BROWSER_MODE=headed
```

### 背景模式
在伺服器上運行時使用無視窗模式：

```env
BROWSER_MODE=headless
```

## 📁 檔案結構

```
web-ai-agent/
├── index-simple.js           # 主程式入口（簡化版）
├── browser/
│   └── gemini-web-simple.js  # Gemini Web 客戶端（簡化版）
├── telegram/
│   └── bot.js                # Telegram Bot 服務
├── package.json              # 依賴配置
└── .env.simple.example       # 環境配置範例
```

## 🔄 工作流程

```
用戶 (Telegram)
    ↓
Telegram Bot
    ↓
Gemini Web (瀏覽器自動化)
    ↓
Gemini AI 回覆
    ↓
Telegram Bot
    ↓
用戶 (Telegram)
```

## ⚙️ 進階配置

### 調整回應超時時間

如果 Gemini 回應較慢，可以增加超時時間：

```env
BROWSER_RESPONSE_TIMEOUT=120000  # 120 秒
```

### 限制訪問用戶

只允許特定的 Telegram 用戶使用：

```env
TELEGRAM_ALLOWED_USERS=123456789,987654321
```

獲取 Telegram Chat ID 的方法：
1. 傳送訊息給 @userinfobot
2. 它會回覆您的 Chat ID

## 🛠️ 故障排除

### 瀏覽器無法啟動

確保已安裝 Playwright 瀏覽器：

```bash
npx playwright install chromium
```

### Bot 無法接收訊息

檢查 Bot Token 是否正確，並確認 Bot 已經啟動。

### Gemini 回應失敗

1. 檢查網路連線
2. 嘗試使用 `/reset` 重置對話
3. 查看日誌了解詳細錯誤

### 被 Gemini 阻擋

Gemini 可能會偵測自動化流量並阻擋。解決方法：

1. 使用 `/reset` 重置對話
2. 等待幾分鐘後重試
3. 考慮使用 `BROWSER_MODE=headed` 模式

## 📝 注意事項

1. **免費限制** - Gemini Web 訪客模式有使用限制，避免短時間內大量請求
2. **會話持久性** - 瀏覽器會話在重啟後會重置
3. **回應時間** - 通常需要 10-30 秒，複雜問題可能更久
4. **只支援文字** - 目前只支援文字訊息，不支援圖片、語音等

## 🔧 開發

### 開發模式（自動重啟）

```bash
npm run dev:simple
```

### 查看日誌

日誌會輸出到終端機和 `logs/` 目錄。

## 📄 授權

本專案基於原 GOLEM Agent 架構簡化而成。

## 🙏 致謝

- Original: [GOLEM Agent](https://github.com/)
- Playwright: https://playwright.dev/
- Telegram Bot API: https://core.telegram.org/bots/api
- Gemini: https://gemini.google.com
