// telegram/bot.js
// 🤖 Telegram Bot 整合
//
// 功能：
// 1. 接收 Telegram 訊息
// 2. 轉發給 Gemini Web
// 3. 回覆結果到 Telegram
//
// 指令：
// /start - 開始使用
// /help - 顯示說明
// /reset - 重置對話
// /status - 查看狀態

import TelegramBot from 'node-telegram-bot-api';
import { GeminiWebSimple } from '../browser/gemini-web-simple.js';
import fs from 'fs-extra';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS?.split(',') || [];

// 狀態管理
const USER_STATES = {};

export class TelegramBotService {
  constructor() {
    this.bot = null;
    this.gemini = null;
    this.isRunning = false;
    this.messageCount = 0;
    this.startTime = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  啟動服務
  // ══════════════════════════════════════════════════════════════════════════
  async start() {
    if (!TOKEN) {
      throw new Error('缺少 TELEGRAM_BOT_TOKEN，請在 .env 中設置');
    }

    console.log('🤖 啟動 Telegram Bot...');

    // 初始化 Gemini Web
    this.gemini = new GeminiWebSimple();
    await this.gemini.launch(process.env.BROWSER_MODE !== 'headed');
    await this.gemini.openChat();

    // 初始化 Telegram Bot
    this.bot = new TelegramBot(TOKEN, { polling: true });

    // 設置指令
    await this.bot.setMyCommands([
      { command: '/start', description: '開始使用' },
      { command: '/help', description: '顯示說明' },
      { command: '/reset', description: '重置對話' },
      { command: '/status', description: '查看狀態' },
    ]);

    // 註冊事件處理器
    this._registerHandlers();

    this.isRunning = true;
    this.startTime = new Date();

    console.log('✅ Telegram Bot 啟動成功');
    console.log(`   允許用戶：${ALLOWED_USERS.length > 0 ? ALLOWED_USERS.join(', ') : '所有人'}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  註冊事件處理器
  // ══════════════════════════════════════════════════════════════════════════
  _registerHandlers() {
    // /start 指令
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userName = msg.from.first_name || '使用者';

      if (!this._isAllowedUser(chatId)) {
        await this._sendMessage(chatId, '❌ 您沒有權限使用此機器人');
        return;
      }

      USER_STATES[chatId] = { state: 'active', lastActive: Date.now() };

      const welcomeMessage = `
👋 你好，${userName}！歡迎使用 Gemini AI 助手

💬 直接傳送訊息給我，我會轉發給 Gemini AI 並回覆你

📋 可用指令：
/help - 顯示說明
/reset - 重置對話
/status - 查看狀態

🚀 現在開始問我任何問題吧！
`;

      await this._sendMessage(chatId, welcomeMessage);
    });

    // /help 指令
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;

      if (!this._isAllowedUser(chatId)) return;

      const helpMessage = `
📖 使用說明

1️⃣ 直接傳送問題給我
   我會轉發給 Gemini AI 並回覆你

2️⃣ 支援的題目類型
   - 一般問答
   - 程式碼撰寫
   - 文章翻譯
   - 資料分析
   - 創意發想

3️⃣ 回應時間
   通常需要 10-30 秒，複雜問題可能更久

4️⃣ 注意事項
   - 請一次問一個問題
   - 避免過長的內容
   - 如有問題請使用 /reset

💡 提示：如果回應不理想，可以使用 /reset 重置對話
`;

      await this._sendMessage(chatId, helpMessage);
    });

    // /reset 指令
    this.bot.onText(/\/reset/, async (msg) => {
      const chatId = msg.chat.id;

      if (!this._isAllowedUser(chatId)) return;

      const loadingMsg = await this._sendMessage(chatId, '🔄 重置對話中...');

      try {
        await this.gemini.resetChat();
        USER_STATES[chatId] = { state: 'active', lastActive: Date.now() };
        await this.bot.editMessageText('✅ 對話已重置，現在可以開始新的話題了！', {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
        });
      } catch (error) {
        await this.bot.editMessageText('❌ 重置失敗，請稍後再試', {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
        });
      }
    });

    // /status 指令
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;

      if (!this._isAllowedUser(chatId)) return;

      const health = await this.gemini.healthCheck();
      const uptime = Math.round((Date.now() - this.startTime.getTime()) / 1000 / 60);

      const statusMessage = `
📊 系統狀態

🤖 機器人狀態：${this.isRunning ? '✅ 運行中' : '❌ 已停止'}
⏱️  運行時間：${uptime} 分鐘
💬 處理訊息：${this.messageCount} 則

🌐 Gemini 狀態：
   - 連接：${health.healthy ? '✅ 正常' : '⚠️ 異常'}
   - 就緒：${health.ready ? '✅ 就緒' : '⏳ 準備中'}
   - URL: ${health.url?.substring(0, 50) || '-'}

💡 如有問題請使用 /reset
`;

      await this._sendMessage(chatId, statusMessage);
    });

    // 一般訊息處理
    this.bot.on('message', async (msg) => {
      // 忽略指令
      if (msg.text?.startsWith('/')) return;

      const chatId = msg.chat.id;
      const userName = msg.from.first_name || '使用者';

      if (!this._isAllowedUser(chatId)) {
        await this._sendMessage(chatId, '❌ 您沒有權限使用此機器人');
        return;
      }

      // 處理文字訊息
      if (msg.text) {
        await this._handleTextMessage(chatId, userName, msg.text);
      }
      // 處理其他類型訊息
      else {
        await this._sendMessage(chatId, '❌ 目前只支援文字訊息，請直接輸入問題');
      }
    });

    // 錯誤處理
    this.bot.on('polling_error', (error) => {
      console.error('❌ Telegram Polling 錯誤:', error.message);
    });

    this.bot.on('error', (error) => {
      console.error('❌ Telegram Bot 錯誤:', error.message);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  處理文字訊息
  // ══════════════════════════════════════════════════════════════════════════
  async _handleTextMessage(chatId, userName, text) {
    console.log(`📨 [Telegram] ${userName}: ${text.substring(0, 50)}...`);

    // 發送「正在處理」提示
    const thinkingMsg = await this._sendMessage(chatId, '🤔 正在思考中...');

    try {
      // 更新用戶狀態
      USER_STATES[chatId] = { state: 'active', lastActive: Date.now() };

      // 發送問題給 Gemini
      const result = await this.gemini.ask(text);

      // 移除「正在處理」提示
      await this.bot.deleteMessage(chatId, thinkingMsg.message_id);

      if (result.success) {
        console.log(`✅ [Telegram] 回覆：${result.response.substring(0, 50)}...`);

        // 分割長訊息（Telegram 限制 4096 字元）
        const chunks = this._splitMessage(result.response);

        for (const chunk of chunks) {
          await this._sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
          await this._delay(500);
        }

        this.messageCount++;
      } else {
        console.error(`❌ [Telegram] Gemini 失敗：${result.error}`);
        await this._sendMessage(chatId, `❌ 處理失敗：${result.error}\n\n請稍後再試或使用 /reset 重置`);
      }
    } catch (error) {
      console.error('❌ [Telegram] 處理訊息失敗:', error.message);
      await this.bot.editMessageText('❌ 處理失敗，請稍後再試', {
        chat_id: chatId,
        message_id: thinkingMsg.message_id,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  工具函數
  // ══════════════════════════════════════════════════════════════════════════

  // 檢查是否為允許的用戶
  _isAllowedUser(chatId) {
    if (ALLOWED_USERS.length === 0) return true; // 無人限制=所有人可用
    return ALLOWED_USERS.includes(String(chatId));
  }

  // 發送訊息
  async _sendMessage(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        disable_web_page_preview: true,
        ...options,
      });
    } catch (error) {
      console.error('❌ 發送訊息失敗:', error.message);
      return null;
    }
  }

  // 分割長訊息
  _splitMessage(text, maxLength = 4000) {
    const chunks = [];
    let current = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if ((current + line + '\n').length > maxLength) {
        chunks.push(current);
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }

    if (current.trim()) {
      chunks.push(current);
    }

    return chunks;
  }

  // 延遲
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  停止服務
  // ══════════════════════════════════════════════════════════════════════════
  async stop() {
    console.log('🛑 停止 Telegram Bot...');

    this.isRunning = false;

    if (this.bot) {
      await this.bot.stopPolling();
    }

    if (this.gemini) {
      await this.gemini.close();
    }

    console.log('✅ Telegram Bot 已停止');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  獲取狀態
  // ══════════════════════════════════════════════════════════════════════════
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: this.startTime ? Math.round((Date.now() - this.startTime.getTime()) / 1000) : 0,
      messageCount: this.messageCount,
      geminiReady: this.gemini?.isReady || false,
    };
  }
}
