// router/smart-router.js
// 🧭 智能路由器 — 動態決定用 Flash API 或 Gemini 網頁版
//
// 路由邏輯：
//   Flash API  → 快速、簡單任務、指令解析、結構化輸出
//   Gemini Web → 複雜推理、長文生成、程式碼、需要最新知識
//   + 額度管理 → API 額度不足時自動降級到 Web
//
// 🧬 FORCE_WEB_MODE = true 時，所有請求強制走 Gemini Web（完全不使用 API）

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiWebClient } from '../browser/gemini-web.js';
import { QuotaManager } from '../core/quota-manager.js';
import { Logger } from '../core/logger.js';

const FORCE_WEB_MODE     = process.env.FORCE_WEB_MODE === 'true';
const COMPLEXITY_THRESHOLD = parseFloat(process.env.COMPLEXITY_THRESHOLD) || 0.6;
const TOKEN_LIMIT          = parseInt(process.env.ROUTER_TOKEN_LIMIT) || 800;

// ── 複雜度判斷規則 ───────────────────────────────────────────────────────────
const COMPLEXITY_RULES = {
  // 強制走網頁版的關鍵詞（高複雜度任務）
  forceWeb: [
    /寫.*程式|write.*code|implement|建立.*專案|create.*project/i,
    /完整.*實現|full.*implementation|架構設計|system.*design/i,
    /分析.*並.*優化|analyze.*optimize|重構|refactor/i,
    /設計.*資料庫|database.*schema|API.*設計/i,
    /debug|除錯|找.*bug|trace.*error/i,
    /解釋.*原理|explain.*how.*works|深度.*分析/i,
  ],
  // 強制走 API 的關鍵詞（輕量任務）
  forceAPI: [
    /^(hi|hello|你好|嗨|hey)/i,
    /什麼意思|translate|翻譯/i,
    /幫我.*改.*一下|quick.*fix/i,
    /記憶|memory|remember/i,
  ],
  // 評分因子
  complexityFactors: [
    { pattern: /\d{3,}/,     score: 0.1 },  // 大數字
    { pattern: /且|並且|同時/,  score: 0.15 }, // 複合指令
    { pattern: /步驟|流程|架構/, score: 0.2 },  // 結構性任務
    { pattern: /完整|全面|詳細/, score: 0.2 },  // 要求完整性
    { pattern: /程式|code|腳本/, score: 0.3 },  // 程式相關
  ]
};

export class SmartRouter {
  constructor(apiKey) {
    this.logger       = new Logger('Router');
    this.webClient    = null;
    this.quotaManager = new QuotaManager();
    this.apiKey = apiKey;
    this.stats = { apiCalls: 0, webCalls: 0, totalSaved: 0 };

    // 🧬 如果有 API Key，才初始化 API 客戶端
    if (apiKey && apiKey.trim()) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.apiClient = this.genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
      });
      this.logger.info('📡 Flash API 已就緒');
    } else {
      this.genAI = null;
      this.apiClient = null;
      this.logger.info('ℹ️  無 API Key，將僅使用 Gemini Web');
    }
  }

  // ── 主路由入口 ────────────────────────────────────────────────────────────
  async route(prompt, systemContext = '') {
    const decision = this._decide(prompt);
    this.logger.info(`🧭 路由決策: ${decision.route} (複雜度: ${decision.score.toFixed(2)}) — ${decision.reason}`);

    if (decision.route === 'api') {
      return this._callAPI(prompt, systemContext, decision);
    } else {
      return this._callWeb(prompt, systemContext, decision);
    }
  }

  // ── 複雜度評估，決定路由 ─────────────────────────────────────────────────
  _decide(prompt) {
    const tokenEstimate = Math.ceil(prompt.length / 3);

    // 🧬 FORCE_WEB_MODE：強制所有請求走 Web
    if (FORCE_WEB_MODE) {
      return {
        route: 'web',
        score: 1.0,
        reason: 'FORCE_WEB_MODE 啟用，使用 Gemini Web',
        tokens: tokenEstimate
      };
    }

    // 🧬 如果沒有 API，直接返回 Web
    if (!this.apiClient) {
      return {
        route: 'web',
        score: 1.0,
        reason: '無 API Key，使用 Gemini Web',
        tokens: tokenEstimate
      };
    }

    // 🔴 額度管理：API 額度不足時強制走 Web
    if (!this.quotaManager.canCallAPI()) {
      return {
        route: 'web',
        score: 0.99,
        reason: '⚠️ API 額度不足，自動切換到 Web',
        tokens: tokenEstimate
      };
    }

    // 強制走網頁版
    for (const pattern of COMPLEXITY_RULES.forceWeb) {
      if (pattern.test(prompt)) {
        return {
          route: 'web',
          score: 0.95,
          reason: `關鍵詞匹配: ${pattern.toString().substring(0, 30)}`,
          tokens: tokenEstimate
        };
      }
    }

    // 強制走 API
    for (const pattern of COMPLEXITY_RULES.forceAPI) {
      if (pattern.test(prompt)) {
        return {
          route: 'api',
          score: 0.05,
          reason: '輕量任務匹配',
          tokens: tokenEstimate
        };
      }
    }

    // Token 超過上限 → 強制走網頁版
    if (tokenEstimate > TOKEN_LIMIT) {
      return {
        route: 'web',
        score: 0.9,
        reason: `Token 超過上限 (${tokenEstimate} > ${TOKEN_LIMIT})`,
        tokens: tokenEstimate
      };
    }

    // 計算複雜度分數
    let score = 0.2 + (tokenEstimate / TOKEN_LIMIT) * 0.3;
    for (const { pattern, score: s } of COMPLEXITY_RULES.complexityFactors) {
      if (pattern.test(prompt)) score += s;
    }
    score = Math.min(score, 1.0);

    return {
      route: score >= COMPLEXITY_THRESHOLD ? 'web' : 'api',
      score,
      reason: `複雜度評分 ${score.toFixed(2)}`,
      tokens: tokenEstimate
    };
  }

  // ── 呼叫 Flash API（含額度管理與自動重試）──────────────────────────────
  async _callAPI(prompt, systemContext, decision) {
    // 🧬 如果沒有 API 客戶端，直接降級到 Web
    if (!this.apiClient) {
      this.logger.info('ℹ️  無 API，直接降級到 Web');
      return this._callWeb(prompt, systemContext, { ...decision, route: 'web', reason: '無 API Key' });
    }

    this.stats.apiCalls++;
    const startTime = Date.now();

    const fullPrompt = systemContext
      ? `${systemContext}\n\n---\n\n${prompt}`
      : prompt;

    // 使用 QuotaManager 的 callWithRetry 進行額度感知的 API 呼叫
    const apiResult = await this.quotaManager.callWithRetry(async () => {
      const result = await this.apiClient.generateContent(fullPrompt);
      return result.response.text();
    });

    if (apiResult.success) {
      const elapsed = Date.now() - startTime;
      return {
        success: true,
        response: apiResult.result,
        source: 'api',
        elapsed,
        decision,
        cost: 'minimal'
      };
    }

    // 額度耗盡或重試失敗 → 降級到 Web
    if (apiResult.shouldFallbackToWeb) {
      this.logger.warn(`API ${apiResult.error}，降級到網頁版...`);
      return this._callWeb(prompt, systemContext, { ...decision, reason: `API fallback (${apiResult.error})` });
    }

    // 其他錯誤
    this.logger.error('API 呼叫失敗，降級到網頁版:', apiResult.error);
    return this._callWeb(prompt, systemContext, { ...decision, reason: 'API fallback' });
  }

  // ── 呼叫 Gemini 網頁版 ────────────────────────────────────────────────────
  async _callWeb(prompt, systemContext, decision) {
    this.stats.webCalls++;
    const startTime = Date.now();

    try {
      // 懶加載：第一次使用才啟動瀏覽器
      if (!this.webClient) {
        await this._initWebClient();
      }

      // 健康檢查
      const health = await this.webClient.healthCheck();
      if (!health.healthy) {
        this.logger.warn('瀏覽器狀態異常，重新初始化...');
        await this._initWebClient();
      }

      // 組合 prompt（加入系統上下文）
      const fullPrompt = systemContext
        ? `[系統指令]\n${systemContext}\n\n[任務]\n${prompt}`
        : prompt;

      const result = await this.webClient.sendMessage(fullPrompt, {
        newChat: decision.score > 0.8 // 高複雜度任務開新對話，避免污染上下文
      });

      const elapsed = Date.now() - startTime;

      if (!result.success) {
        throw new Error(result.error || '網頁版回應失敗');
      }

      this.stats.totalSaved++;
      return {
        success: true,
        response: result.response,
        source: 'web',
        elapsed,
        decision,
        cost: 'free' // 網頁版完全免費
      };

    } catch (error) {
      this.logger.error('網頁版呼叫失敗:', error.message);

      // 最後降級：回到 API（如果額度允許）
      if (this.quotaManager.canCallAPI()) {
        this.logger.warn('降級到 Flash API...');
        return this._callAPI(prompt, systemContext, decision);
      }

      // 雙軌皆失敗
      return {
        success: false,
        response: '',
        source: 'none',
        error: `API 與 Web 皆不可用: ${error.message}`,
        elapsed: Date.now() - startTime,
        decision
      };
    }
  }

  // ── 初始化網頁客戶端（訪客模式，無需登入）───────────────────────────────
  async _initWebClient() {
    this.webClient = new GeminiWebClient(this.apiKey);
    await this.webClient.launch();
    const nav = await this.webClient.navigate();
    if (!nav.ready) {
      throw new Error(nav.error || '無法初始化 Gemini 網頁版（訪客模式）');
    }
  }

  // ── 顯示路由統計 ─────────────────────────────────────────────────────────
  getStats() {
    const total = this.stats.apiCalls + this.stats.webCalls;
    const webPct = total > 0 ? ((this.stats.webCalls / total) * 100).toFixed(1) : 0;
    return {
      ...this.stats,
      total,
      webPercentage: `${webPct}%`,
      estimatedCostSaving: `${this.stats.webCalls} 次請求走免費網頁版`,
      quota: this.quotaManager.getStats()
    };
  }

  // ── 強制指定路由（測試用）────────────────────────────────────────────────
  async forceRoute(prompt, route = 'web') {
    const decision = { route, score: route === 'web' ? 1.0 : 0.0, reason: '強制路由', tokens: 0 };
    if (route === 'web') return this._callWeb(prompt, '', decision);
    return this._callAPI(prompt, '', decision);
  }

  // ── 關閉所有資源 ─────────────────────────────────────────────────────────
  async shutdown() {
    if (this.webClient) {
      await this.webClient.close();
      this.webClient = null;
    }
  }
}
