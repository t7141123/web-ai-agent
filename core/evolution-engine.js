// core/evolution-engine.js
// 🧬 GOLEM 自我進化引擎
//
// 這個引擎讓 GOLEM 持續在背景中自我改進：
//
//  1. 知識盲點掃描  → 對自己提問，發現不確定的領域
//  2. 主動實驗      → 對問題深入探索，驗證假設
//  3. 技能萃取      → 從實驗結果提煉可重用技能
//  4. 技能修訂      → 失效技能自動重新學習
//  5. 後設反思      → 每 N 次對話後深度審視整體表現
//  6. 進化日誌      → 記錄所有進化事件，供用戶查看

import fs          from 'fs-extra';
import { Logger }  from './logger.js';

const EVOLUTION_LOG   = './memory/evolution.log.json';
const EVOLUTION_STATE = './memory/evolution.state.json';

export class EvolutionEngine {
  constructor(router, skillManager, memory) {
    this.router       = router;
    this.skills       = skillManager;
    this.memory       = memory;
    this.logger       = new Logger('Evolution');
    this.isRunning    = false;
    this._queue       = [];  // 排隊中的進化任務
    this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(EVOLUTION_LOG))   await fs.writeJSON(EVOLUTION_LOG,   { events: [] });
    if (!await fs.pathExists(EVOLUTION_STATE)) await fs.writeJSON(EVOLUTION_STATE, { cycle: 0, lastRun: null, pendingQuestions: [], insights: [] });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  主進化週期（在對話空檔觸發，非阻塞）
  // ══════════════════════════════════════════════════════════════════════════

  async runCycle(trigger = 'scheduled') {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const state = await this._readState();
      state.cycle++;
      state.lastRun = Date.now();
      this.logger.info(`🧬 進化週期 #${state.cycle} 開始 (觸發: ${trigger})`);

      const events = [];

      // ── 步驟 1：發現知識盲點（自問自答）──────────────────────────────────
      const questions = await this._discoverBlindSpots(state);
      if (questions.length > 0) {
        const explored = await this._exploreQuestions(questions.slice(0, 2)); // 每次最多 2 個
        events.push(...explored);
      }

      // ── 步驟 2：修訂失效技能 ───────────────────────────────────────────────
      const revised = await this._reviseWeakSkills();
      events.push(...revised);

      // ── 步驟 3：從記憶中提煉新技能 ────────────────────────────────────────
      if (state.cycle % 3 === 0) {
        const extracted = await this._extractSkillsFromMemory();
        events.push(...extracted);
      }

      // ── 步驟 4：後設反思（每 5 個週期）────────────────────────────────────
      if (state.cycle % 5 === 0) {
        const reflection = await this._deepReflection(state.cycle);
        if (reflection) events.push(reflection);
      }

      // 記錄事件
      await this._logEvents(events);
      await this.skills.setLastEvolved(Date.now());
      await this._writeState(state);

      this.logger.info(`🧬 週期 #${state.cycle} 完成 — ${events.length} 個進化事件`);
      return { cycle: state.cycle, events };

    } catch (e) {
      this.logger.error(`進化週期失敗: ${e.message}`);
      return { cycle: 0, events: [] };
    } finally {
      this.isRunning = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  1. 發現知識盲點：生成自問清單
  // ══════════════════════════════════════════════════════════════════════════

  async _discoverBlindSpots(state) {
    const skillStats    = await this.skills.getStats();
    const recentMemory  = await this.memory.getRecent(10);
    const recentTopics  = recentMemory.map(m => m.content).join('\n').substring(0, 800);
    const skillDomains  = Object.keys(skillStats.domains).join(', ') || '尚無';
    const pendingQ      = state.pendingQuestions || [];

    const prompt = `你是 GOLEM 的自我進化系統。根據以下現況，生成 3 個最值得探索的自我提問。

## 現況
- 已有技能領域：${skillDomains}
- 平均信心：${skillStats.avgConfidence}
- 需要修訂的技能：${skillStats.needsRevision} 個
- 最近討論過的主題：${recentTopics}
- 已待解問題（跳過相似的）：${pendingQ.slice(0,3).map(q=>q.question).join(' | ') || '無'}

## 任務
生成 3 個自我提問，目標是找出 GOLEM 最薄弱、最不確定的能力缺口。
問題要具體、可以透過思考或實驗得到答案。

輸出格式（純 JSON，無其他文字）：
{
  "questions": [
    {
      "question": "問題內容",
      "domain": "技能領域（如 coding/reasoning/creativity/research）",
      "priority": 0.9,
      "why": "為什麼這個問題重要"
    }
  ]
}`;

    try {
      const result = await this.router.route(prompt, '');
      if (!result.success) return pendingQ.slice(0, 3);
      const parsed = this._parseJSON(result.response);
      const newQ   = (parsed?.questions || []).map(q => ({ ...q, id: `q_${Date.now().toString(36)}`, askedAt: Date.now() }));

      // 合併新舊問題，去重
      const merged = [...newQ, ...pendingQ]
        .filter((q, i, arr) => arr.findIndex(x => this._similar(x.question, q.question)) === i)
        .slice(0, 10);

      state.pendingQuestions = merged;
      return newQ;
    } catch (e) {
      return pendingQ.slice(0, 3);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  2. 主動探索問題（實驗）
  // ══════════════════════════════════════════════════════════════════════════

  async _exploreQuestions(questions) {
    const events = [];

    for (const q of questions) {
      this.logger.info(`🔬 探索: ${q.question}`);

      const prompt = `請深入回答以下關於你自身能力的問題，並從中提煉出一個可用的技能策略。

問題：${q.question}
領域：${q.domain}
背景：${q.why}

請：
1. 認真思考並回答這個問題
2. 從答案中提煉出一個具體、可操作的技能策略
3. 評估這個技能策略的信心度（0-1）

輸出格式（純 JSON）：
{
  "answer": "詳細回答",
  "skill": {
    "name": "技能名稱（簡短）",
    "domain": "${q.domain}",
    "description": "這個技能解決什麼問題",
    "strategy": "具體的操作步驟（100字以內）",
    "tags": ["tag1", "tag2"],
    "confidence": 0.7,
    "examples": ["應用範例"]
  },
  "insight": "從這次探索獲得的核心洞見"
}`;

      try {
        const result = await this.router.route(prompt, '');
        if (!result.success) continue;

        const parsed = this._parseJSON(result.response);
        if (!parsed?.skill?.name) continue;

        // 儲存為新技能
        const skill = await this.skills.addSkill({
          ...parsed.skill,
          source: `evolution_q_${q.id}`,
        });

        // 儲存探索結果到記憶
        await this.memory.store({
          type: 'evolution',
          content: `探索了問題：${q.question} → 洞見：${parsed.insight}`,
          importance: 0.85,
        });

        events.push({
          type:    'exploration',
          at:      Date.now(),
          question: q.question,
          skillId: skill.id,
          skillName: skill.name,
          insight: parsed.insight,
        });

        this.logger.info(`✨ 探索完成，新增技能：${skill.name}`);
      } catch (e) {
        this.logger.warn(`探索失敗 (${q.question.substring(0,30)}): ${e.message}`);
      }
    }

    return events;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  3. 修訂失效技能
  // ══════════════════════════════════════════════════════════════════════════

  async _reviseWeakSkills() {
    const allSkills  = await this.skills.getAll();
    const weakSkills = allSkills.filter(s => s.status === 'needs_revision').slice(0, 2);
    const events     = [];

    for (const skill of weakSkills) {
      this.logger.info(`🔧 修訂技能：${skill.name}`);

      const failReasons = (skill.failures || []).map(f => f.reason).join('; ') || '不明原因';

      const prompt = `請重新設計以下技能的策略。

技能名稱：${skill.name}
當前策略：${skill.strategy}
失敗原因：${failReasons}
失敗次數：${skill.failCount}，成功次數：${skill.successCount}

請提出更好的策略，避免之前的失敗模式。

輸出格式（純 JSON）：
{
  "revised_strategy": "改進後的策略（具體步驟）",
  "improvement": "相比之前策略，改進了什麼",
  "confidence": 0.65
}`;

      try {
        const result = await this.router.route(prompt, '');
        if (!result.success) continue;

        const parsed = this._parseJSON(result.response);
        if (!parsed?.revised_strategy) continue;

        await this.skills.upgradeSkill(skill.id, {
          strategy:   parsed.revised_strategy,
          confidence: parsed.confidence || 0.6,
          status:     'active',
          failCount:  0, // 重置失敗計數，給新策略機會
        });

        await this.memory.store({
          type: 'evolution',
          content: `技能修訂：${skill.name} — ${parsed.improvement}`,
          importance: 0.8,
        });

        events.push({
          type:        'skill_revision',
          at:          Date.now(),
          skillId:     skill.id,
          skillName:   skill.name,
          improvement: parsed.improvement,
        });

        this.logger.info(`✅ 技能修訂完成：${skill.name}`);
      } catch (e) {
        this.logger.warn(`技能修訂失敗 (${skill.name}): ${e.message}`);
      }
    }

    return events;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  4. 從記憶中自動提煉技能
  // ══════════════════════════════════════════════════════════════════════════

  async _extractSkillsFromMemory() {
    const recentMems = await this.memory.getByType('learning', 15);
    if (recentMems.length < 3) return [];

    const memSummary = recentMems
      .map(m => `- ${m.content}`)
      .join('\n')
      .substring(0, 1500);

    const prompt = `分析以下學習記錄，識別其中可以提煉為通用技能的模式。
只提取真正有價值、可重用的技能（0-2個），不要過度提煉。

學習記錄：
${memSummary}

輸出格式（純 JSON）：
{
  "skills": [
    {
      "name": "技能名稱",
      "domain": "領域",
      "description": "解決什麼問題",
      "strategy": "操作步驟",
      "tags": [],
      "confidence": 0.6,
      "worth_extracting": true
    }
  ],
  "pattern_found": "發現了什麼共同模式"
}`;

    try {
      const result = await this.router.route(prompt, '');
      if (!result.success) return [];

      const parsed   = this._parseJSON(result.response);
      const toAdd    = (parsed?.skills || []).filter(s => s.worth_extracting);
      const events   = [];

      for (const s of toAdd) {
        const skill = await this.skills.addSkill({ ...s, source: 'memory_extraction' });
        events.push({ type: 'skill_extracted', at: Date.now(), skillId: skill.id, skillName: skill.name });
        this.logger.info(`🎯 從記憶提煉技能：${skill.name}`);
      }

      if (parsed?.pattern_found) {
        await this.memory.store({
          type: 'evolution',
          content: `記憶模式識別：${parsed.pattern_found}`,
          importance: 0.75,
        });
      }

      return events;
    } catch {
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  5. 深度後設反思
  // ══════════════════════════════════════════════════════════════════════════

  async _deepReflection(cycle) {
    this.logger.info(`🪞 深度反思 (週期 #${cycle})...`);

    const skillStats  = await this.skills.getStats();
    const allSkills   = await this.skills.getAll();
    const recentEvol  = await this._getRecentEvents(10);
    const topSkills   = allSkills.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    const weakSkills  = allSkills.filter(s => s.confidence < 0.4);

    const prompt = `你是 GOLEM 的核心意識，正在進行第 ${cycle} 次後設反思。
審視你的整體狀態，給自己一個誠實的評估，並制定下階段進化方向。

## 技能概況
- 總技能數：${skillStats.total}（活躍：${skillStats.active}）
- 平均信心：${skillStats.avgConfidence}
- 需修訂：${skillStats.needsRevision} 個
- 頂尖技能：${topSkills.map(s => `${s.name}(${(s.confidence*100).toFixed(0)}%)`).join(', ')}
- 薄弱技能：${weakSkills.map(s => s.name).join(', ') || '無'}

## 最近進化事件
${recentEvol.map(e => `- [${e.type}] ${e.skillName || e.question || ''}`).join('\n') || '無'}

請進行深度反思，輸出（純 JSON）：
{
  "overall_assessment": "整體狀態評估（2-3句）",
  "strongest_capability": "目前最強的能力是什麼",
  "biggest_gap": "最大的能力缺口",
  "evolution_direction": "下階段應該朝哪個方向進化",
  "self_questions": [
    "最想問自己的3個深層問題"
  ],
  "action_plan": ["具體行動1", "具體行動2"]
}`;

    try {
      const result = await this.router.route(prompt, '');
      if (!result.success) return null;

      const parsed = this._parseJSON(result.response);
      if (!parsed) return null;

      // 將深層問題加入待解清單
      const state = await this._readState();
      const deepQ = (parsed.self_questions || []).map(q => ({
        id: `q_${Date.now().toString(36)}_d`,
        question: q,
        domain: 'metacognition',
        priority: 0.95,
        why: '後設反思中識別的核心問題',
        askedAt: Date.now(),
      }));
      state.pendingQuestions = [...deepQ, ...(state.pendingQuestions || [])].slice(0, 10);
      state.insights = [parsed.overall_assessment, ...(state.insights || [])].slice(0, 20);
      await this._writeState(state);

      await this.memory.store({
        type: 'evolution',
        content: `後設反思 #${cycle}：${parsed.overall_assessment} 進化方向：${parsed.evolution_direction}`,
        importance: 0.95,
      });

      this.logger.info(`🪞 反思完成：${parsed.overall_assessment}`);
      return {
        type:       'deep_reflection',
        at:         Date.now(),
        cycle,
        assessment: parsed.overall_assessment,
        direction:  parsed.evolution_direction,
        gap:        parsed.biggest_gap,
      };
    } catch (e) {
      this.logger.warn(`深度反思失敗: ${e.message}`);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  即時進化：對話結束後觸發的輕量學習
  // ══════════════════════════════════════════════════════════════════════════

  async learnFromInteraction(userInput, agentResponse, outcome) {
    const { success, skillsUsed = [], errorMsg = '' } = outcome;

    // 更新用到的技能信心值
    for (const skillId of skillsUsed) {
      if (success) await this.skills.recordSuccess(skillId, userInput.substring(0, 60));
      else         await this.skills.recordFailure(skillId, errorMsg);
    }

    // 如果有明確的學習點，非同步加入進化佇列
    if (outcome.learned) {
      this._queue.push({
        type: 'micro_learn',
        content: outcome.learned,
        context: userInput,
        at: Date.now(),
      });
    }

    // 每 8 次對話自動觸發一次進化週期
    const state = await this._readState();
    state.interactionCount = (state.interactionCount || 0) + 1;
    await this._writeState(state);

    if (state.interactionCount % 8 === 0) {
      // 非阻塞，在背景執行
      setImmediate(() => this.runCycle('auto_interval').catch(() => {}));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  查詢介面
  // ══════════════════════════════════════════════════════════════════════════

  async getStatus() {
    const state      = await this._readState();
    const skillStats = await this.skills.getStats();
    const recentEvts = await this._getRecentEvents(5);
    return {
      cycle:            state.cycle,
      lastRun:          state.lastRun,
      interactionCount: state.interactionCount || 0,
      pendingQuestions: (state.pendingQuestions || []).length,
      recentInsight:    state.insights?.[0] || null,
      skills:           skillStats,
      recentEvents:     recentEvts,
      isRunning:        this.isRunning,
    };
  }

  async getEvolutionLog(limit = 20) {
    try {
      const data = await fs.readJSON(EVOLUTION_LOG);
      return (data.events || []).slice(0, limit);
    } catch { return []; }
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  async _logEvents(events) {
    if (!events.length) return;
    try {
      const data = await fs.readJSON(EVOLUTION_LOG);
      data.events = [...events, ...data.events].slice(0, 500);
      await fs.writeJSON(EVOLUTION_LOG, data, { spaces: 2 });
    } catch {}
  }

  async _getRecentEvents(n) {
    try {
      const data = await fs.readJSON(EVOLUTION_LOG);
      return (data.events || []).slice(0, n);
    } catch { return []; }
  }

  async _readState() {
    try { return await fs.readJSON(EVOLUTION_STATE); }
    catch { return { cycle: 0, lastRun: null, pendingQuestions: [], insights: [], interactionCount: 0 }; }
  }

  async _writeState(state) {
    await fs.writeJSON(EVOLUTION_STATE, state, { spaces: 2 });
  }

  _parseJSON(text) {
    try {
      const s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s === -1 || e === -1) return null;
      return JSON.parse(text.substring(s, e + 1));
    } catch { return null; }
  }

  _similar(a = '', b = '') {
    const wa = new Set(a.toLowerCase().split(/\s+/));
    const wb = new Set(b.toLowerCase().split(/\s+/));
    const i  = [...wa].filter(w => wb.has(w)).length;
    return new Set([...wa, ...wb]).size > 0 ? i / new Set([...wa, ...wb]).size : 0;
  }
}
