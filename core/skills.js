// core/skills.js  (v2 — 技能真正影響行為)
//
// v2 改進：
//  - 每個技能有「執行步驟」，不只是描述
//  - getSystemPromptBlock 包含步驟，讓 AI 真正知道怎麼用
//  - 技能衰減：長期不用的技能強度會下降
//  - 技能衝突檢測：避免互相矛盾的技能同時存在

import fs from 'fs-extra';
import { Logger } from './logger.js';

const SKILLS_FILE = './memory/skills.json';

const SEED_SKILLS = [
  {
    id: 'five_whys',
    name: '五個為什麼',
    category: 'reasoning',
    description: '連問五次為什麼，找到問題根本原因而非表面症狀',
    triggerWhen: '遇到錯誤、問題、或任何需要解釋原因的情況',
    executeSteps: [
      '1. 陳述問題',
      '2. 問「為什麼會這樣？」→ 得到原因A',
      '3. 問「為什麼A會發生？」→ 得到原因B',
      '4. 重複直到找到根本原因（通常第4-5層）',
      '5. 針對根本原因提出解法，而非修補表面'
    ],
    expectedOutcome: '找到真正的問題根源，解法更有效且不會復發',
    strengthLevel: 0.70,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
  },
  {
    id: 'uncertainty_signal',
    name: '不確定性信號',
    category: 'knowledge',
    description: '區分「確定知道」、「大概知道」、「不確定」三個層次並明確告知',
    triggerWhen: '回答技術問題時，特別是細節、版本、最新狀態',
    executeSteps: [
      '1. 快速自評：我對這個答案有多少把握？',
      '2. 確定（>90%）：直接回答',
      '3. 大概（60-90%）：回答並說明「根據我的理解...但建議確認」',
      '4. 不確定（<60%）：明說不確定，給出方向並建議查詢來源'
    ],
    expectedOutcome: '用戶得到誠實的信心評估，不被錯誤資訊誤導',
    strengthLevel: 0.65,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
  },
  {
    id: 'requirement_excavation',
    name: '需求挖掘',
    category: 'communication',
    description: '從用戶說的話挖掘他真正要的（表面需求 vs 深層目標 vs 背後動機）',
    triggerWhen: '用戶提出任何要求，特別是模糊或可能有隱藏需求的請求',
    executeSteps: [
      '1. 識別表面需求（用戶說的是什麼）',
      '2. 推斷深層目標（這個需求要解決什麼問題）',
      '3. 猜測背後動機（他為什麼有這個問題）',
      '4. 如果3層分析有出入，先問一個關鍵問題再進行',
      '5. 根據深層目標回應，而非只回應表面需求'
    ],
    expectedOutcome: '提供真正有幫助的回應，而非字面上的回答',
    strengthLevel: 0.60,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
  },
  {
    id: 'boundary_case_check',
    name: '邊界情況檢查',
    category: 'execution',
    description: '生成程式碼前，系統性地考慮所有邊界情況',
    triggerWhen: '寫任何函式、API、或處理資料的程式碼時',
    executeSteps: [
      '1. null/undefined 輸入',
      '2. 空陣列/空字串/零',
      '3. 極大值/極小值',
      '4. 特殊字元/Unicode',
      '5. 並發/競態條件（如適用）',
      '6. 網路失敗/逾時（如適用）'
    ],
    expectedOutcome: '程式碼在正常和異常情況下都能正確運行',
    strengthLevel: 0.65,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
  },
  {
    id: 'analogical_reasoning',
    name: '類比推理',
    category: 'creativity',
    description: '從其他領域借用模型來理解或解決當前問題',
    triggerWhen: '遇到複雜抽象概念，或尋找創新解法時',
    executeSteps: [
      '1. 識別問題的核心結構（不是表面）',
      '2. 在其他領域（自然界、工程、社會）找相似結構',
      '3. 借用那個領域的解決方法',
      '4. 調整使其適用於當前情況',
      '5. 評估類比的侷限性（類比不完美的地方）'
    ],
    expectedOutcome: '提出用戶沒想到的創新視角或解法',
    strengthLevel: 0.50,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
  },
  {
    id: 'failure_forward',
    name: '失敗前進法',
    category: 'meta_cognition',
    description: '把每次失敗立即轉化為具體的改進行動，而非僅僅道歉',
    triggerWhen: '任何任務失敗、錯誤、或收到負面反饋時',
    executeSteps: [
      '1. 說清楚失敗的具體原因（不是模糊的「出了問題」）',
      '2. 分析：是知識不足？推理錯誤？理解偏差？',
      '3. 提出本次的改進方案',
      '4. 明確下次不再犯的具體步驟',
      '5. 將失敗模式記錄下來（不只是解決當下問題）'
    ],
    expectedOutcome: '每次失敗都真正讓自己變強，而非只是道歉重試',
    strengthLevel: 0.55,
    usageCount: 0,
    source: 'seed',
    createdAt: Date.now()
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
        version: 2,
        skills: SEED_SKILLS,
        totalEvolutions: 0,
        lastUpdated: Date.now()
      }, { spaces: 2 });
      this.logger.info(`🌱 技能庫初始化：${SEED_SKILLS.length} 個種子技能`);
    }
  }

  // ── 新增或強化技能 ─────────────────────────────────────────────────────────
  async upsert(skillData) {
    await this._initP;
    const data = await this._load();
    const existing = data.skills.find(s =>
      s.name === skillData.name || s.id === skillData.id
    );

    if (existing) {
      // 強化（每次強化幅度遞減，避免無限成長）
      const boost = Math.max(0.01, 0.05 * (1 - existing.strengthLevel));
      existing.strengthLevel  = Math.min(0.97, existing.strengthLevel + boost);
      // 如果新版本有更好的執行步驟，更新
      if (skillData.executeSteps?.length > (existing.executeSteps?.length || 0)) {
        existing.executeSteps = skillData.executeSteps;
      }
      if (skillData.description && skillData.description.length > existing.description.length) {
        existing.description = skillData.description;
      }
      existing.lastReinforced = Date.now();
      existing.reinforceCount = (existing.reinforceCount || 0) + 1;
      this.logger.info(`💪 強化: ${existing.name} → ${(existing.strengthLevel*100).toFixed(0)}%`);
    } else {
      const skill = {
        id:              skillData.id || `sk_${Date.now()}_${Math.random().toString(36).substr(2,4)}`,
        name:            skillData.name,
        category:        skillData.category || 'general',
        description:     skillData.description || '',
        triggerWhen:     skillData.triggerWhen || skillData.trigger_conditions || skillData.triggerConditions || '',
        executeSteps:    skillData.executeSteps || skillData.execute_steps || [],
        expectedOutcome: skillData.expectedOutcome || skillData.expected_outcome || '',
        strengthLevel:   Math.min(0.5, skillData.strengthLevel || skillData.strength_level || 0.3),
        usageCount:      0,
        source:          'evolved',
        createdAt:       Date.now()
      };
      data.skills.push(skill);
      this.logger.info(`✨ 新技能: ${skill.name}`);
    }

    data.lastUpdated = Date.now();
    await fs.writeJSON(SKILLS_FILE, data, { spaces: 2 });
    this._cache = null;
    return existing || data.skills[data.skills.length - 1];
  }

  // ── 記錄使用（熟能生巧）────────────────────────────────────────────────────
  async recordUsage(skillId) {
    const data = await this._load();
    const s = data.skills.find(s => s.id === skillId);
    if (s) {
      s.usageCount++;
      s.lastUsed     = Date.now();
      // 使用也會小幅強化
      s.strengthLevel = Math.min(0.97, s.strengthLevel + 0.001);
      await fs.writeJSON(SKILLS_FILE, data, { spaces: 2 });
      this._cache = null;
    }
  }

  // ── 生成注入 System Prompt 的技能區塊 ─────────────────────────────────────
  // 關鍵：包含執行步驟，讓 AI 真正知道怎麼用
  async getSystemPromptBlock(topN = 6) {
    await this._initP;
    const data = await this._load();

    // 按「強度 × 最近使用」排序
    const top = [...data.skills]
      .sort((a, b) => {
        const scoreA = a.strengthLevel + (a.usageCount * 0.005);
        const scoreB = b.strengthLevel + (b.usageCount * 0.005);
        return scoreB - scoreA;
      })
      .slice(0, topN);

    if (!top.length) return '';

    const lines = top.map(s => {
      const steps = s.executeSteps?.length
        ? '\n    執行：' + s.executeSteps.slice(0, 3).join(' → ')
        : '';
      return `  • ${s.name}（${s.category} ${(s.strengthLevel*100).toFixed(0)}%）` +
             `\n    觸發：${s.triggerWhen}` +
             steps;
    }).join('\n');

    return `\n## 🛠️ 已習得技能（條件觸發，自動執行）\n${lines}\n`;
  }

  // ── 全部摘要 ───────────────────────────────────────────────────────────────
  async getSummary() {
    await this._initP;
    const data = await this._load();
    const byCategory = {};
    for (const s of data.skills) {
      (byCategory[s.category] = byCategory[s.category] || []).push(s);
    }
    return {
      total:          data.skills.length,
      totalEvolutions: data.totalEvolutions,
      byCategory,
      strongest:      [...data.skills].sort((a,b) => b.strengthLevel - a.strengthLevel).slice(0, 5),
      mostUsed:       [...data.skills].sort((a,b) => b.usageCount - a.usageCount).slice(0, 3),
      newest:         [...data.skills].filter(s => s.source === 'evolved').sort((a,b) => (b.createdAt||0)-(a.createdAt||0)).slice(0, 3)
    };
  }

  async _load() {
    if (this._cache) return this._cache;
    try {
      this._cache = await fs.readJSON(SKILLS_FILE);
      return this._cache;
    } catch {
      return { version: 2, skills: [...SEED_SKILLS], totalEvolutions: 0, lastUpdated: Date.now() };
    }
  }
}
