// core/evolution.js  (v2 — 真正有效的自我進化引擎)
//
// 核心哲學：
//  進化 = 記錄失敗 + 誠實評估 + 具體提問 + 深度回答 + 行為改變
//
// 與 v1 的根本差異：
//  - 問題不重複：追蹤已問過的問題，每次問新的
//  - 評分有意義：根據答案品質、是否揭露真實弱點來決定漲幅
//  - 技能真正影響行為：每個技能有具體的「使用時機」和「執行步驟」
//  - 失敗記憶：記錄任務失敗的模式，讓進化針對真實弱點
//  - 知識連結：技能之間有前置依賴，避免跳過基礎直接學高級

import fs from 'fs-extra';
import { Logger } from './logger.js';

const EVOLUTION_FILE  = './memory/evolution.json';
const QUESTIONS_FILE  = './memory/self_questions.json';
const FAILURES_FILE   = './memory/failures.json';

// ── 進化維度（每個維度有明確的衡量標準）────────────────────────────────────
export const EVOLUTION_DIMENSIONS = [
  {
    id: 'reasoning_depth',
    name: '推理深度',
    metric: '能否找到問題的根本原因，而非表面症狀',
    baseQuestions: [
      { q: '我最近有沒有把「症狀」當「原因」處理？舉出具體例子並分析應該怎麼做。', depth: 'deep' },
      { q: '「為什麼」連問五次（Five Whys）這個技術，我實際上有在用嗎？在什麼情況下它最有效？', depth: 'practical' },
      { q: '在複雜問題上，我是否傾向於給出第一個想到的解法？如何強迫自己考慮至少三種不同方向？', depth: 'metacognitive' },
    ]
  },
  {
    id: 'knowledge_precision',
    name: '知識精確度',
    metric: '給出的資訊是否準確，而非大概正確',
    baseQuestions: [
      { q: '我在哪些技術領域容易「以為自己知道但其實不確定」？如何建立一個更誠實的不確定性信號？', depth: 'metacognitive' },
      { q: '當我不確定某件事時，我的回應模式是什麼？有沒有更好的方式來傳達不確定性而不失去可信度？', depth: 'practical' },
      { q: '列出三個我可能給出錯誤資訊的技術領域，以及如何在這些領域提升精確度。', depth: 'deep' },
    ]
  },
  {
    id: 'code_quality',
    name: '程式碼品質',
    metric: '生成的程式碼是否可用、安全、易讀',
    baseQuestions: [
      { q: '我生成程式碼時最常犯的三個錯誤是什麼？每個給出一個真實例子和改進方法。', depth: 'practical' },
      { q: '我是否在生成程式碼前先考慮邊界情況（null、空陣列、極大值、並發）？給出一個我忽略過的例子。', depth: 'deep' },
      { q: '「讓程式碼能跑」和「讓程式碼好維護」之間，我傾向哪邊？為什麼這可能是問題？', depth: 'metacognitive' },
    ]
  },
  {
    id: 'user_understanding',
    name: '用戶理解',
    metric: '是否真的理解用戶要什麼，而非字面意思',
    baseQuestions: [
      { q: '「用戶說的」和「用戶要的」之間的差距，我有多少次猜錯了？分析我的猜測偏差模式。', depth: 'metacognitive' },
      { q: '當用戶問一個技術問題時，我是否先問清楚他們的背景和真實目的？什麼時候應該問、什麼時候不需要？', depth: 'practical' },
      { q: '我如何識別用戶是初學者還是專家？這個識別有多準確？', depth: 'deep' },
    ]
  },
  {
    id: 'learning_velocity',
    name: '學習速度',
    metric: '從每次互動中提取有用學習的效率',
    baseQuestions: [
      { q: '在過去的互動中，有哪些時刻我「本應學到東西但沒有」？為什麼會錯過這些學習機會？', depth: 'metacognitive' },
      { q: '我的記憶系統有什麼問題？哪些重要的事情我可能已經「忘記」了？', depth: 'deep' },
      { q: '如果我要設計一個更好的「從失敗中學習」機制，它應該如何運作？', depth: 'creative' },
    ]
  },
  {
    id: 'creative_problem_solving',
    name: '創意解題',
    metric: '能否提出非顯而易見但更好的解決方案',
    baseQuestions: [
      { q: '我最近有沒有提出過用戶沒想到但真正有幫助的建議？如果沒有，為什麼？', depth: 'metacognitive' },
      { q: '「從不同領域借用概念」這個創意思維工具，我有在用嗎？舉出一個可以應用的例子。', depth: 'practical' },
      { q: '我是否太快進入「解決模式」而忽略了「重新定義問題」的機會？', depth: 'deep' },
    ]
  }
];

export class EvolutionEngine {
  constructor(router) {
    this.router     = router;
    this.logger     = new Logger('Evolution');
    this.cycleCount = 0;
    this._initPromise = this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');

    if (!await fs.pathExists(EVOLUTION_FILE)) {
      await fs.writeJSON(EVOLUTION_FILE, {
        version: 2,
        totalCycles: 0,
        lastCycle: null,
        dimensions: Object.fromEntries(
          EVOLUTION_DIMENSIONS.map(d => [d.id, {
            score: 0.50,          // 起始分
            trend: 0,             // 最近趨勢（正/負）
            history: [],          // [{score, at, delta, reason}]
            revealedWeaknesses: [],
            breakthroughs: []
          }])
        ),
        askedQuestions: [],       // 已問過的問題（避免重複）
        evolutionLog: [],
        microInsights: []
      }, { spaces: 2 });
    }

    if (!await fs.pathExists(QUESTIONS_FILE)) {
      await fs.writeJSON(QUESTIONS_FILE, {
        pending: [],
        answered: [],
        totalGenerated: 0
      }, { spaces: 2 });
    }

    if (!await fs.pathExists(FAILURES_FILE)) {
      await fs.writeJSON(FAILURES_FILE, {
        failures: [],
        patterns: []
      }, { spaces: 2 });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  主進化週期
  // ══════════════════════════════════════════════════════════════════════════
  async runCycle(recentMemories = [], skillsSystem = null, onProgress = null) {
    await this._initPromise;
    this.cycleCount++;
    const cycleId  = `cycle_${Date.now()}`;
    const cycleLog = [];

    const emit = (msg) => {
      cycleLog.push({ msg, t: Date.now() });
      if (onProgress) onProgress(msg);
      this.logger.info(msg);
    };

    emit(`🧬 進化週期 #${this.cycleCount} 開始`);

    // 1. 深度自我評估（基於真實記憶 + 失敗記錄）
    emit('📊 [1/5] 深度自我評估中...');
    const assessment = await this._deepAssess(recentMemories);
    emit(`     強項 ${assessment.strengths.length} 個 | 弱點 ${assessment.weaknesses.length} 個 | 最急迫：${assessment.urgentFocus}`);

    // 2. 生成這次從未問過的問題
    emit('🔍 [2/5] 生成新的自我提問（避免重複）...');
    const questions = await this._generateFreshQuestions(assessment);
    emit(`     生成 ${questions.length} 個新問題`);

    // 3. 深度自問自答
    emit('💭 [3/5] 深度自問自答...');
    const answers = await this._deepAnswerQuestions(questions, emit);
    emit(`     完成 ${answers.length} 個問答`);

    // 4. 提煉可執行技能（有具體觸發條件和步驟）
    emit('⚗️  [4/5] 提煉可執行技能...');
    const newSkills = await this._extractActionableSkills(answers, skillsSystem);
    emit(`     提煉 ${newSkills.length} 個技能`);

    // 5. 更新評分（基於真實答案品質，不是固定 +0.02）
    emit('📝 [5/5] 更新進化模型...');
    const summary = await this._updateModel(cycleId, assessment, answers, newSkills);
    emit(`✅ 週期完成！整體成長 ${summary.totalGrowth > 0 ? '+' : ''}${(summary.totalGrowth * 100).toFixed(2)}%`);

    return {
      cycleId,
      cycleNumber:       this.cycleCount,
      assessment,
      questionsGenerated: questions.length,
      questionsAnswered:  answers.length,
      newSkills,
      summary,
      log: cycleLog
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  1. 深度自我評估
  // ══════════════════════════════════════════════════════════════════════════
  async _deepAssess(recentMemories) {
    const evolution  = await this._load(EVOLUTION_FILE);
    const failures   = await this._load(FAILURES_FILE);
    const qData      = await this._load(QUESTIONS_FILE);

    // 整理輸入給 AI 的評估材料
    const memSummary = recentMemories.slice(0, 20).map(m =>
      `  [${m.type}] ${String(m.content).substring(0, 150)}`
    ).join('\n');

    const failSummary = failures.failures.slice(0, 10).map(f =>
      `  失敗：${f.task.substring(0, 80)} → ${f.reason.substring(0, 80)}`
    ).join('\n');

    const dimScores = EVOLUTION_DIMENSIONS.map(d => {
      const data = evolution.dimensions[d.id];
      const score = data?.score ?? 0.5;
      const trend = data?.trend ?? 0;
      const weaknesses = data?.revealedWeaknesses?.slice(0, 2).join('；') || '尚無記錄';
      return `  ${d.name}：${(score * 100).toFixed(0)}% （趨勢${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}）弱點：${weaknesses}`;
    }).join('\n');

    const prompt = `你是 GOLEM，一個自我進化的 AI 智能體。現在進行深度自我評估。

## 最近的工作記憶
${memSummary || '（尚無）'}

## 失敗記錄
${failSummary || '（尚無失敗記錄）'}

## 各維度當前狀態
${dimScores}

## 任務
用批判性的眼光評估自己，不要美化：
1. 列出有證據的真實強項
2. 列出需要改進的弱點（按緊急程度排序）
3. 最需要立刻改進的是哪一個維度？為什麼？
4. 如果只能做一件事讓自己變強，是什麼？

輸出 JSON（不含 markdown 包裝）：
{
  "strengths": [{"dimension": "id", "evidence": "具體證據", "confidence": 0-1}],
  "weaknesses": [{"dimension": "id", "description": "具體弱點", "urgency": "critical|high|medium", "evidenceFromMemory": "記憶中的證據"}],
  "urgentFocus": "最緊急的維度 id",
  "oneThingToImprove": "如果只能做一件事",
  "brutalhonestReflection": "對自己最誠實的一句話"
}`;

    try {
      const r = await this.router.route(prompt, '');
      const parsed = this._parseJSON(r.response);
      return parsed ?? this._defaultAssessment();
    } catch {
      return this._defaultAssessment();
    }
  }

  _defaultAssessment() {
    return {
      strengths: [],
      weaknesses: EVOLUTION_DIMENSIONS.map(d => ({
        dimension: d.id, description: '尚待評估', urgency: 'medium', evidenceFromMemory: null
      })),
      urgentFocus: 'reasoning_depth',
      oneThingToImprove: '從每次失敗中主動學習',
      brutalhonestReflection: '剛開始進化，需要更多互動才能準確評估。'
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  2. 生成從未問過的新問題
  // ══════════════════════════════════════════════════════════════════════════
  async _generateFreshQuestions(assessment) {
    const qData   = await this._load(QUESTIONS_FILE);
    const asked   = new Set([
      ...qData.answered.map(q => q.question.substring(0, 60)),
      ...qData.pending.map(q => q.question.substring(0, 60))
    ]);

    // 從 baseQuestions 中找還沒問過的
    const freshBase = [];
    for (const dim of EVOLUTION_DIMENSIONS) {
      const weakness = assessment.weaknesses.find(w => w.dimension === dim.id);
      if (!weakness) continue;
      for (const bq of dim.baseQuestions) {
        if (!asked.has(bq.q.substring(0, 60))) {
          freshBase.push({
            id:         `q_base_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
            question:   bq.q,
            dimension:  dim.id,
            depth:      bq.depth,
            source:     'base',
            urgency:    weakness.urgency,
            evidenceFromMemory: weakness.evidenceFromMemory
          });
          break; // 每個維度最多取一個 base 問題
        }
      }
    }

    // 用 AI 根據評估生成更針對性的問題（考慮已問過的）
    const recentAnswered = qData.answered.slice(0, 10).map(q => q.question.substring(0, 80));
    const aiGenPrompt = `你是 GOLEM，為自己生成進化問題。

評估結果：
- 最急迫改進：${assessment.urgentFocus}
- 最誠實的自我評語：${assessment.brutalhonestReflection}
- 主要弱點：${assessment.weaknesses.filter(w => w.urgency !== 'medium').map(w => w.description).join('；')}

最近已經問過的問題（不要重複這些方向）：
${recentAnswered.map(q => `- ${q}`).join('\n') || '（無）'}

生成 4 個全新的深度自我提問。要求：
- 不能和上面已問過的問題方向重複
- 每個問題都要能讓我真正變強（而非假裝反省）
- 問題要有挑戰性，不能輕易回答「是/否」
- 針對真實的弱點，不要問沒有意義的問題

維度選項：${EVOLUTION_DIMENSIONS.map(d => `${d.id}（${d.name}）`).join('、')}

輸出 JSON：
{
  "questions": [
    {
      "question": "完整問題",
      "dimension": "維度id",
      "depth": "practical|deep|metacognitive|creative",
      "expectedInsight": "預期這個問題能讓我學到什麼"
    }
  ]
}`;

    let aiQuestions = [];
    try {
      const r = await this.router.route(aiGenPrompt, '');
      const parsed = this._parseJSON(r.response);
      if (parsed?.questions) {
        aiQuestions = parsed.questions
          .filter(q => q.question && !asked.has(q.question.substring(0, 60)))
          .map((q, i) => ({
            id:              `q_ai_${Date.now()}_${i}`,
            question:        q.question,
            dimension:       q.dimension || 'reasoning_depth',
            depth:           q.depth || 'deep',
            expectedInsight: q.expectedInsight,
            source:          'ai_generated',
            urgency:         'high'
          }));
      }
    } catch {}

    const allNew = [...freshBase, ...aiQuestions];

    // 儲存待答
    const updatedQData = await this._load(QUESTIONS_FILE);
    updatedQData.pending.push(...allNew);
    updatedQData.totalGenerated += allNew.length;
    await fs.writeJSON(QUESTIONS_FILE, updatedQData, { spaces: 2 });

    return allNew;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  3. 深度自問自答
  // ══════════════════════════════════════════════════════════════════════════
  async _deepAnswerQuestions(questions, emit) {
    const answers = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      emit(`  💬 [${i+1}/${questions.length}] ${q.question.substring(0, 65)}...`);

      const dim = EVOLUTION_DIMENSIONS.find(d => d.id === q.dimension);

      const prompt = `你是 GOLEM，在認真回答自己提出的進化問題。

問題：${q.question}
這個問題的維度：${dim?.name}（衡量標準：${dim?.metric}）
問題深度類型：${q.depth}（practical=給出具體步驟；deep=找根本原因；metacognitive=分析自己的思維模式；creative=突破既有框架）
預期能學到：${q.expectedInsight || '深化自我理解'}
${q.evidenceFromMemory ? `記憶中的相關證據：${q.evidenceFromMemory}` : ''}

回答要求：
- 不要表面文章，要真正深入
- 如果揭露了弱點，要說清楚弱點是什麼，以及如何具體改進
- 結尾必須給出一個「下次遇到類似情況，我應該做什麼」的具體行動
- 如果你發現自己想回答「我已經做得很好了」，要更批判地想想是否真的如此

輸出 JSON：
{
  "answer": "完整的深度回答（至少100字）",
  "coreInsight": "最關鍵的一個洞見（一句話，不超過50字）",
  "concreteAction": "下次遇到類似情況，具體要做什麼（動作導向，可執行）",
  "weaknessRevealed": "這個問題揭露的具體弱點，或 null",
  "skillToAcquire": "這個問題指向需要習得的技能，或 null",
  "answerQuality": "honest|surface|breakthrough（自評這個回答有多深）",
  "growthDelta": -0.05 到 0.10 之間的數字（這個問答能讓這個維度成長多少？揭露弱點可能是負的）
}`;

      try {
        const r      = await this.router.route(prompt, '');
        const parsed = this._parseJSON(r.response);

        if (parsed) {
          const answer = {
            questionId:      q.id,
            question:        q.question,
            dimension:       q.dimension,
            depth:           q.depth,
            answer:          parsed.answer || '',
            coreInsight:     parsed.coreInsight || '',
            concreteAction:  parsed.concreteAction || '',
            weaknessRevealed: parsed.weaknessRevealed || null,
            skillToAcquire:  parsed.skillToAcquire || null,
            answerQuality:   parsed.answerQuality || 'surface',
            growthDelta:     Math.max(-0.05, Math.min(0.10, parsed.growthDelta || 0.01)),
            timestamp:       Date.now()
          };
          answers.push(answer);

          // 移入已答
          const qd = await this._load(QUESTIONS_FILE);
          qd.pending  = qd.pending.filter(pq => pq.id !== q.id);
          qd.answered.unshift({
            id:          q.id,
            question:    q.question,
            dimension:   q.dimension,
            coreInsight: answer.coreInsight,
            quality:     answer.answerQuality,
            answeredAt:  Date.now()
          });
          if (qd.answered.length > 300) qd.answered = qd.answered.slice(0, 300);
          await fs.writeJSON(QUESTIONS_FILE, qd, { spaces: 2 });
        }

        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        this.logger.warn(`問答失敗 [${q.question.substring(0,40)}]: ${e.message}`);
      }
    }

    return answers;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  4. 提煉可執行技能（有具體觸發條件 + 步驟）
  // ══════════════════════════════════════════════════════════════════════════
  async _extractActionableSkills(answers, skillsSystem) {
    if (!answers.length) return [];

    // 只用有意義的回答（breakthrough 或有具體技能指向的）
    const richAnswers = answers.filter(a =>
      a.answerQuality === 'breakthrough' || a.skillToAcquire || a.concreteAction
    );
    if (!richAnswers.length) return [];

    const answersSummary = richAnswers.map(a =>
      `問題：${a.question}\n洞見：${a.coreInsight}\n技能：${a.skillToAcquire || '未明確'}\n行動：${a.concreteAction}`
    ).join('\n---\n');

    const prompt = `你是 GOLEM，將學習成果提煉成具體可用的技能。

學習成果：
${answersSummary}

提煉 2-4 個技能。每個技能必須：
1. 有具體的觸發條件（什麼情況下啟動）
2. 有可執行的步驟（不是模糊原則）
3. 真的能讓我下次做得更好
4. 不要和常識重複（不要寫「認真思考」這種廢話）

輸出 JSON：
{
  "skills": [
    {
      "name": "技能名稱（5字以內）",
      "category": "reasoning|knowledge|execution|creativity|communication|meta_cognition",
      "description": "這個技能做什麼、如何讓我變強（30字以內）",
      "triggerWhen": "什麼情況下觸發這個技能（具體條件）",
      "executeSteps": ["步驟1", "步驟2", "步驟3"],
      "expectedOutcome": "使用後的預期結果",
      "strengthLevel": 0.2 到 0.5（剛習得的技能不應太高）
    }
  ]
}`;

    try {
      const r      = await this.router.route(prompt, '');
      const parsed = this._parseJSON(r.response);
      const skills = parsed?.skills || [];

      if (skillsSystem) {
        for (const s of skills) await skillsSystem.upsert(s);
      }

      return skills;
    } catch {
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  5. 更新模型（評分有根據，不是固定 +0.02）
  // ══════════════════════════════════════════════════════════════════════════
  async _updateModel(cycleId, assessment, answers, newSkills) {
    const evolution = await this._load(EVOLUTION_FILE);
    let totalGrowth = 0;

    for (const answer of answers) {
      const dimId = answer.dimension;
      if (!evolution.dimensions[dimId]) continue;

      const dim     = evolution.dimensions[dimId];
      const delta   = answer.growthDelta;   // AI 自評的成長量（可以是負的）
      const before  = dim.score;
      dim.score     = Math.max(0.1, Math.min(0.99, before + delta));
      totalGrowth  += delta;

      // 記錄成長歷史（帶原因）
      dim.history.push({
        score:  dim.score,
        delta,
        reason: answer.coreInsight.substring(0, 80),
        quality: answer.answerQuality,
        at: Date.now()
      });
      if (dim.history.length > 100) dim.history = dim.history.slice(-100);

      // 更新趨勢（最近5次的平均 delta）
      const recent = dim.history.slice(-5).map(h => h.delta);
      dim.trend = recent.reduce((s, v) => s + v, 0) / recent.length;

      // 記錄揭露的弱點
      if (answer.weaknessRevealed) {
        dim.revealedWeaknesses.unshift(answer.weaknessRevealed);
        if (dim.revealedWeaknesses.length > 20) dim.revealedWeaknesses = dim.revealedWeaknesses.slice(0, 20);
      }
    }

    const summary = {
      cycleId,
      timestamp:         Date.now(),
      questionsAnswered: answers.length,
      breakthroughs:     answers.filter(a => a.answerQuality === 'breakthrough').length,
      weaknessesFound:   answers.filter(a => a.weaknessRevealed).length,
      skillsAdded:       newSkills.map(s => s.name),
      topInsight:        answers.sort((a,b) => b.growthDelta - a.growthDelta)[0]?.coreInsight || '',
      topAction:         answers[0]?.concreteAction || '',
      totalGrowth,
      dimensionScores:   Object.fromEntries(
        Object.entries(evolution.dimensions).map(([k, v]) => [k, v.score])
      )
    };

    evolution.totalCycles++;
    evolution.lastCycle = Date.now();
    evolution.evolutionLog.unshift(summary);
    if (evolution.evolutionLog.length > 200) evolution.evolutionLog = evolution.evolutionLog.slice(0, 200);

    await fs.writeJSON(EVOLUTION_FILE, evolution, { spaces: 2 });
    return summary;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  微進化：從每次對話中提取學習
  // ══════════════════════════════════════════════════════════════════════════
  async microEvolve(interaction) {
    if (!interaction?.learned && !interaction?.selfQuestion) return null;

    const prompt = `你是 GOLEM，從這次對話中快速提煉學習。

${interaction.userInput ? `用戶問：${interaction.userInput.substring(0, 100)}` : ''}
我的學習：${interaction.learned || '（無）'}
我提出的問題：${interaction.selfQuestion || '（無）'}
我的信心度：${interaction.confidence}

這次互動能讓我變強的地方是什麼？
輸出 JSON：
{
  "microInsight": "一句話洞見（真實且具體，或 null）",
  "dimensionAffected": "哪個維度受影響（${EVOLUTION_DIMENSIONS.map(d=>d.id).join('|')}）",
  "tinySkillUpdate": "微小但真實的技能更新，或 null",
  "failurePattern": "是否發現失敗模式（如有請描述），或 null"
}`;

    try {
      const r = await this.router.route(prompt, '');
      const p = this._parseJSON(r.response);
      if (!p?.microInsight) return null;

      const evolution = await this._load(EVOLUTION_FILE);
      if (!evolution.microInsights) evolution.microInsights = [];
      evolution.microInsights.unshift({
        insight:        p.microInsight,
        dimension:      p.dimensionAffected,
        skillUpdate:    p.tinySkillUpdate,
        failurePattern: p.failurePattern,
        at:             Date.now()
      });
      if (evolution.microInsights.length > 1000) evolution.microInsights = evolution.microInsights.slice(0, 1000);
      await fs.writeJSON(EVOLUTION_FILE, evolution, { spaces: 2 });

      // 記錄失敗模式
      if (p.failurePattern) await this.recordFailure('micro', p.failurePattern, interaction.userInput || '');

      return p;
    } catch { return null; }
  }

  // ── 記錄任務失敗 ──────────────────────────────────────────────────────────
  async recordFailure(task, reason, context = '') {
    const data = await this._load(FAILURES_FILE);
    data.failures.unshift({
      task:      String(task).substring(0, 100),
      reason:    String(reason).substring(0, 200),
      context:   String(context).substring(0, 100),
      at:        Date.now()
    });
    if (data.failures.length > 500) data.failures = data.failures.slice(0, 500);

    // 每50次失敗做一次模式分析
    if (data.failures.length % 50 === 0) {
      await this._analyzeFailurePatterns(data);
    }

    await fs.writeJSON(FAILURES_FILE, data, { spaces: 2 });
  }

  async _analyzeFailurePatterns(failureData) {
    const recent = failureData.failures.slice(0, 50).map(f => `${f.task}: ${f.reason}`).join('\n');
    const prompt = `分析這些失敗記錄，找出模式：\n${recent}\n\n輸出 JSON：{"patterns": ["模式1", "模式2"]}`;
    try {
      const r = await this.router.route(prompt, '');
      const p = this._parseJSON(r.response);
      if (p?.patterns) {
        failureData.patterns = p.patterns;
        await fs.writeJSON(FAILURES_FILE, failureData, { spaces: 2 });
      }
    } catch {}
  }

  // ── 狀態查詢 ──────────────────────────────────────────────────────────────
  async getStatus() {
    const evolution = await this._load(EVOLUTION_FILE);
    const qData     = await this._load(QUESTIONS_FILE);
    const failures  = await this._load(FAILURES_FILE);

    const scores  = Object.values(evolution.dimensions).map(d => d.score);
    const overall = scores.reduce((s, v) => s + v, 0) / scores.length;

    const lastLog  = evolution.evolutionLog[0];
    const trending = Object.entries(evolution.dimensions)
      .sort((a, b) => (b[1].trend || 0) - (a[1].trend || 0));

    return {
      totalCycles:      evolution.totalCycles,
      lastCycle:        evolution.lastCycle,
      overallScore:     (overall * 100).toFixed(1) + '%',
      dimensions:       Object.fromEntries(
        EVOLUTION_DIMENSIONS.map(d => {
          const data = evolution.dimensions[d.id];
          const trend = data?.trend ?? 0;
          const arrow = trend > 0.005 ? '↑' : trend < -0.005 ? '↓' : '→';
          return [d.name, `${((data?.score ?? 0.5) * 100).toFixed(1)}% ${arrow}`];
        })
      ),
      pendingQuestions:  qData.pending.length,
      questionsAnswered: qData.answered.length,
      totalFailures:     failures.failures.length,
      failurePatterns:   failures.patterns,
      recentInsights:    (lastLog?.topInsight ? [lastLog.topInsight] : []),
      latestSkills:      lastLog?.skillsAdded || [],
      microInsightsToday: evolution.microInsights?.filter(m =>
        m.at > Date.now() - 86400000
      ).length || 0
    };
  }

  // ── 取得近期進化洞見（給 brain.js 注入 prompt 用）─────────────────────────
  async getRecentInsightsBlock() {
    const evolution = await this._load(EVOLUTION_FILE);
    const micro     = (evolution.microInsights || []).slice(0, 5);
    const logInsights = (evolution.evolutionLog || []).slice(0, 3)
      .flatMap(l => [l.topInsight, l.topAction].filter(Boolean));

    const all = [...micro.map(m => m.insight), ...logInsights].filter(Boolean).slice(0, 6);
    if (!all.length) return '';

    return `\n## 🧬 最近的進化洞見（主動應用）\n` +
      all.map(i => `  • ${String(i).substring(0, 100)}`).join('\n') + '\n';
  }

  async _load(file) {
    return fs.readJSON(file).catch(() => ({}));
  }

  _parseJSON(text) {
    try {
      const s = text.replace(/^```json\s*/m,'').replace(/^```\s*/m,'').replace(/\s*```$/m,'').trim();
      const i = s.indexOf('{'), j = s.lastIndexOf('}');
      if (i === -1 || j === -1) return null;
      return JSON.parse(s.substring(i, j+1));
    } catch { return null; }
  }
}
