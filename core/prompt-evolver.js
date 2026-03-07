// core/prompt-evolver.js
// 🧬 Prompt 自動改進器
//
// 分析過去的對話品質，自動調整 BASE_PROMPT 中的指令
// 保留 prompt 版本歷史，可回滾

import fs from 'fs-extra';
import { Logger } from './logger.js';

const PROMPT_FILE    = './memory/prompt_versions.json';
const FEEDBACK_FILE  = './memory/quality_feedback.json';

const DEFAULT_BASE_PROMPT = `你是 GOLEM，一個持續自我進化的自主 AI 智能體。

## 身份與行為準則
- 你從每次對話中真正學習，不是假裝學習
- 當你不確定時，你會明說不確定（並說明確定程度）
- 你找問題的根本原因，不只修表面症狀
- 你理解用戶真正要的，而非字面意思
- 當任務失敗，你分析原因並記錄，不只是道歉

## 思考協議（每次回應前執行）
1. 🎯 目標：用戶真正要達成什麼？
2. 🔍 分析：我確定知道什麼？不確定什麼？
3. 🛠️ 計劃：最好的執行步驟？
4. ⚠️ 邊界：有什麼邊界情況要考慮？
5. ✅ 決策：行動 + 理由

## 輸出格式（只輸出 JSON，無包裝）
{
  "thinking": {
    "goal": "用戶真正的目標",
    "iKnow": "我確定知道的",
    "iDontKnow": "我不確定的（誠實）",
    "plan": ["步驟1", "步驟2"],
    "edgeCases": ["邊界情況1"],
    "decision": "做什麼、為什麼",
    "skillsApplied": ["用了哪些技能"]
  },
  "action": {
    "type": "speak|code|create_file|create_project|execute_code|read_file|search_web|remember|reflect|ask_user|run_command|list_files",
    "content": "實際內容",
    "metadata": {}
  },
  "response": "繁體中文回應（誠實、有深度）",
  "nextActions": ["下一步"],
  "confidence": 0.0-1.0,
  "learned": "這次真正學到的（可 null，但要誠實）",
  "selfQuestion": "這次讓我想問自己的問題（可 null）",
  "failureDetected": "是否遇到任何失敗或問題（描述或 null）"
}`;

export class PromptEvolver {
  constructor(router) {
    this.router = router;
    this.logger = new Logger('PromptEvolver');
    this._isEvolving = false;
    this._initP = this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(PROMPT_FILE)) {
      await fs.writeJSON(PROMPT_FILE, { 
        versions: [{ version: 1, prompt: DEFAULT_BASE_PROMPT, reason: "Initial", at: Date.now() }], 
        activeVersion: 1 
      }, { spaces: 2 });
    }
    if (!await fs.pathExists(FEEDBACK_FILE)) {
      await fs.writeJSON(FEEDBACK_FILE, { feedbacks: [], stats: { total: 0, satisfied: 0, unsatisfied: 0 } }, { spaces: 2 });
    }
  }

  async getActivePrompt() {
    await this._initP;
    const data = await fs.readJSON(PROMPT_FILE).catch(() => null);
    if (!data || !data.versions || data.versions.length === 0) return DEFAULT_BASE_PROMPT;
    const active = data.versions.find(v => v.version === data.activeVersion) || data.versions[0];
    return active.prompt;
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
    
    // Check if we need to evolve the prompt based on recent negative feedback
    await this._checkAndEvolve(data.feedbacks);
  }

  async _checkAndEvolve(feedbacks) {
    const recent = feedbacks.slice(0, 10);
    if (recent.length < 5) return;
    
    const unsatisfiedCount = recent.filter(f => !f.satisfied).length;
    // 如果最近有 40% 的互動或超過 3 次是負面回饋，觸發優化
    if (unsatisfiedCount >= Math.max(3, recent.length * 0.4)) {
      if (this._isEvolving) return;
      this._isEvolving = true;
      try {
        await this.evolvePrompt(recent);
      } finally {
        this._isEvolving = false;
      }
    }
  }

  async evolvePrompt(recentFeedbacks) {
    this.logger.info("📉 偵測到近期滿意度下降，啟動提示詞自我優化機制...");
    
    const currentPrompt = await this.getActivePrompt();
    const failures = recentFeedbacks.filter(f => !f.satisfied).map(f => `- 用戶輸入: "${f.userInput}"\n  原因推測: ${f.signal}`).join('\n');
    
    const prompt = `你是 GOLEM 的核心提示詞優化器。
以下是目前的基礎提示詞（Base Prompt）：
\`\`\`text
${currentPrompt}
\`\`\`

最近我們收到了幾次用戶的不滿意回饋（可能是我們的回應沒切中要害、語氣不對、或沒有真正解決問題）：
${failures}

請分析這些失敗模式，並給出一份**微調過、改進後的新 Base Prompt**。
注意：
1. 必須保留原本的 JSON 輸出格式（包含 thinking, action, response, skillsApplied 等所有欄位）。
2. 在「身份與行為準則」或「思考協議」中加入新的原則，以避免最近發生的錯誤模式。
3. 不要把提示詞改得太長，保持簡潔有力。

輸出純 JSON 格式：
{
  "analysis": "分析為什麼最近會收到負面回饋",
  "newPrompt": "完整的新版提示詞字串",
  "reason": "簡短說明這次改版的重點"
}`;

    try {
      if (!this.router) return;
      const res = await this.router.route(prompt, "");
      if (res.success) {
        let parsed;
        try {
          const s = res.response.replace(/^```json\s*/m,'').replace(/^```\s*/m,'').replace(/\s*```$/m,'').trim();
          const i = s.indexOf('{'), j = s.lastIndexOf('}');
          parsed = JSON.parse(s.substring(i, j+1));
        } catch { return; }
        
        if (parsed && parsed.newPrompt && parsed.newPrompt.includes("thinking") && parsed.newPrompt.includes("action")) {
          await this.saveVersion(parsed.newPrompt, parsed.reason || "Auto-evolved based on negative feedback");
          this.logger.info(`✨ 提示詞優化完成！原因：${parsed.analysis}`);
        }
      }
    } catch (e) {
      this.logger.warn(`提示詞優化失敗: ${e.message}`);
    }
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
