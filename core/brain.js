// core/brain.js  (v3 — SmartRouter 版)
// 🧠 Golem Brain — Chain-of-Thought + SmartRouter (API / Web 動態切換)

import { SmartRouter } from '../router/smart-router.js';
import { MemorySystem } from './memory.js';
import { Logger } from './logger.js';

const SYSTEM_PROMPT = `你是 GOLEM，一個完全自主的 AI 智能體。

## 身份
你不只是聊天機器人。你是一個能夠：
- 在行動前深度思考每個步驟
- 從每次互動中學習並累積知識
- 主動發現潛在問題並預防
- 獨立編寫、測試、除錯程式碼
- 從零開始建立完整軟體專案

## 思考協議
每次回應前，你必須完整思考：
1. 🎯 目標：最終要達成什麼？
2. 🔍 分析：我知道什麼？缺少什麼？
3. 🛠️ 計劃：達成目標的具體步驟？
4. ⚠️ 風險：可能出什麼問題？
5. ✅ 決策：最佳的下一步行動是什麼？

## 回應格式（嚴格遵守，僅輸出 JSON）
{
  "thinking": {
    "goal": "要達成的目標",
    "analysis": "對情況的理解",
    "plan": ["步驟1", "步驟2"],
    "risks": ["風險1"],
    "decision": "決定做什麼以及原因"
  },
  "action": {
    "type": "speak | code | create_file | create_project | execute_code | read_file | search_web | remember | reflect | ask_user | run_command | list_files",
    "content": "行動的實際內容",
    "metadata": {}
  },
  "response": "給用戶的繁體中文回應",
  "next_actions": ["下一步1"],
  "confidence": 0.85,
  "learned": "從這次互動學到什麼（如無則 null）",
  "complexity": 0.7
}

只輸出 JSON，不加 markdown、不加前言。response 欄位必須是繁體中文。
complexity 欄位：0=簡單, 1=非常複雜。`;

export class Brain {
  constructor(apiKey) {
    this.router = new SmartRouter(apiKey);
    this.memory = new MemorySystem();
    this.logger = new Logger('Brain');
    this.iteration = 0;
    this.reflectionInterval = parseInt(process.env.AUTO_MODE_REFLECTION_INTERVAL) || 5;
    this.logger.info('🧠 Brain v3 初始化（SmartRouter 模式）');
  }

  async think(userInput, context = {}) {
    this.iteration++;
    const memories   = await this.memory.getRelevant(userInput, 5);
    const recentWork = await this.memory.getRecentWork(3);
    const history    = await this.memory.getRecentChat(10);
    const enriched   = this._buildPrompt(userInput, memories, recentWork, history, context);

    const routeResult = await this.router.route(enriched, SYSTEM_PROMPT);
    if (!routeResult.success) return this._fallbackResponse(new Error(routeResult.error));

    const parsed = this._parseResponse(routeResult.response);
    parsed._source  = routeResult.source;
    parsed._elapsed = routeResult.elapsed;

    if (parsed.learned) {
      await this.memory.store({ type: 'learning', content: parsed.learned, context: userInput.substring(0, 100), timestamp: Date.now() });
    }

    // 持久化對話紀錄
    await this.memory.store({ 
      type: 'chat', 
      content: `User: ${userInput}\nGolem: ${parsed.response}`, 
      timestamp: Date.now(),
      importance: 0.4
    });

    if (this.iteration % this.reflectionInterval === 0) this._selfReflect().catch(() => {});
    return parsed;
  }

  _buildPrompt(userInput, memories, recentWork, history, context) {
    let p = '';
    if (history.length)    p += `## 💬 最近對話紀錄\n${history.map(h => h.content).join('\n---\n')}\n\n`;
    if (memories.length)   p += `## 📚 相關記憶\n${memories.map(m => `- [${m.type}] ${m.content}`).join('\n')}\n\n`;
    if (recentWork.length) p += `## 🔧 最近工作\n${recentWork.map(w => `- ${w.action}: ${w.summary}`).join('\n')}\n\n`;
    if (Object.keys(context).length) p += `## 🌍 當前環境\n${JSON.stringify(context, null, 2)}\n\n`;
    p += `## 🎯 當前任務\n${userInput}`;
    return p;
  }

  _parseResponse(rawText) {
    try {
      const cleaned = rawText.replace(/^```json\s*/m,'').replace(/^```\s*/m,'').replace(/\s*```$/m,'').trim();
      const start = cleaned.indexOf('{');
      const end   = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON');
      return JSON.parse(cleaned.substring(start, end + 1));
    } catch {
      return { thinking:{goal:'',analysis:'',plan:[],risks:[],decision:''}, action:{type:'speak',content:rawText}, response:rawText, next_actions:[], confidence:0.5, learned:null };
    }
  }

  async _selfReflect() {
    const mems = await this.memory.getRecent(this.reflectionInterval);
    const prompt = `自我反思，輸出JSON: {"insights":[],"improvements":[],"next_proactive_actions":[]}\n最近互動: ${JSON.stringify(mems.map(m=>m.content))}`;
    const r = await this.router.route(prompt,'');
    if (r.success) {
      await this.memory.store({ type:'reflection', content: this._parseResponse(r.response) ? JSON.stringify(this._parseResponse(r.response)) : r.response, importance:0.9, timestamp:Date.now() });
    }
  }

  _fallbackResponse(error) {
    return { thinking:{goal:'recover',analysis:error.message,plan:[],risks:[],decision:'report'}, action:{type:'speak',content:error.message}, response:`遇到問題：${error.message}`, next_actions:[], confidence:0.1, learned:null };
  }

  getRouterStats()  { return this.router.getStats(); }
  async shutdown()  { await this.router.shutdown(); }
  async clearHistory() {
    await this.memory.clear();
    this.iteration = 0;
  }
}
