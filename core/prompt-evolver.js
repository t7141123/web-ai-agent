// core/prompt-evolver.js
// 🧬 Prompt 自動改進器
//
// 分析過去的對話品質，自動調整 BASE_PROMPT 中的指令
// 保留 prompt 版本歷史，可回滾

import fs from 'fs-extra';
import { Logger } from './logger.js';

const PROMPT_FILE    = './memory/prompt_versions.json';
const FEEDBACK_FILE  = './memory/quality_feedback.json';

export class PromptEvolver {
  constructor() {
    this.logger = new Logger('PromptEvolver');
    this._initP = this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(PROMPT_FILE)) {
      await fs.writeJSON(PROMPT_FILE, { versions: [], activeVersion: 0 }, { spaces: 2 });
    }
    if (!await fs.pathExists(FEEDBACK_FILE)) {
      await fs.writeJSON(FEEDBACK_FILE, { feedbacks: [], stats: { total: 0, satisfied: 0, unsatisfied: 0 } }, { spaces: 2 });
    }
  }

  // ── 記錄對話品質回饋 ───────────────────────────────────────────────────
  async recordFeedback(feedback) {
    await this._initP;
    const data = await fs.readJSON(FEEDBACK_FILE).catch(() => ({ feedbacks: [], stats: { total: 0, satisfied: 0, unsatisfied: 0 } }));

    data.feedbacks.unshift({
      ...feedback,
      at: Date.now()
    });
    // 只保留最近 200 條
    data.feedbacks = data.feedbacks.slice(0, 200);

    // 更新統計
    data.stats.total++;
    if (feedback.satisfied) data.stats.satisfied++;
    else data.stats.unsatisfied++;

    await fs.writeJSON(FEEDBACK_FILE, data, { spaces: 2 });
  }

  // ── 從用戶行為推測滿意度 ───────────────────────────────────────────────
  inferSatisfaction(userInput, previousResponse) {
    if (!previousResponse) return null;

    const input = userInput.toLowerCase();

    // 正面信號
    const positivePatterns = [
      /謝謝|感謝|太好了|厲害|不錯|完美|很棒|很好|正確|成功|good|great|thanks|perfect|nice|awesome|correct/i,
      /^(ok|好|嗯|對|是的|沒問題|可以)/i,
    ];

    // 負面信號
    const negativePatterns = [
      /不對|錯了|不是|重新|再試|重來|還是不行|沒有用|失敗|wrong|incorrect|no|retry|again|doesn't work|not right/i,
      /一直|還是|仍然|目前沒有|你.*(按到|搞錯|誤)/i,
    ];

    for (const p of positivePatterns) {
      if (p.test(input)) return { satisfied: true, signal: 'positive_language', confidence: 0.7 };
    }

    for (const p of negativePatterns) {
      if (p.test(input)) return { satisfied: false, signal: 'negative_language', confidence: 0.8 };
    }

    // 如果用戶在同一個主題反覆提問，可能不滿意
    if (previousResponse && input.length < 200) {
      const prevWords = new Set(previousResponse.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      const inputWords = input.split(/\s+/).filter(w => w.length > 2);
      const overlap = inputWords.filter(w => prevWords.has(w)).length;
      if (overlap > inputWords.length * 0.5 && inputWords.length > 3) {
        return { satisfied: false, signal: 'repeated_topic', confidence: 0.5 };
      }
    }

    return null; // 無法判斷
  }

  // ── 取得品質統計 ───────────────────────────────────────────────────────
  async getQualityStats() {
    await this._initP;
    const data = await fs.readJSON(FEEDBACK_FILE).catch(() => ({ feedbacks: [], stats: { total: 0, satisfied: 0, unsatisfied: 0 } }));

    const recent = data.feedbacks.slice(0, 20);
    const recentSatisfied = recent.filter(f => f.satisfied).length;

    return {
      total: data.stats.total,
      satisfactionRate: data.stats.total > 0
        ? ((data.stats.satisfied / data.stats.total) * 100).toFixed(1) + '%'
        : 'N/A',
      recentRate: recent.length > 0
        ? ((recentSatisfied / recent.length) * 100).toFixed(1) + '%'
        : 'N/A',
      recentFeedbacks: recent.slice(0, 5),
    };
  }

  // ── 保存 prompt 版本 ──────────────────────────────────────────────────
  async saveVersion(promptText, reason) {
    await this._initP;
    const data = await fs.readJSON(PROMPT_FILE).catch(() => ({ versions: [], activeVersion: 0 }));

    data.versions.unshift({
      version: data.versions.length + 1,
      prompt: promptText,
      reason,
      at: Date.now()
    });
    data.versions = data.versions.slice(0, 10); // 最多保留 10 個版本
    data.activeVersion = data.versions[0].version;

    await fs.writeJSON(PROMPT_FILE, data, { spaces: 2 });
    this.logger.info(`📝 Prompt 版本 #${data.activeVersion} 已保存: ${reason}`);
  }
}
