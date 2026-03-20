// core/brain.js  (v7 — 真實自我進化版)

import { SmartRouter }       from '../router/smart-router.js';
import { MemorySystem }      from './memory.js';
import { SkillsSystem }      from './skills.js';
import { EvolutionEngine }   from './evolution.js';
import { PromptEvolver }     from './prompt-evolver.js';
import { SelfEvolutionCore } from './self-evolution.js';
import { SelfMonitor }       from './self-monitor.js';
import { Logger }            from './logger.js';
import { DECISION_TYPES, EXPERIMENT_TYPES } from './self-evolution.js';

export class Brain {
  constructor(apiKey) {
    this.router        = new SmartRouter(apiKey);
    this.memory        = new MemorySystem(apiKey);
    this.skills        = new SkillsSystem();
    this.evolution     = new EvolutionEngine(this.router);
    this.promptEvolver = new PromptEvolver(this.router);
    this.selfEvolution = new SelfEvolutionCore(this);
    this.selfMonitor   = new SelfMonitor(this);
    this.logger        = new Logger('Brain');

    // 讓進化引擎可以直接操作技能系統
    this.evolution.setSkillsRef(this.skills);

    this.iteration        = 0;
    this.microEvolveEvery = parseInt(process.env.MICRO_EVOLVE_EVERY) || 3;
    this.fullEvolveEvery  = parseInt(process.env.FULL_EVOLVE_EVERY)  || 25;

    this.logger.info('🧠 Brain v7 — 真實自我進化版');
  }

  async think(userInput, context = {}) {
    this.iteration++;

    // 並行取得所有需要的資料
    const [memories, recentWork, skillsBlock, insightsBlock, basePrompt] = await Promise.all([
      this.memory.getRelevant(userInput, 5),
      this.memory.getRecentWork(3),
      this.skills.getSystemPromptBlock(6),
      this.evolution.getRecentInsightsBlock(),
      this.promptEvolver.getActivePrompt()
    ]);

    // System prompt = 基礎 + 當前技能（帶步驟）+ 最近進化洞見
    const systemPrompt = basePrompt + "\n" + skillsBlock + insightsBlock;
    const prompt       = this._buildPrompt(userInput, memories, recentWork, context);

    const route = await this.router.route(prompt, systemPrompt);
    if (!route.success) return this._fallback(new Error(route.error));

    const thought = this._parse(route.response);
    thought._source    = route.source;
    thought._elapsed   = route.elapsed;
    thought._userInput = userInput;

    // 🧬 追蹤路由決策
    await this.selfEvolution.trackDecision(DECISION_TYPES.ROUTE_CHOICE, {
      route: route.source,
      complexityScore: route.decision?.score,
      reason: route.decision?.reason,
      confidence: thought.confidence,
    }, {
      success: route.success,
      elapsed: route.elapsed,
    });

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

  // 新增：處理執行結果，更新技能強度
  async processOutcome(thought, result) {
    const isSuccess = result?.success !== false && !result?.error;

    // 將執行結果和使用的技能關聯起來
    const skillsApplied = thought.thinking?.skillsApplied || [];

    if (skillsApplied.length > 0) {
      // 在本地快取找到對應 ID
      const allSkills = await this.skills.getAll();
      for (const skillName of skillsApplied) {
        // 模糊比對名稱或 ID
        const matched = allSkills.find(s =>
          s.id === skillName ||
          s.name.includes(skillName) ||
          skillName.includes(s.name)
        );

        if (matched) {
          if (isSuccess && !thought.failureDetected) {
            await this.skills.recordSuccess(matched.id, thought._userInput?.substring(0, 60));
          } else {
            const errorMsg = result?.error || thought.failureDetected || '執行失敗或未達預期';
            await this.skills.recordFailure(matched.id, errorMsg);
          }
        }
      }

      // 🧬 追蹤技能應用決策
      await this.selfEvolution.trackDecision(DECISION_TYPES.SKILL_APPLICATION, {
        skillsApplied,
        taskType: thought.action?.type,
        confidence: thought.confidence,
      }, {
        success: isSuccess,
        confidence: thought.confidence,
      });
    }

    // 🧬 追蹤動作選擇決策
    await this.selfEvolution.trackDecision(DECISION_TYPES.ACTION_SELECTION, {
      actionType: thought.action?.type,
      alternatives: [], // 可以擴充記錄其他考慮過的選項
      confidence: thought.confidence,
    }, {
      success: isSuccess,
      output: result?.output?.substring(0, 100),
    });

    // 🧬 將執行結果回饋給自我進化系統
    await this.evolution.learnFromInteraction(
      thought._userInput,
      thought.response,
      {
        success: isSuccess,
        skillsUsed: skillsApplied.map(s => s.id || s),
        errorMsg: result?.error || thought.failureDetected,
      }
    );

    // 👁️ 自我監控追蹤
    await this.selfMonitor.trackInteraction(thought._userInput, thought, result);
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

      // 修訂失效技能
      await this.evolution.reviseWeakSkills(this.skills);

      // 從記憶中提煉新技能
      await this.evolution.extractSkillsFromMemory(this.memory, this.skills);

      // 記憶系統維護：壓縮舊記憶 + 補全向量
      await this.memory.consolidate();
      await this.memory.backfillEmbeddings();

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
