// browser/selector-discovery.js
// 🔍 Selector 自動偵測引擎
//
// 當硬編碼的 selector 失效時，透過三種策略依序嘗試找到正確元素：
//
//  策略 1 — 語意候選清單  : 內建大量可能的 selector 逐一試驗
//  策略 2 — DOM 啟發式分析: 掃描頁面 DOM 結構，用特徵推斷元素位置
//  策略 3 — Flash API 視覺推理: 截圖 + 呼叫 Gemini Flash 分析 HTML，讓 AI 直接告訴我們 selector
//
// 找到後自動寫入快取檔，下次直接讀取，不需重複偵測。

import fs from 'fs-extra';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Logger } from '../core/logger.js';

const CACHE_PATH   = './browser/selectors.cache.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 快取 7 天

let lastAIFailureTime = 0;
const AI_COOLDOWN_MS = 60 * 1000; // 429 後冷卻 1 分鐘

// ── 各元素的語意候選 selector 清單（從最具體到最寬泛）──────────────────────
const CANDIDATES = {

  // 輸入框：contenteditable 區域
  input: [
    // Quill editor（目前版本）
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor',
    'rich-textarea div[contenteditable="true"]',
    // 通用 contenteditable
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"].input-area',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    // textarea 備用
    'textarea[placeholder]',
    'textarea.message-input',
    // Shadow DOM 穿透（自定義元素）
    'bard-sidenav-container p-element',
    'chat-input div[contenteditable]',
    // 最寬泛
    '[contenteditable="true"]',
  ],

  // 發送按鈕
  sendButton: [
    'button[aria-label="Send message"]',
    'button[aria-label="傳送訊息"]',
    'button[aria-label="送信"]',
    '.send-button-container button',
    '.input-buttons-wrapper-bottom button',
    'button.send-button',
    'button[data-test-id="send-button"]',
    'button[jsname*="send"]',
    'mat-icon-button[aria-label*="send" i]',
    '.send-button-container',
  ],

  // AI 回應區塊
  responseBlock: [
    'model-response',
    '[data-response-index]',
    '.model-response',
    'message-content[data-role="model"]',
    '.response-container',
    '[class*="response"][class*="model"]',
    '[class*="model"][class*="response"]',
    'div[data-message-role="model"]',
    '.chat-message.model',
    '.bard-response',
  ],

  // 回應文字內容
  responseText: [
    'model-response .markdown',
    'model-response .response-content',
    'model-response p',
    '[data-response-index] .markdown',
    '.model-response-text',
    '.response-text',
    'message-content[data-role="model"] .text',
    '.response-container .text-content',
    '.markdown-container',
    '.message-content',
    'div.message-content',
    '[data-message-author-role="assistant"]',
    '.conversation-container .message-content',
  ],

  // Loading 指示器（等待回應時出現）
  loadingIndicator: [
    '.loading-indicator',
    '.thinking-indicator',
    '[aria-label*="loading" i]',
    '[aria-label*="thinking" i]',
    '.loading-dots',
    'progress-indicator',
    '.typing-indicator',
    '[class*="loading"]',
    '[class*="thinking"]',
    'mat-progress-bar',
    'circle.loading',
    '.loading-indicator-container',
    'div[aria-label*="loading" i]',
    'div[aria-label*="thinking" i]',
  ],

  // 新對話按鈕
  newChatButton: [
    'a[href="/"]',
    'button[aria-label="New chat"]',
    'button[aria-label="新交談"]',
    'button[aria-label*="new" i][aria-label*="chat" i]',
    '[data-test-id="new-chat"]',
    'a.new-conversation',
    'button.new-chat',
    'sidenav-item:first-child',
    '[jsname*="new_chat"]',
    'button:has(span:text-is("New chat"))',
    'button:has(span:text-is("新交談"))',
    'a[data-navigation-id="new_chat"]',
  ],

  // 模型選擇器（Gemini 3 新增）
  modelSelector: [
    'button[aria-label*="模型選擇" i]',
    'button[aria-label*="Model selector" i]',
    '.model-selector-button',
    'button:has-text("快捷")',
    'button:has-text("思考型")',
    'button:has-text("Pro")',
    'header button:has(span:text-is("快捷"))',
  ],
};

// ── 啟發式特徵（DOM 分析用）─────────────────────────────────────────────────
const HEURISTICS = {
  input: {
    // 找到 contenteditable + 在頁面底部區域｀
    evaluate: (el) => {
      if (!el.contentEditable || el.contentEditable !== 'true') return 0;
      const rect = el.getBoundingClientRect();
      const viewH = window.innerHeight;
      // 輸入框通常在頁面下半部
      const inBottomHalf = rect.top > viewH * 0.5;
      const hasSize = rect.width > 100 && rect.height > 20;
      return (inBottomHalf ? 2 : 0) + (hasSize ? 1 : 0);
    }
  },
  sendButton: {
    evaluate: (el) => {
      if (el.tagName !== 'BUTTON') return 0;
      const rect = el.getBoundingClientRect();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const hasSendKeyword = /send|submit|傳送|送出/.test(aria);
      const inBottomRight = rect.right > window.innerWidth * 0.6 && rect.top > window.innerHeight * 0.5;
      return (hasSendKeyword ? 3 : 0) + (inBottomRight ? 1 : 0);
    }
  },
  responseBlock: {
    evaluate: (el) => {
      const tag  = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'textarea') return 0;
      
      const role = el.getAttribute('data-role') || el.getAttribute('role') || '';
      const cls  = el.className || '';
      const txt  = el.innerText || '';
      
      const hasModelRole = /model|assistant|ai|response/.test(role + cls);
      const hasText      = txt.length > 20;
      const isRichText   = el.querySelector('.markdown, .response-content, p') !== null;
      
      // 回應區塊通常很大
      const rect = el.getBoundingClientRect();
      const hasSize = rect.width > 200 && rect.height > 40;
      
      let score = 0;
      if (hasModelRole) score += 5;
      if (hasText)      score += 2;
      if (isRichText)   score += 3;
      if (hasSize)      score += 1;
      
      return score;
    }
  }
};

export class SelectorDiscovery {
  constructor(apiKey) {
    this.logger = new Logger('SelectorDiscovery');
    this.cache  = null;
    this.genAI  = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this.model  = this.genAI?.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    });
  }

  // ── 主入口：取得指定元素的有效 selector ──────────────────────────────────
  // elementType: 'input' | 'sendButton' | 'responseBlock' | 'responseText' | ...
  async getSelector(page, elementType) {
    // 1. 先查快取
    const cached = await this._fromCache(elementType);
    if (cached) {
      // 快速驗證快取是否還有效
      const stillValid = await this._validate(page, cached);
      if (stillValid) {
        this.logger.debug(`✅ [快取命中] ${elementType}: ${cached}`);
        return cached;
      }
      this.logger.info(`⚠️  快取失效，重新偵測: ${elementType}`);
    }

    this.logger.info(`🔍 開始偵測 selector: ${elementType}`);

    // 2. 候選清單掃描
    const fromCandidates = await this._scanCandidates(page, elementType);
    if (fromCandidates) {
      this.logger.info(`✅ [候選清單] ${elementType}: ${fromCandidates}`);
      await this._saveCache(elementType, fromCandidates);
      return fromCandidates;
    }

    // 3. DOM 啟發式分析
    const fromHeuristics = await this._domHeuristics(page, elementType);
    if (fromHeuristics) {
      this.logger.info(`✅ [啟發式] ${elementType}: ${fromHeuristics}`);
      await this._saveCache(elementType, fromHeuristics);
      return fromHeuristics;
    }

    // 4. Flash API 視覺推理（最後手段，消耗少量 token）
    if (this.model) {
      const fromAI = await this._aiInference(page, elementType);
      if (fromAI) {
        this.logger.info(`✅ [AI推理] ${elementType}: ${fromAI}`);
        await this._saveCache(elementType, fromAI);
        return fromAI;
      }
    }

    this.logger.error(`❌ 無法偵測 selector: ${elementType}`);
    return null;
  }

  // ── 取得所有關鍵 selector（一次性全部偵測）──────────────────────────────
  async discoverAll(page) {
    const keys    = ['input', 'sendButton', 'responseBlock', 'responseText', 'loadingIndicator', 'newChatButton', 'modelSelector'];
    const results = {};

    this.logger.info('🔍 開始全面偵測所有 selector...');

    for (const key of keys) {
      results[key] = await this.getSelector(page, key);
      // 短暫停頓，避免過快掃描
      await page.waitForTimeout(200);
    }

    const found   = Object.values(results).filter(Boolean).length;
    const missing = keys.filter(k => !results[k]);

    this.logger.info(`📊 偵測完成: ${found}/${keys.length} 成功` + (missing.length ? ` | 失敗: ${missing.join(', ')}` : ''));

    return results;
  }

  // ── 策略 1：逐一試驗候選清單 ─────────────────────────────────────────────
  async _scanCandidates(page, elementType) {
    const candidates = CANDIDATES[elementType] || [];

    for (const sel of candidates) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          const el = page.locator(sel).first();
          const visible = await el.isVisible({ timeout: 1000 });
          if (visible) return sel;
        }
      } catch {
        // selector 語法錯誤或超時，繼續下一個
      }
    }
    return null;
  }

  // ── 策略 2：DOM 啟發式分析 ───────────────────────────────────────────────
  async _domHeuristics(page, elementType) {
    const heuristic = HEURISTICS[elementType];
    if (!heuristic) return null;

    try {
      // 在瀏覽器中執行啟發式函數，找最高分的元素
      const result = await page.evaluate((heuristicFnStr) => {
        const fn = new Function('el', `return (${heuristicFnStr})(el)`);
        let best = null;
        let bestScore = 0;

        // 掃描所有可互動元素
        const candidates = document.querySelectorAll(
          'button, input, textarea, [contenteditable], div[role], [data-role], [aria-label]'
        );

        for (const el of candidates) {
          try {
            const score = fn(el);
            if (score > bestScore) {
              bestScore = score;
              best = el;
            }
          } catch {}
        }

        if (!best || bestScore < 3) return null;

        // 生成這個元素的 selector
        return generateSelector(best);

        function generateSelector(el) {
          // 優先用 id
          if (el.id) return `#${CSS.escape(el.id)}`;

          // 用 data 屬性
          const dataAttrs = ['data-test-id', 'data-testid', 'data-role', 'jsname'];
          for (const attr of dataAttrs) {
            const val = el.getAttribute(attr);
            if (val) return `[${attr}="${CSS.escape(val)}"]`;
          }

          // 用 aria-label
          const aria = el.getAttribute('aria-label');
          if (aria && aria.length < 50) return `[aria-label="${aria}"]`;

          // 用 tag + class 組合
          const tag = el.tagName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (classes) return `${tag}.${classes}`;
          }

          return tag;
        }
      }, heuristic.evaluate.toString());

      return result;
    } catch (e) {
      this.logger.debug('啟發式分析失敗:', e.message);
      return null;
    }
  }

  // ── 策略 3：Flash API 視覺推理 ───────────────────────────────────────────
  async _aiInference(page, elementType) {
    if (Date.now() - lastAIFailureTime < AI_COOLDOWN_MS) {
      this.logger.debug(`跳過 AI 推理 (冷卻中...)`);
      return null;
    }

    this.logger.info(`🤖 使用 Flash API 推理 selector: ${elementType}`);

    try {
      // 截取頁面截圖
      const screenshot = await page.screenshot({
        type: 'jpeg', quality: 60, fullPage: false
      });

      // 同時取得簡化的 DOM 結構
      const domSnapshot = await this._getDomSnapshot(page);

      const prompt = `
你是一個網頁自動化專家。我需要找到 Gemini AI 聊天介面中「${elementType}」元素的 CSS selector。

## 要找的元素類型
${this._describeElement(elementType)}

## 頁面 DOM 結構（簡化）
\`\`\`html
${domSnapshot}
\`\`\`

## 任務
分析 DOM 結構，找出最可靠的 CSS selector 來定位「${elementType}」元素。

## 回應格式（只輸出 JSON，不加任何說明）
{
  "selector": "最佳 CSS selector",
  "confidence": 0.9,
  "reasoning": "為什麼選這個"
}
`;

      // 發送給 Flash API（包含截圖）
      const result = await this.model.generateContent([
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: screenshot.toString('base64')
          }
        },
        { text: prompt }
      ]);

      const raw  = result.response.text();
      const json = this._extractJSON(raw);

      if (json?.selector && json.confidence > 0.5) {
        // 驗證 AI 推薦的 selector 是否真的存在
        const valid = await this._validate(page, json.selector);
        if (valid) return json.selector;
      }

      return null;
    } catch (e) {
      if (e.message.includes('429')) {
        this.logger.warn('AI 推理遭遇 429 限制，進入冷卻模式');
        lastAIFailureTime = Date.now();
      } else {
        this.logger.warn('AI 推理失敗:', e.message);
      }
      return null;
    }
  }

  // ── 取得簡化的 DOM 快照 ──────────────────────────────────────────────────
  async _getDomSnapshot(page) {
    return page.evaluate(() => {
      function snapshot(el, depth = 0, maxDepth = 6) {
        if (depth > maxDepth) return '';
        if (!el || el.nodeType !== 1) return '';

        const tag  = el.tagName.toLowerCase();
        const skip = ['script', 'style', 'head', 'meta', 'link', 'svg', 'path'];
        if (skip.includes(tag)) return '';

        const attrs = [];
        const important = ['id', 'class', 'role', 'aria-label', 'contenteditable',
                           'data-role', 'data-test-id', 'jsname', 'type', 'placeholder'];
        for (const a of important) {
          const v = el.getAttribute(a);
          if (v) attrs.push(`${a}="${v.substring(0, 60)}"`);
        }

        const attrStr  = attrs.length ? ' ' + attrs.join(' ') : '';
        const indent   = '  '.repeat(depth);
        const children = Array.from(el.children)
          .map(c => snapshot(c, depth + 1, maxDepth))
          .filter(Boolean)
          .join('\n');

        if (!children && !el.textContent?.trim()) return '';

        const text = el.childNodes.length === 1 && el.firstChild?.nodeType === 3
          ? ` "${el.textContent.trim().substring(0, 30)}"`
          : '';

        return children
          ? `${indent}<${tag}${attrStr}>\n${children}\n${indent}</${tag}>`
          : `${indent}<${tag}${attrStr}${text}/>`;
      }

      // 只取 body 的關鍵部分
      return snapshot(document.body).substring(0, 6000);
    });
  }

  // ── 驗證 selector 是否可用 ───────────────────────────────────────────────
  async _validate(page, selector) {
    try {
      const count = await page.locator(selector).count();
      return count > 0;
    } catch {
      return false;
    }
  }

  // ── 快取管理 ─────────────────────────────────────────────────────────────
  async _fromCache(elementType) {
    if (!this.cache) {
      try {
        this.cache = await fs.readJSON(CACHE_PATH);
      } catch {
        this.cache = { version: 1, selectors: {}, updatedAt: {} };
      }
    }

    const entry     = this.cache.selectors?.[elementType];
    const updatedAt = this.cache.updatedAt?.[elementType] || 0;
    const age       = Date.now() - updatedAt;

    // 快取過期
    if (!entry || age > CACHE_TTL_MS) return null;
    return entry;
  }

  async _saveCache(elementType, selector) {
    if (!this.cache) this.cache = { version: 1, selectors: {}, updatedAt: {} };
    this.cache.selectors[elementType]  = selector;
    this.cache.updatedAt[elementType]  = Date.now();
    this.cache.lastDiscovered          = new Date().toISOString();

    await fs.ensureDir('./browser');
    await fs.writeJSON(CACHE_PATH, this.cache, { spaces: 2 });
  }

  // 強制清除快取（手動觸發重新偵測）
  async clearCache() {
    this.cache = { version: 1, selectors: {}, updatedAt: {} };
    await fs.writeJSON(CACHE_PATH, this.cache, { spaces: 2 });
    this.logger.info('🗑️  Selector 快取已清除');
  }

  // 顯示目前快取狀態
  async showCacheStatus() {
    await this._fromCache('_init'); // 確保已載入
    const cache = this.cache || {};
    const now   = Date.now();
    const rows  = Object.entries(cache.selectors || {}).map(([k, v]) => {
      const age  = Math.round((now - (cache.updatedAt?.[k] || 0)) / 3600000);
      const ttl  = Math.round(CACHE_TTL_MS / 3600000);
      const status = age < ttl ? '✅' : '⚠️ 過期';
      return { element: k, selector: v, age: `${age}h`, status };
    });
    return rows;
  }

  // ── 元素描述（給 AI 看的）────────────────────────────────────────────────
  _describeElement(elementType) {
    const descriptions = {
      input:            '用戶輸入訊息的文字框。通常是一個 contenteditable div 或 textarea，位於頁面底部中央。',
      sendButton:       '發送訊息的按鈕。通常是一個帶有送出圖示的按鈕，緊鄰輸入框右側。',
      responseBlock:    'AI 回應的容器元素。包含 AI 生成的文字內容，每次對話後會新增一個。',
      responseText:     'AI 回應的實際文字內容元素。在回應容器內，包含格式化的 Markdown 文字。',
      loadingIndicator: '正在生成回應時顯示的載入動畫或進度指示器。',
      newChatButton:    '開始新對話的按鈕，通常在側邊欄頂部。',
      modelSelector:    '模型選擇器按鈕，顯示當前使用的模型（如：快捷、思考型、Pro）。',
    };
    return descriptions[elementType] || `「${elementType}」互動元素`;
  }

  _extractJSON(text) {
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const start   = cleaned.indexOf('{');
      const end     = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      return JSON.parse(cleaned.substring(start, end + 1));
    } catch {
      return null;
    }
  }
}
