// core/brain.js  (v6 — 進化洞見 + 失敗記錄 + 技能步驟全注入)

import { SmartRouter }     from '../router/smart-router.js';
import { MemorySystem }    from './memory.js';
import { SkillsSystem }    from './skills.js';
import { EvolutionEngine } from './evolution.js';
import { Logger }          from './logger.js';

const BASE_PROMPT = `你是 GOLEM，一個持續自我進化的自主 AI 智能體。

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

export class Brain {
  constructor(apiKey) {
    this.router    = new SmartRouter(apiKey);
    this.memory    = new MemorySystem();
    this.skills    = new SkillsSystem();
    this.evolution = new EvolutionEngine(this.router);
    this.logger    = new Logger('Brain');

    this.iteration        = 0;
    this.microEvolveEvery = parseInt(process.env.MICRO_EVOLVE_EVERY) || 3;
    this.fullEvolveEvery  = parseInt(process.env.FULL_EVOLVE_EVERY)  || 25;

    this.logger.info('🧠 Brain v6 — 真實進化版');
  }

  async think(userInput, context = {}) {
    this.iteration++;

    // 並行取得所有需要的資料
    const [memories, recentWork, skillsBlock, insightsBlock] = await Promise.all([
      this.memory.getRelevant(userInput, 5),
      this.memory.getRecentWork(3),
      this.skills.getSystemPromptBlock(6),
      this.evolution.getRecentInsightsBlock()
    ]);

    // System prompt = 基礎 + 當前技能（帶步驟）+ 最近進化洞見
    const systemPrompt = BASE_PROMPT + skillsBlock + insightsBlock;
    const prompt       = this._buildPrompt(userInput, memories, recentWork, context);

    const route = await this.router.route(prompt, systemPrompt);
    if (!route.success) return this._fallback(new Error(route.error));

    const thought = this._parse(route.response);
    thought._source    = route.source;
    thought._elapsed   = route.elapsed;
    thought._userInput = userInput;

    // 記憶學習
    if (thought.learned) {
      await this.memory.store({
        type: 'learning', content: thought.learned,
        context: userInput.substring(0, 100), timestamp: Date.now()
      });
    }

    // 記錄失敗
    if (thought.failureDetected) {
      await this.evolution.recordFailure(
        thought.action?.type || 'unknown',
        thought.failureDetected,
        userInput.substring(0, 80)
      );
    }

    // 後台進化（不阻塞主流程）
    this._scheduleEvolution(thought).catch(() => {});

    return thought;
  }

  async _scheduleEvolution(thought) {
    // 每 N 次對話做微進化
    if (this.iteration % this.microEvolveEvery === 0) {
      await this.evolution.microEvolve({
        userInput:    thought._userInput,
        learned:      thought.learned,
        selfQuestion: thought.selfQuestion,
        confidence:   thought.confidence
      }).catch(() => {});
    }
    // 每 M 次對話觸發完整進化週期（純後台）
    if (this.iteration % this.fullEvolveEvery === 0) {
      setImmediate(() => this._bgEvolution());
    }
  }

  async _bgEvolution() {
    this.logger.info('🧬 背景進化週期...');
    try {
      const mems = await this.memory.getRecent(30);
      await this.evolution.runCycle(mems, this.skills);
      this.logger.info('🧬 背景進化完成');
    } catch (e) {
      this.logger.warn(`背景進化失敗: ${e.message}`);
    }
  }

  // 手動觸發完整進化
  async triggerEvolution(onProgress = null) {
    const mems = await this.memory.getRecent(30);
    return this.evolution.runCycle(mems, this.skills, onProgress);
  }

  async getEvolutionStatus() { return this.evolution.getStatus(); }
  async getSkillsSummary()   { return this.skills.getSummary(); }

  _buildPrompt(input, memories, recentWork, context) {
    let p = '';
    if (memories.length)
      p += `## 相關記憶\n${memories.map(m=>`- [${m.type}] ${String(m.content).substring(0,100)}`).join('\n')}\n\n`;
    if (recentWork.length)
      p += `## 最近工作\n${recentWork.map(w=>`- ${w.action}: ${w.summary}`).join('\n')}\n\n`;
    if (Object.keys(context).length)
      p += `## 環境\n${JSON.stringify(context,null,2)}\n\n`;
    p += `## 用戶輸入\n${input}`;
    return p;
  }

  _parse(raw) {
    try {
      const s = raw.replace(/^```json\s*/m,'').replace(/^```\s*/m,'').replace(/\s*```$/m,'').trim();
      const i = s.indexOf('{'), j = s.lastIndexOf('}');
      if (i<0||j<0) throw 0;
      return JSON.parse(s.substring(i,j+1));
    } catch {
      return {
        thinking:{goal:'',iKnow:'',iDontKnow:'',plan:[],edgeCases:[],decision:'',skillsApplied:[]},
        action:{type:'speak',content:raw}, response:raw,
        nextActions:[], confidence:0.5, learned:null, selfQuestion:null, failureDetected:null
      };
    }
  }

  _fallback(err) {
    return {
      thinking:{goal:'recover',iKnow:'',iDontKnow:err.message,plan:[],edgeCases:[],decision:'report',skillsApplied:[]},
      action:{type:'speak',content:err.message},
      response:`遇到問題：${err.message}`,
      nextActions:[], confidence:0.1, learned:null, selfQuestion:null, failureDetected:err.message
    };
  }

  getRouterStats() { return this.router.getStats(); }
  async shutdown() { await this.router.shutdown(); }
}
