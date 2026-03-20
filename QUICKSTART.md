# 🚀 快速開始指南

## 一分鐘設置

### 步驟 1: 安裝依賴 (30 秒)

```bash
npm install
```

### 步驟 2: 取得 Telegram Bot Token (1 分鐘)

1. 打開 Telegram，搜尋 **@BotFather**
2. 傳送 `/newbot`
3. 輸入機器人名稱：`My Gemini AI`
4. 輸入機器人 username：`my_gemini_test_bot`（必須以 `bot` 結尾）
5. 複製 BotFather 給你的 Token

### 步驟 3: 配置環境 (30 秒)

```bash
cp .env.simple.example .env
```

編輯 `.env`，填入你的 Token：

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### 步驟 4: 啟動服務 (10 秒)

```bash
npm run start:simple
```

### 步驟 5: 在 Telegram 測試 (10 秒)

1. 在 Telegram 搜尋你的機器人
2. 傳送 `/start`
3. 傳送 `你好`
4. 等待 AI 回覆（約 10-30 秒）

## ✅ 完成！

現在你可以：
- 隨時隨地透過 Telegram 與 AI 對話
- 使用 `/help` 查看說明
- 使用 `/reset` 重置對話
- 使用 `/status` 查看狀態

## 📱 使用場景

### 場景 1: 快速問答
```
你：什麼是量子力學？
AI: [Gemini 的回覆]
```

### 場景 2: 程式碼協助
```
你：如何用 Python 讀取 CSV 文件？
AI: [包含程式碼的詳細回覆]
```

### 場景 3: 翻譯
```
你：請將這段英文翻譯成中文：Hello, how are you?
AI: 你好，你好嗎？
```

## 🛠️ 常見問題

### Q: 機器人沒有回應？
A: 檢查：
1. Bot Token 是否正確
2. 網路連線是否正常
3. 終端機是否有錯誤訊息

### Q: 回應很慢？
A: 正常現象，Gemini Web 需要 10-30 秒回應時間

### Q: 如何停止服務？
A: 在終端機按 `Ctrl+C` 或輸入 `quit`

### Q: 如何關閉瀏覽器視窗？
A: 在 `.env` 中設置 `BROWSER_MODE=headless`

## 📖 詳細文檔

查看 [README-SIMPLE.md](README-SIMPLE.md) 了解更多配置選項和進階用法。
