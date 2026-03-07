// core/quota-manager.js
// 📊 API 額度智慧管理器
//
// 功能：
//  - 追蹤每分鐘/每日 API 呼叫次數
//  - 遇到 429 → 指數退避重試（最多 3 次）
//  - 額度預判：預估剩餘額度不足時，主動將任務轉交 Web 版
//  - 提供 canCallAPI() 方法讓 Router 查詢

import { Logger } from './logger.js';

// Gemini Flash Free Tier 預設限制
const DEFAULT_LIMITS = {
  rpm: parseInt(process.env.API_RPM_LIMIT) || 15,    // 每分鐘請求數
  rpd: parseInt(process.env.API_RPD_LIMIT) || 1500,  // 每日請求數
};

export class QuotaManager {
  constructor() {
    this.logger = new Logger('Quota');

    // 滑動視窗計數器
    this._minuteCalls = [];   // 最近 60 秒內的呼叫時間戳
    this._dayCalls    = [];   // 最近 24 小時內的呼叫時間戳

    this._limits  = { ...DEFAULT_LIMITS };
    this._blocked = false;       // 是否被 429 阻擋中
    this._blockedUntil = 0;      // 阻擋到何時
    this._consecutiveErrors = 0; // 連續 429 錯誤計數

    this.logger.info(`📊 額度管理器啟動 — RPM: ${this._limits.rpm}, RPD: ${this._limits.rpd}`);
  }

  // ── 核心判斷：目前是否可以呼叫 API？─────────────────────────────────────
  canCallAPI() {
    this._cleanupExpired();

    // 如果正在被阻擋
    if (this._blocked) {
      if (Date.now() < this._blockedUntil) {
        return false;
      }
      // 阻擋已過期，解除
      this._blocked = false;
    }

    // 檢查每分鐘限制（留 20% 緩衝）
    const minuteUsed = this._minuteCalls.length;
    const minuteLimit = Math.floor(this._limits.rpm * 0.8);
    if (minuteUsed >= minuteLimit) {
      this.logger.warn(`⚠️  每分鐘額度即將耗盡 (${minuteUsed}/${this._limits.rpm})`);
      return false;
    }

    // 檢查每日限制（留 10% 緩衝）
    const dayUsed = this._dayCalls.length;
    const dayLimit = Math.floor(this._limits.rpd * 0.9);
    if (dayUsed >= dayLimit) {
      this.logger.warn(`⚠️  每日額度即將耗盡 (${dayUsed}/${this._limits.rpd})`);
      return false;
    }

    return true;
  }

  // ── 記錄一次 API 呼叫 ──────────────────────────────────────────────────
  recordCall() {
    const now = Date.now();
    this._minuteCalls.push(now);
    this._dayCalls.push(now);
    this._consecutiveErrors = 0; // 成功呼叫重置錯誤計數
  }

  // ── 記錄 429 錯誤 ──────────────────────────────────────────────────────
  record429(retryAfterMs = 0) {
    this._consecutiveErrors++;

    // 指數退避：基礎 10 秒 × 2^(錯誤次數-1)，但不超過 5 分鐘
    const backoffMs = retryAfterMs > 0
      ? retryAfterMs
      : Math.min(10000 * Math.pow(2, this._consecutiveErrors - 1), 300000);

    this._blocked = true;
    this._blockedUntil = Date.now() + backoffMs;

    this.logger.warn(
      `🚫 429 額度超限 (#${this._consecutiveErrors})，退避 ${(backoffMs / 1000).toFixed(1)}s`
    );

    // 如果連續 3 次 429，標記為當日不再使用 API
    if (this._consecutiveErrors >= 3) {
      this._blockedUntil = Date.now() + 3600000; // 至少 1 小時
      this.logger.error('❌ 連續 3 次 429，暫停 API 呼叫 1 小時');
    }
  }

  // ── 包裝 API 呼叫（含自動重試）──────────────────────────────────────────
  async callWithRetry(apiCallFn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!this.canCallAPI()) {
        // 額度不足，直接返回失敗讓 Router 走 Web
        return { success: false, error: 'quota_exhausted', shouldFallbackToWeb: true };
      }

      try {
        this.recordCall();
        const result = await apiCallFn();
        return { success: true, result };
      } catch (err) {
        const is429 = err.message?.includes('429') || err.status === 429;

        if (is429) {
          // 解析 retryAfter
          const retryMatch = err.message?.match(/retry in (\d+\.?\d*)s/i);
          const retryAfterMs = retryMatch ? parseFloat(retryMatch[1]) * 1000 : 0;
          this.record429(retryAfterMs);

          if (attempt < maxRetries) {
            const waitMs = retryAfterMs || (10000 * attempt);
            this.logger.info(`⏳ 等待 ${(waitMs / 1000).toFixed(1)}s 後重試 (${attempt}/${maxRetries})...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }

          return { success: false, error: 'rate_limited', shouldFallbackToWeb: true };
        }

        // 非 429 錯誤直接拋出
        throw err;
      }
    }

    return { success: false, error: 'max_retries_exceeded', shouldFallbackToWeb: true };
  }

  // ── 取得額度統計 ────────────────────────────────────────────────────────
  getStats() {
    this._cleanupExpired();
    return {
      minuteUsed:   this._minuteCalls.length,
      minuteLimit:  this._limits.rpm,
      minuteRemain: Math.max(0, this._limits.rpm - this._minuteCalls.length),
      dayUsed:      this._dayCalls.length,
      dayLimit:     this._limits.rpd,
      dayRemain:    Math.max(0, this._limits.rpd - this._dayCalls.length),
      blocked:      this._blocked,
      blockedUntil: this._blocked ? new Date(this._blockedUntil).toISOString() : null,
      consecutiveErrors: this._consecutiveErrors,
    };
  }

  // ── 清理過期的呼叫記錄 ──────────────────────────────────────────────────
  _cleanupExpired() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneDayAgo    = now - 86400000;

    this._minuteCalls = this._minuteCalls.filter(t => t > oneMinuteAgo);
    this._dayCalls    = this._dayCalls.filter(t => t > oneDayAgo);
  }
}
