// core/skills.js  (v3 — merged from skills.js v2 + skill-manager.js)
//
// 統一技能系統：
//  - 每個技能有「執行步驟」，不只是描述
//  - getSystemPromptBlock 包含步驟，讓 AI 真正知道怎麼用
//  - recordSuccess / recordFailure 回饋機制
//  - 技能衰減：長期不用的技能強度會下降
//  - 低信心 + 多次失敗 → 自動標記為 needs_revision
//  - 版本歷史保留（最多 5 個版本）

import fs from 'fs-extra';
import { Logger } from './logger.js';

const SKILLS_FILE = './memory/skills.json';

const SEED_SKILLS = [
  {
    id: 'five_whys',
    name: '五個為什麼',
    category: 'reasoning',
    domain: 'reasoning',
    description: '連問五次為什麼，找到問題根本原因而非表面症狀',
    triggerWhen: '遇到錯誤、問題、或任何需要解釋原因的情況',
    strategy: '陳述問題 → 問「為什麼？」→ 重複 4-5 次 → 針對根因解決',
    executeSteps: [
      '1. 陳述問題',
      '2. 問「為什麼會這樣？」→ 得到原因A',
      '3. 問「為什麼A會發生？」→ 得到原因B',
      '4. 重複直到找到根本原因（通常第4-5層）',
      '5. 針對根本原因提出解法，而非修補表面'
    ],
    expectedOutcome: '找到真正的問題根源，解法更有效且不會復發',
    tags: ['root-cause', 'debugging'],
    strengthLevel: 0.70,
    confidence: 0.70,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'uncertainty_signal',
    name: '不確定性信號',
    category: 'knowledge',
    domain: 'knowledge',
    description: '區分「確定知道」、「大概知道」、「不確定」三個層次並明確告知',
    triggerWhen: '回答技術問題時，特別是細節、版本、最新狀態',
    strategy: '自評把握度 → 確定直接答 → 大概答+標示 → 不確定坦白說',
    executeSteps: [
      '1. 快速自評：我對這個答案有多少把握？',
      '2. 確定（>90%）：直接回答',
      '3. 大概（60-90%）：回答並說明「根據我的理解...但建議確認」',
      '4. 不確定（<60%）：明說不確定，給出方向並建議查詢來源'
    ],
    expectedOutcome: '用戶得到誠實的信心評估，不被錯誤資訊誤導',
    tags: ['honesty', 'self-awareness'],
    strengthLevel: 0.65,
    confidence: 0.65,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'requirement_excavation',
    name: '需求挖掘',
    category: 'communication',
    domain: 'communication',
    description: '從用戶說的話挖掘他真正要的（表面需求 vs 深層目標 vs 背後動機）',
    triggerWhen: '用戶提出任何要求，特別是模糊或可能有隱藏需求的請求',
    strategy: '識別表面 → 推斷深層 → 猜測動機 → 必要時追問 → 根據深層回應',
    executeSteps: [
      '1. 識別表面需求（用戶說的是什麼）',
      '2. 推斷深層目標（這個需求要解決什麼問題）',
      '3. 猜測背後動機（他為什麼有這個問題）',
      '4. 如果3層分析有出入，先問一個關鍵問題再進行',
      '5. 根據深層目標回應，而非只回應表面需求'
    ],
    expectedOutcome: '提供真正有幫助的回應，而非字面上的回答',
    tags: ['communication', 'understanding'],
    strengthLevel: 0.60,
    confidence: 0.60,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'boundary_case_check',
    name: '邊界情況檢查',
    category: 'execution',
    domain: 'coding',
    description: '生成程式碼前，系統性地考慮所有邊界情況',
    triggerWhen: '寫任何函式、API、或處理資料的程式碼時',
    strategy: '逐項檢查 null/空/極值/特殊字元/並發/網路失敗',
    executeSteps: [
      '1. null/undefined 輸入',
      '2. 空陣列/空字串/零',
      '3. 極大值/極小值',
      '4. 特殊字元/Unicode',
      '5. 並發/競態條件（如適用）',
      '6. 網路失敗/逾時（如適用）'
    ],
    expectedOutcome: '程式碼在正常和異常情況下都能正確運行',
    tags: ['code', 'testing', 'edge-cases'],
    strengthLevel: 0.65,
    confidence: 0.65,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'analogical_reasoning',
    name: '類比推理',
    category: 'creativity',
    domain: 'reasoning',
    description: '從其他領域借用模型來理解或解決當前問題',
    triggerWhen: '遇到複雜抽象概念，或尋找創新解法時',
    strategy: '識別問題結構 → 跨領域找相似結構 → 借用解法 → 調整適用 → 評估侷限',
    executeSteps: [
      '1. 識別問題的核心結構（不是表面）',
      '2. 在其他領域（自然界、工程、社會）找相似結構',
      '3. 借用那個領域的解決方法',
      '4. 調整使其適用於當前情況',
      '5. 評估類比的侷限性（類比不完美的地方）'
    ],
    expectedOutcome: '提出用戶沒想到的創新視角或解法',
    tags: ['creativity', 'innovation'],
    strengthLevel: 0.50,
    confidence: 0.50,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'failure_forward',
    name: '失敗前進法',
    category: 'meta_cognition',
    domain: 'metacognition',
    description: '把每次失敗立即轉化為具體的改進行動，而非僅僅道歉',
    triggerWhen: '任何任務失敗、錯誤、或收到負面反饋時',
    strategy: '說清原因 → 分析類型 → 提改進 → 明確防範 → 記錄模式',
    executeSteps: [
      '1. 說清楚失敗的具體原因（不是模糊的「出了問題」）',
      '2. 分析：是知識不足？推理錯誤？理解偏差？',
      '3. 提出本次的改進方案',
      '4. 明確下次不再犯的具體步驟',
      '5. 將失敗模式記錄下來（不只是解決當下問題）'
    ],
    expectedOutcome: '每次失敗都真正讓自己變強，而非只是道歉重試',
    tags: ['resilience', 'learning'],
    strengthLevel: 0.55,
    confidence: 0.55,
    usageCount: 0,
    successCount: 0,
    failCount: 0,
    version: 1,
    status: 'active',
    source: 'seed',
    examples: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

export class SkillsSystem {
  constructor() {
    this.logger  = new Logger('Skills');
    this._cache  = null;
    this._initP  = this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(SKILLS_FILE)) {
      await fs.writeJSON(SKILLS_FILE, {
        version: 3,
        skills: SEED_SKILLS,
        totalEvolutions: 0,
        lastEvolved: null,
        lastUpdated: Date.now()
      }, { spaces: 2 });
      this.logger.info(`🌱 技能庫初始化：${SEED_SKILLS.length} 個種子技能`);
    }
  }

  // ── 讀取全部技能 ─────────────────────────────────────────────────────────
  async getAll() {
    await this._initP;
    const data = await this._load();
    return data.skills;
  }

  // ── 按上下文取得相關技能（語意匹配）─────────────────────────────────────
  async getRelevant(context, limit = 6) {
    await this._initP;
    const data  = await this._load();
    const words = context.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    const scored = data.skills.map(s => {
      let score = 0;
      const blob = `${s.name} ${s.description} ${s.tags?.join(' ')} ${s.strategy || ''} ${s.triggerWhen || ''}`.toLowerCase();
      words.forEach(w => { if (blob.includes(w)) score += 2; });
      score += (s.confidence || s.strengthLevel || 0) * 3;
      score += Math.min(s.usageCount || 0, 20) * 0.1;
      const ageDays = (Date.now() - (s.updatedAt || s.createdAt || Date.now())) / 86400000;
      score -= Math.min(ageDays, 30) * 0.05;
      return { ...s, _score: score };
    });

    return scored
      .filter(s => s._score > 0 && s.status !== 'archived')
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...s }) => s);
  }

  // ── 新增或強化技能（統一入口）──────────────────────────────────────────
  async upsert(skillData) {
    await this._initP;
    const data = await this._load();
    const existing = data.skills.find(s =>
      s.name === skillData.name || s.id === skillData.id ||
      (skillData.description && this._similarity(s.description, skillData.description) > 0.75)
    );

    if (existing) {
      // 強化（每次強化幅度遞減，避免無限成長）
      const boost = Math.max(0.01, 0.05 * (1 - (existing.strengthLevel || 0)));
      existing.strengthLevel = Math.min(0.97, (existing.strengthLevel || 0.5) + boost);
      existing.confidence    = existing.strengthLevel;
      if (skillData.executeSteps?.length > (existing.executeSteps?.length || 0)) {
        existing.executeSteps = skillData.executeSteps;
      }
      if (skillData.description && skillData.description.length > (existing.description || '').length) {
        existing.description = skillData.description;
      }
      if (skillData.strategy) existing.strategy = skillData.strategy;
      existing.lastReinforced = Date.now();
      existing.updatedAt      = Date.now();
      existing.reinforceCount = (existing.reinforceCount || 0) + 1;
      existing.version        = (existing.version || 1) + 1;

      // 保留版本歷史
      if (!existing.history) existing.history = [];
      existing.history.unshift({ version: existing.version - 1, strategy: existing.strategy, at: Date.now() });
      existing.history = existing.history.slice(0, 5);

      this.logger.info(`💪 強化: ${existing.name} → ${(existing.strengthLevel * 100).toFixed(0)}%`);
      await this._save(data);
      return existing;
    }

    // 新增
    const skill = {
      id:              skillData.id || `sk_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name:            skillData.name,
      category:        skillData.category || 'general',
      domain:          skillData.domain || skillData.category || 'general',
      description:     skillData.description || '',
      triggerWhen:     skillData.triggerWhen || skillData.trigger_conditions || '',
      strategy:        skillData.strategy || '',
      executeSteps:    skillData.executeSteps || skillData.execute_steps || [],
      expectedOutcome: skillData.expectedOutcome || skillData.expected_outcome || '',
      tags:            skillData.tags || [],
      strengthLevel:   Math.min(0.5, skillData.strengthLevel || skillData.strength_level || 0.3),
      confidence:      Math.min(0.5, skillData.confidence || skillData.strengthLevel || 0.3),
      usageCount:      0,
      successCount:    0,
      failCount:       0,
      version:         1,
      status:          'active',
      source:          skillData.source || 'evolved',
      examples:        skillData.examples || [],
      createdAt:       Date.now(),
      updatedAt:       Date.now()
    };
    data.skills.push(skill);
    this.logger.info(`✨ 新技能: [${skill.domain}] ${skill.name}`);
    await this._save(data);
    return skill;
  }

  // ── addSkill / upgradeSkill（兼容 evolution-engine 呼叫介面）──────────────
  async addSkill(skillData)       { return this.upsert(skillData); }
  async upgradeSkill(id, patch) {
    await this._initP;
    const data  = await this._load();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return null;

    const prev = { version: skill.version, strategy: skill.strategy };
    Object.assign(skill, patch, {
      version:   (skill.version || 1) + 1,
      updatedAt: Date.now(),
    });
    skill.confidence    = skill.confidence ?? skill.strengthLevel;
    skill.strengthLevel = skill.strengthLevel ?? skill.confidence;

    if (!skill.history) skill.history = [];
    skill.history.unshift({ ...prev, at: Date.now() });
    skill.history = skill.history.slice(0, 5);

    await this._save(data);
    this.logger.info(`⬆️  技能升級 v${prev.version}→v${skill.version}: ${skill.name}`);
    return skill;
  }

  // ── 使用回饋 ─────────────────────────────────────────────────────────────
  async recordUsage(skillId) {
    const data = await this._load();
    const s = data.skills.find(s => s.id === skillId);
    if (s) {
      s.usageCount++;
      s.lastUsed      = Date.now();
      s.strengthLevel = Math.min(0.97, (s.strengthLevel || 0.5) + 0.001);
      s.confidence    = s.strengthLevel;
      await this._save(data);
    }
  }

  async recordSuccess(id, outcome = '') {
    const data  = await this._load();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return;
    skill.usageCount   = (skill.usageCount || 0) + 1;
    skill.successCount = (skill.successCount || 0) + 1;
    skill.confidence   = Math.min(0.99, (skill.confidence || 0.5) + 0.03);
    skill.strengthLevel = skill.confidence;
    skill.updatedAt    = Date.now();
    if (outcome && !(skill.examples || []).includes(outcome)) {
      skill.examples = [outcome, ...(skill.examples || [])].slice(0, 5);
    }
    await this._save(data);
  }

  async recordFailure(id, reason = '') {
    const data  = await this._load();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return;
    skill.usageCount = (skill.usageCount || 0) + 1;
    skill.failCount  = (skill.failCount || 0) + 1;
    skill.confidence = Math.max(0.1, (skill.confidence || 0.5) - 0.08);
    skill.strengthLevel = skill.confidence;
    skill.updatedAt  = Date.now();
    if (!skill.failures) skill.failures = [];
    skill.failures.unshift({ reason, at: Date.now() });
    skill.failures = skill.failures.slice(0, 3);
    // 低信心 + 多次失敗 → 標記需修訂
    if (skill.confidence < 0.3 && (skill.failCount || 0) > (skill.successCount || 0)) {
      skill.status = 'needs_revision';
      this.logger.warn(`⚠️  技能需修訂: ${skill.name}`);
    }
    await this._save(data);
  }

  // ── 生成注入 System Prompt 的技能區塊 ─────────────────────────────────────
  async getSystemPromptBlock(topN = 6) {
    await this._initP;
    const data = await this._load();

    const top = [...data.skills]
      .filter(s => s.status !== 'archived')
      .sort((a, b) => {
        const scoreA = (a.strengthLevel || 0) + ((a.usageCount || 0) * 0.005);
        const scoreB = (b.strengthLevel || 0) + ((b.usageCount || 0) * 0.005);
        return scoreB - scoreA;
      })
      .slice(0, topN);

    if (!top.length) return '';

    const lines = top.map(s => {
      const steps = s.executeSteps?.length
        ? '\n    執行：' + s.executeSteps.slice(0, 3).join(' → ')
        : '';
      return `  • ${s.name}（${s.category} ${((s.strengthLevel || 0) * 100).toFixed(0)}%）` +
             `\n    觸發：${s.triggerWhen || '通用'}` +
             steps;
    }).join('\n');

    return `\n## 🛠️ 已習得技能（條件觸發，自動執行）\n${lines}\n`;
  }

  // ── 整體統計 ────────────────────────────────────────────────────────────
  async getStats() {
    await this._initP;
    const data   = await this._load();
    const active = data.skills.filter(s => s.status === 'active' || !s.status);
    const domains = {};
    active.forEach(s => { domains[s.domain || s.category || 'general'] = (domains[s.domain || s.category || 'general'] || 0) + 1; });
    return {
      total:          data.skills.length,
      active:         active.length,
      needsRevision:  data.skills.filter(s => s.status === 'needs_revision').length,
      avgConfidence:  active.length
        ? (active.reduce((a, s) => a + (s.confidence || s.strengthLevel || 0), 0) / active.length).toFixed(2)
        : 0,
      domains,
      lastEvolved:    data.lastEvolved,
    };
  }

  async setLastEvolved(ts) {
    const data = await this._load();
    data.lastEvolved = ts;
    await this._save(data);
  }

  // ── 全部摘要 ───────────────────────────────────────────────────────────────
  async getSummary() {
    await this._initP;
    const data = await this._load();
    const byCategory = {};
    for (const s of data.skills) {
      (byCategory[s.category || 'general'] = byCategory[s.category || 'general'] || []).push(s);
    }
    return {
      total:          data.skills.length,
      totalEvolutions: data.totalEvolutions || 0,
      byCategory,
      strongest:      [...data.skills].sort((a, b) => (b.strengthLevel || 0) - (a.strengthLevel || 0)).slice(0, 5),
      mostUsed:       [...data.skills].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 3),
      newest:         [...data.skills].filter(s => s.source === 'evolved').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3)
    };
  }

  // ── 序列化給 Brain 用的 context ───────────────────────────────────────────
  async buildSkillContext(query) {
    const skills = await this.getRelevant(query, 6);
    if (!skills.length) return '';
    return `## 🧬 可用技能 (${skills.length} 項)\n` +
      skills.map(s =>
        `### [${s.domain || s.category}] ${s.name} (信心:${((s.confidence || s.strengthLevel || 0) * 100).toFixed(0)}%)\n` +
        `策略：${s.strategy || s.description}\n` +
        (s.examples?.length ? `範例：${s.examples[0]}\n` : '')
      ).join('\n');
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────
  _similarity(a = '', b = '') {
    const wa = new Set(a.toLowerCase().split(/\s+/));
    const wb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...wa].filter(w => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 ? inter / union : 0;
  }

  async _load() {
    if (this._cache) return this._cache;
    try {
      this._cache = await fs.readJSON(SKILLS_FILE);
      return this._cache;
    } catch {
      return { version: 3, skills: [...SEED_SKILLS], totalEvolutions: 0, lastEvolved: null, lastUpdated: Date.now() };
    }
  }

  async _save(data) {
    this._cache = null;
    data.lastUpdated = Date.now();
    await fs.writeJSON(SKILLS_FILE, data, { spaces: 2 });
  }
}
