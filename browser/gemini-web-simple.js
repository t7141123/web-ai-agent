// browser/gemini-web-simple.js
// 🧩 簡化版 Gemini Web 客戶端 - 專為 Telegram Bot 設計
//
// 功能：
// 1. 啟動瀏覽器（使用預設模型）
// 2. 輸入問題到對話框
// 3. 按 Enter 發送
// 4. 等待並取得回覆
//
// 特點：
// - 使用固定 selector，不依賴 AI 偵測
// - 移除複雜的進化、記憶系統
// - 專注於穩定的問答流程

import { chromium } from 'playwright';
import fs from 'fs-extra';

const GEMINI_URL = process.env.GEMINI_WEB_URL || 'https://gemini.google.com';
const TIMEOUT = parseInt(process.env.BROWSER_RESPONSE_TIMEOUT) || 90000;

// 固定 Selector（針對 Gemini 當前介面）
const SELECTORS = {
  input: 'div[contenteditable="true"][role="textbox"]',
  sendButton: 'button[aria-label*="Send" i], button[aria-label*="傳送" i]',
  response: 'div[data-message-role="model"]',
  responseText: '.markdown-content, div[data-message-content]',
  loading: 'mat-progress-bar, .loading-spinner, [aria-label*="loading" i]',
  newChat: 'a[href="/"]',
};

// 需要關閉的干擾元素
const DISMISS_BUTTONS = [
  'button:has-text("Got it")',
  'button:has-text("知道了")',
  'button:has-text("Accept all")',
  'button:has-text("Reject all")',
  'button[aria-label="Close"]',
  'button[aria-label="關閉"]',
  '[role="dialog"] button',
];

export class GeminiWebSimple {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  啟動瀏覽器
  // ══════════════════════════════════════════════════════════════════════════
  async launch(headless = false) {
    console.log('🌐 啟動瀏覽器...');
    
    try {
      this.browser = await chromium.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1280,900',
        ],
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        locale: 'zh-TW',
        timezoneId: 'Asia/Taipei',
      });

      // 隱藏 webdriver 特徵
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('✅ 瀏覽器啟動成功');
      return this;
    } catch (error) {
      console.error('❌ 瀏覽器啟動失敗:', error.message);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  開啟/重置對話
  // ══════════════════════════════════════════════════════════════════════════
  async openChat() {
    if (!this.browser) throw new Error('請先啟動瀏覽器');

    console.log('📄 開啟 Gemini 對話頁...');

    this.page = await this.context.newPage();
    
    await this.page.goto(GEMINI_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });

    // 等待頁面載入
    await this.page.waitForTimeout(5000);

    // 關閉所有干擾彈窗
    await this._dismissAll();

    // 等待輸入框出現
    try {
      await this.page.waitForSelector(SELECTORS.input, { timeout: 10000 });
      console.log('✅ 對話頁就緒');
      this.isReady = true;
      return true;
    } catch (error) {
      console.error('❌ 找不到輸入框:', error.message);
      this.isReady = false;
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  發送問題並取得回覆
  // ══════════════════════════════════════════════════════════════════════════
  async ask(question, timeout = TIMEOUT) {
    if (!this.isReady) {
      await this.openChat();
    }

    console.log(`📤 發送問題 (${question.length} 字元)...`);

    try {
      // 1. 找到輸入框
      const inputEl = this.page.locator(SELECTORS.input).first();
      await inputEl.waitFor({ state: 'visible', timeout: 10000 });
      
      // 2. 清空輸入框
      await inputEl.click();
      await this.page.waitForTimeout(200);
      await inputEl.press('Control+a');
      await inputEl.press('Backspace');
      await this.page.waitForTimeout(200);

      // 3. 輸入問題（模擬人類打字）
      await inputEl.pressSequentially(question, { delay: 10 });
      await this.page.waitForTimeout(500);

      // 4. 按 Enter 發送
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1000);

      console.log('⏳ 等待回覆...');

      // 5. 等待回覆
      const response = await this._waitForResponse(timeout);
      
      if (!response) {
        throw new Error('未收到回覆');
      }

      console.log(`📥 收到回覆 (${response.length} 字元)`);
      return {
        success: true,
        response: response,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ 發送失敗:', error.message);
      return {
        success: false,
        error: error.message,
        response: '',
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  等待並提取回覆
  // ══════════════════════════════════════════════════════════════════════════
  async _waitForResponse(timeout) {
    const startTime = Date.now();
    let lastResponse = '';
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
      await this.page.waitForTimeout(1000);

      // 檢查是否載入中
      const isLoading = await this.page.locator(SELECTORS.loading).isVisible({ timeout: 1000 })
        .catch(() => false);

      // 提取回覆
      const response = await this._extractResponse();
      
      if (response) {
        if (response === lastResponse) {
          stableCount++;
          // 內容穩定且沒有載入中，完成
          if (!isLoading && stableCount >= 2) {
            return response;
          }
          // 極度穩定，完成
          if (stableCount >= 5) {
            return response;
          }
        } else {
          stableCount = 0;
          lastResponse = response;
        }
      }

      // 載入完成且內容不為空
      if (!isLoading && lastResponse.length > 0) {
        return lastResponse;
      }
    }

    return lastResponse || '';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  提取回覆內容
  // ══════════════════════════════════════════════════════════════════════════
  async _extractResponse() {
    try {
      // 找所有回覆區塊
      const responses = this.page.locator(SELECTORS.response);
      const count = await responses.count();
      
      if (count === 0) return '';

      // 取最後一個回覆（最新的）
      const lastResponse = responses.last();
      
      // 嘗試提取文字
      const text = await lastResponse.innerText().catch(() => '');
      
      if (text.trim()) {
        return this._cleanText(text);
      }

      return '';
    } catch (error) {
      console.error('提取回覆失敗:', error.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  清理文字
  // ══════════════════════════════════════════════════════════════════════════
  _cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  關閉干擾彈窗
  // ══════════════════════════════════════════════════════════════════════════
  async _dismissAll() {
    for (const selector of DISMISS_BUTTONS) {
      try {
        const btn = this.page.locator(selector).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click();
          await this.page.waitForTimeout(300);
        }
      } catch {}
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  重置對話（新話題）
  // ══════════════════════════════════════════════════════════════════════════
  async resetChat() {
    console.log('🔄 重置對話...');
    
    try {
      const newChatBtn = this.page.locator(SELECTORS.newChat).first();
      if (await newChatBtn.isVisible({ timeout: 2000 })) {
        await newChatBtn.click();
        await this.page.waitForTimeout(2000);
        await this._dismissAll();
        console.log('✅ 對話已重置');
        return true;
      }
    } catch {}

    // 如果找不到新對話按鈕，重新開啟
    await this.openChat();
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  健康檢查
  // ══════════════════════════════════════════════════════════════════════════
  async healthCheck() {
    if (!this.page) return { healthy: false, reason: 'No page' };
    
    try {
      const hasInput = await this.page.locator(SELECTORS.input).isVisible({ timeout: 3000 });
      return {
        healthy: hasInput,
        url: this.page.url(),
        ready: this.isReady,
      };
    } catch {
      return { healthy: false, reason: 'Page error' };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  關閉瀏覽器
  // ══════════════════════════════════════════════════════════════════════════
  async close() {
    console.log('🔒 關閉瀏覽器...');
    
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isReady = false;
    
    console.log('✅ 已關閉');
  }
}
