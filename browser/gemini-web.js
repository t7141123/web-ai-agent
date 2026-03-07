// browser/gemini-web.js  (v4.2)
//
// 變更：
//  - 優先使用系統已安裝的 Chrome（channel: 'chrome'），失敗才退回 Playwright Chromium
//  - _openFreshTab：偵測不到 input 時不立刻關閉分頁，改為等待重試（最多 3 次，每次多等 3 秒）
//  - 移除 _openFreshTab 失敗時的截圖，改成成功開啟後讓用戶自己看

import { chromium }          from 'playwright';
import fs                    from 'fs-extra';
import { Logger }            from '../core/logger.js';
import { SelectorDiscovery } from './selector-discovery.js';

const GEMINI_URL = process.env.GEMINI_WEB_URL             || 'https://gemini.google.com';
const TIMEOUT    = parseInt(process.env.BROWSER_RESPONSE_TIMEOUT) || 60000;

// ── 阻擋偵測訊號 ──────────────────────────────────────────────────────────────
const BLOCKER = {
  urls: [
    'accounts.google.com',
    '/ServiceLogin',
    'consent.google.com',
  ],
  domSelectors: [
    'a[href*="accounts.google.com/signin"]',
    'button[data-action="signin"]',
    '.error-state',
    '[class*="error-page"]',
    '[class*="quota-exceeded"]',
  ],
  bodyText: [
    "Something went wrong",
    "Unable to load",
    "You've reached your limit",
    "Request blocked",
    "Try again later",
  ],
};

// ── 干擾 UI 自動關閉清單 ──────────────────────────────────────────────────────
const DISMISS = [
  '#L2AGLb',
  'button:has-text("Accept all")',
  'button:has-text("Reject all")',
  'button[aria-label*="Accept"]',
  'button:has-text("Continue without an account")',
  'button:has-text("Continue as guest")',
  'button:has-text("No thanks")',
  'button:has-text("Not now")',
  'button:has-text("Skip")',
  'button:has-text("繼續")',
  'button:has-text("略過")',
  'a:has-text("Continue without signing in")',
  'button[aria-label="Close"]',
  'button[aria-label="關閉"]',
];

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
];

export class GeminiWebClient {
  constructor(apiKey = null) {
    this.logger    = new Logger('GeminiWeb');
    this.browser   = null;
    this.context   = null;
    this.page      = null;
    this.sel       = {};
    this.isReady   = false;
    this.tabSeq    = 0;
    this.discovery = new SelectorDiscovery(apiKey || process.env.GEMINI_API_KEY);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  啟動瀏覽器
  //  策略：優先用系統 Chrome → 失敗退回 Playwright 內建 Chromium
  // ══════════════════════════════════════════════════════════════════════════
  async launch(forceVisible = false) {
    const headless = forceVisible ? false : (process.env.BROWSER_MODE !== 'headed');
    await fs.ensureDir('./browser');

    // 嘗試用系統 Chrome
    const useSysChrome = process.env.USE_SYSTEM_CHROME !== 'false';
    if (useSysChrome) {
      try {
        this.logger.info(`🌐 嘗試啟動系統 Chrome (${headless ? 'headless' : 'headed'})...`);
        this.browser = await chromium.launch({
          channel: 'chrome',   // 使用電腦已安裝的 Google Chrome
          headless,
          args: BROWSER_ARGS,
        });
        this.logger.info('✅ 使用系統 Chrome');
      } catch (e) {
        this.logger.warn(`系統 Chrome 不可用 (${e.message.split('\n')[0]})，改用 Chromium...`);
        this.browser = null;
      }
    }

    // 退回 Playwright 內建 Chromium
    if (!this.browser) {
      this.logger.info(`🌐 啟動 Chromium (${headless ? 'headless' : 'headed'})...`);
      this.browser = await chromium.launch({
        headless,
        args: BROWSER_ARGS,
        executablePath: process.env.CHROME_PATH || undefined,
      });
      this.logger.info('✅ 使用 Playwright Chromium');
    }

    this.context = await this.browser.newContext({
      viewport:   { width: 1280, height: 900 },
      userAgent:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale:     'zh-TW',
      timezoneId: 'Asia/Taipei',
    });

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    });

    this.context.on('page', page => {
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    });

    this.logger.info('✅ 瀏覽器已啟動（訪客模式）');
    return this;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  導航
  // ══════════════════════════════════════════════════════════════════════════
  async navigate() {
    if (!this.browser) throw new Error('請先呼叫 launch()');
    const ok = await this._openFreshTab();
    if (!ok) return { ready: false, error: '無法開啟 Gemini 分頁' };
    this.isReady = true;
    return { ready: true, selectors: this.sel };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  發送訊息
  // ══════════════════════════════════════════════════════════════════════════
  async sendMessage(prompt, opts = {}) {
    const { newChat = false, timeout = TIMEOUT, _retry = 0 } = opts;
    if (_retry >= 3) return { success: false, error: '已重試 3 次仍然失敗', response: '' };

    if (!this.page) await this.navigate();
    if (newChat)    await this._resetToHome();

    this.logger.info(`📤 [Tab#${this.tabSeq}] 發送 (${prompt.length} 字元)...`);

    try {
      const blocked = await this._detectBlock();
      if (blocked) {
        this.logger.warn(`⚠️  偵測到阻擋 (${blocked})，換新分頁...`);
        await this._rotateTab();
        return this.sendMessage(prompt, { ...opts, _retry: _retry + 1 });
      }

      const inputSel = await this._resolveSelector('input');
      if (!inputSel) throw new Error('找不到輸入框');

      const inputEl = this.page.locator(inputSel).first();
      await inputEl.waitFor({ state: 'visible', timeout: 10000 });
      await inputEl.click();
      await this.page.waitForTimeout(150);

      await inputEl.press('Control+a');
      await inputEl.fill('');
      await inputEl.pressSequentially(prompt, { delay: 8 });
      await this.page.waitForTimeout(350);

      await this._clickSend();

      const response = await this._waitForResponse(timeout);
      if (!response) throw new Error('收到空回應');

      this.logger.info(`📥 [Tab#${this.tabSeq}] 回應 (${response.length} 字元)`);
      return { success: true, response };

    } catch (error) {
      this.logger.error(`[Tab#${this.tabSeq}] 失敗: ${error.message}`);
      if (this._isTabError(error)) {
        this.logger.warn('🔄 換新分頁重試...');
        await this._rotateTab();
        return this.sendMessage(prompt, { ...opts, _retry: _retry + 1 });
      }
      return { success: false, error: error.message, response: '' };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  分頁輪換：先開新的（確認可用），再關掉舊的
  // ══════════════════════════════════════════════════════════════════════════
  async _rotateTab() {
    const oldPage = this.page;
    const oldSeq  = this.tabSeq;
    this.logger.info(`🔄 開啟新分頁（舊分頁 #${oldSeq} 待關閉）...`);

    const ok = await this._openFreshTab();  // 成功後 this.page 已指向新分頁

    // 新分頁就緒後，才關舊的
    if (oldPage) {
      await oldPage.close().catch(() => {});
      this.logger.info(`🗑️  已關閉舊分頁 #${oldSeq}`);
    }

    if (!ok) throw new Error('無法開啟新的 Gemini 分頁');
    this.logger.info(`✅ 已切換到新分頁 #${this.tabSeq}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  開啟全新分頁並等待 Gemini 就緒
  //
  //  關鍵修改：找不到 input 時不立刻關掉分頁，而是等待重試（最多 3 次）
  //  每次多等 3 秒讓頁面繼續渲染
  // ══════════════════════════════════════════════════════════════════════════
  async _openFreshTab() {
    this.tabSeq++;
    const seq = this.tabSeq;
    this.logger.info(`📄 開啟分頁 #${seq}...`);

    const page = await this.context.newPage();
    page.on('dialog', d => d.dismiss().catch(() => {}));

    try {
      await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // 等待較久讓 JS bundle 載入（Gemini 是 SPA，domcontentloaded 不夠）
      await page.waitForTimeout(3000);

      // 關閉干擾 UI
      await this._dismissAll(page);
      await page.waitForTimeout(500);

      // 如果在阻擋頁，先處理
      const blocked = await this._detectBlock(page);
      if (blocked) {
        this.logger.warn(`#${seq} 阻擋 (${blocked})，跳回首頁...`);
        await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2500);
        await this._dismissAll(page);
      }

      // ── 等待輸入框出現，最多重試 3 次，每次多等 3 秒 ──────────────────────
      let sel = {};
      for (let attempt = 1; attempt <= 3; attempt++) {
        this.logger.info(`🔍 偵測 #${seq} selector（第 ${attempt}/3 次）...`);
        sel = await this.discovery.discoverAll(page);

        if (sel.input) break;  // 找到了就不再等

        if (attempt < 3) {
          this.logger.warn(`#${seq} 第 ${attempt} 次找不到輸入框，等待 3 秒後再試...`);
          await this._dismissAll(page);    // 再試一次關閉干擾
          await page.waitForTimeout(3000);
        }
      }

      if (!sel.input) {
        // 3 次都失敗才真的放棄，但不關分頁讓用戶看看是什麼狀況
        this.logger.warn(`#${seq} 3 次偵測均找不到輸入框，放棄此分頁`);
        await page.close().catch(() => {});
        this.tabSeq--;
        return false;
      }

      this.page = page;
      this.sel  = sel;
      this.logger.info(`✅ 分頁 #${seq} 就緒（找到 ${Object.values(sel).filter(Boolean).length}/6 個 selector）`);
      return true;

    } catch (error) {
      this.logger.error(`開啟分頁 #${seq} 失敗: ${error.message}`);
      await page.close().catch(() => {});
      this.tabSeq--;
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  阻擋偵測 & 干擾關閉
  // ══════════════════════════════════════════════════════════════════════════
  async _detectBlock(page = this.page) {
    if (!page) return null;
    try {
      const url = page.url();
      for (const sig of BLOCKER.urls)
        if (url.includes(sig)) return `url:${sig}`;

      for (const sel of BLOCKER.domSelectors) {
        const n = await page.locator(sel).count().catch(() => 0);
        if (n > 0) return `dom:${sel}`;
      }

      const text = await page.evaluate(
        () => document.body?.innerText?.slice(0, 2000) || ''
      ).catch(() => '');
      for (const sig of BLOCKER.bodyText)
        if (text.includes(sig)) return `text:${sig}`;

      return null;
    } catch { return null; }
  }

  async _dismissAll(page = this.page) {
    for (const sel of DISMISS) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 })) {
          await el.click();
          this.logger.debug(`💨 關閉: ${sel}`);
          await page.waitForTimeout(300);
        }
      } catch {}
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  UI 互動
  // ══════════════════════════════════════════════════════════════════════════
  async _waitForResponse(timeout) {
    const start = Date.now();
    const responseSel = this.sel.responseBlock || 'model-response';
    
    // 預等回應區塊出現
    await this.page.waitForSelector(responseSel, { timeout: 15000 }).catch(() => {});

    let lastText = '', stableCount = 0;
    const checkInterval = 500; // 縮短檢查間隔

    while (Date.now() - start < timeout) {
      await this.page.waitForTimeout(checkInterval);

      // 偵測是否被阻擋
      const blocked = await this._detectBlock();
      if (blocked) throw new Error(`回應中遭遇阻擋: ${blocked}`);

      const curText = await this._extractResponse();
      const loadSel = this.sel.loadingIndicator || 'mat-progress-bar, mat-progress-spinner, .loading-indicator';
      const isLoading = await this.page.locator(loadSel).isVisible({ timeout: 100 }).catch(() => false);

      if (curText) {
        if (curText === lastText) {
          stableCount++;
        } else {
          stableCount = 0;
          lastText = curText;
        }

        // 完結條件：
        // 1. 如果 loading 指示器消失了，且內容已穩定 (至少 2 次檢查一致)
        // 2. 或者內容極其穩定 (穩定 6 次以上，預防指示器偵測失效)
        if (!isLoading && stableCount >= 2) {
          return curText;
        }
        if (stableCount >= 6) {
          return curText;
        }
      }
    }
    return lastText || '';
  }

  async _extractResponse() {
    const tries = [
      this.sel.responseText, this.sel.responseBlock,
      'model-response .markdown', 'model-response',
      '.response-content', '[data-response-index]',
    ].filter(Boolean);

    for (const s of tries) {
      try {
        const els = this.page.locator(s);
        if (await els.count() > 0) {
          // 嘗試用 innerHTML 取得結構化內容
          const html = await els.last().innerHTML().catch(() => '');
          if (html?.trim()) {
            const md = this._htmlToMarkdown(html);
            if (md.trim()) return md.trim();
          }
          // Fallback 到 innerText
          const t = await els.last().innerText().catch(() => '');
          if (t?.trim()) return t.trim();
        }
      } catch {}
    }
    return '';
  }

  // ── HTML → Markdown 簡易轉換（保留程式碼、標題、列表格式）──────────────
  _htmlToMarkdown(html) {
    let md = html;

    // 程式碼區塊：<pre><code>...</code></pre> → ```...```
    md = md.replace(/<pre[^>]*>\s*<code[^>]*class="[^"]*language-(\w+)"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
      (_, lang, code) => `\n\`\`\`${lang}\n${this._decodeHtml(code).trim()}\n\`\`\`\n`);
    md = md.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
      (_, code) => `\n\`\`\`\n${this._decodeHtml(code).trim()}\n\`\`\`\n`);
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi,
      (_, code) => `\n\`\`\`\n${this._decodeHtml(code).trim()}\n\`\`\`\n`);

    // 行內程式碼：<code>...</code> → `...`
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${this._decodeHtml(code)}\``);

    // 標題
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // 粗體/斜體
    md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

    // 列表
    md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
    md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n');

    // 段落分隔
    md = md.replace(/<\/p>/gi, '\n\n');
    md = md.replace(/<p[^>]*>/gi, '');
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // 移除所有剩餘的 HTML 標籤
    md = md.replace(/<[^>]+>/g, '');

    // 解碼 HTML entities
    md = this._decodeHtml(md);

    // 清理多餘空行
    md = md.replace(/\n{3,}/g, '\n\n');

    return md.trim();
  }

  _decodeHtml(html) {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  async _clickSend() {
    const s = this.sel.sendButton || 'button.send-button';
    try {
      const btn = this.page.locator(s).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await this.page.waitForTimeout(500);
        // 如果按鈕還是可見且沒有變成「停止」按鈕，可能沒點中或無反應，補一個 Enter
        const stillVisible = await btn.isVisible({ timeout: 500 }).catch(() => false);
        if (stillVisible) await this.page.keyboard.press('Enter');
        return;
      }
    } catch {}
    await this.page.keyboard.press('Enter');
  }

  async _resetToHome() {
    try {
      if (this.sel.newChatButton) {
        const btn = this.page.locator(this.sel.newChatButton).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          await this.page.waitForTimeout(1200);
          return;
        }
      }
    } catch {}
    await this.page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(2000);
    await this._dismissAll();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Selector 管理 & 工具
  // ══════════════════════════════════════════════════════════════════════════
  async _resolveSelector(type) {
    if (this.sel[type] && await this.discovery._validate(this.page, this.sel[type]))
      return this.sel[type];
    const fresh = await this.discovery.getSelector(this.page, type);
    if (fresh) this.sel[type] = fresh;
    return fresh;
  }

  async rediscover() {
    if (!this.page) return { success: false, error: '無可用分頁' };
    await this.discovery.clearCache();
    this.sel = await this.discovery.discoverAll(this.page);
    return { success: true, selectors: this.sel };
  }

  async selectorStatus() { return this.discovery.showCacheStatus(); }

  async healthCheck() {
    if (!this.browser) return { healthy: false, reason: 'Browser not launched' };
    if (!this.page)    return { healthy: false, reason: 'No active tab' };
    try {
      const blocked  = await this._detectBlock();
      const hasInput = this.sel.input
        ? await this.discovery._validate(this.page, this.sel.input)
        : false;
      return { healthy: !blocked && hasInput, activeTab: this.tabSeq,
               blocked, url: this.page.url(), isReady: this.isReady };
    } catch (e) { return { healthy: false, reason: e.message }; }
  }

  _isTabError(error) {
    const msg = error.message.toLowerCase();
    return ['timeout','navigation','net::','blocked','empty','not attached',
            'execution context','target closed','page closed','阻擋'].some(k => msg.includes(k));
  }

  async switchMode(mode) {
    await this.close();
    process.env.BROWSER_MODE = mode;
    await this.launch();
    await this.navigate();
  }

  async close() {
    if (this.page)    await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null; this.context = null;
    this.page = null; this.sel = {};
    this.isReady = false;
    this.logger.info('🔒 瀏覽器已關閉');
  }
}
