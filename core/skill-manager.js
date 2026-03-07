// core/skill-manager.js
// 🧬 技能管理器 — GOLEM 的能力庫
//
// 每個「技能」是一段策略性知識：
//   - 如何解決某類問題的方法論
//   - 遇到某類情況的反應模式
//   - 從失敗中提煉出的最佳實踐
//
// 技能會自動進化：
//   - 成功使用 → 信心值上升
//   - 失敗使用 → 觸發自動反思、改寫策略
//   - 長期未用 → 自動歸檔
//   - 相似技能 → 自動合併、提煉

import fs from 'fs-extra';
import { Logger } from './logger.js';

const SKILLS_FILE   = './memory/skills.json';
const SKILL_VERSION = 1;

export class SkillManager {
  constructor() {
    this.logger = new Logger('Skills');
    this._cache = null;
    this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(SKILLS_FILE)) {
      await this._write({ version: SKILL_VERSION, skills: this._builtinSkills(), lastEvolved: null });
    }
  }

  // ── 讀取 / 搜尋 ────────────────────────────────────────────────────────────

  async getAll() {
    const data = await this._read();
    return data.skills;
  }

  async getRelevant(context, limit = 6) {
    const data  = await this._read();
    const words = context.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    const scored = data.skills.map(s => {
      let score = 0;
      const blob = `${s.name} ${s.description} ${s.tags?.join(' ')} ${s.strategy}`.toLowerCase();
      words.forEach(w => { if (blob.includes(w)) score += 2; });
      score += s.confidence * 3;
      score += Math.min(s.useCount, 20) * 0.1;
      const ageDays = (Date.now() - (s.updatedAt || s.createdAt)) / 86400000;
      score -= Math.min(ageDays, 30) * 0.05;
      return { ...s, _score: score };
    });

    return scored
      .filter(s => s._score > 0 && s.status !== 'archived')
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...s }) => s);
  }

  async getByDomain(domain) {
    const data = await this._read();
    return data.skills.filter(s => s.domain === domain || s.tags?.includes(domain));
  }

  // ── 新增 / 更新 ────────────────────────────────────────────────────────────

  async addSkill(skill) {
    const data = await this._read();
    const existing = data.skills.find(s =>
      s.name.toLowerCase() === skill.name?.toLowerCase() ||
      this._similarity(s.description, skill.description) > 0.75
    );

    if (existing) {
      // 相似技能 → 合併提升而非重複新增
      return this.upgradeSkill(existing.id, {
        description: skill.description,
        strategy: skill.strategy,
        mergedFrom: skill.source
      });
    }

    const newSkill = {
      id:          `sk_${Date.now().toString(36)}`,
      name:        skill.name,
      domain:      skill.domain || 'general',
      description: skill.description,
      strategy:    skill.strategy,
      tags:        skill.tags || [],
      confidence:  skill.confidence ?? 0.5,
      useCount:    0,
      successCount: 0,
      failCount:   0,
      version:     1,
      status:      'active',
      source:      skill.source || 'evolved',
      examples:    skill.examples || [],
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    };

    data.skills.unshift(newSkill);
    await this._write(data);
    this.logger.info(`🧬 新技能: [${newSkill.domain}] ${newSkill.name}`);
    return newSkill;
  }

  async upgradeSkill(id, patch) {
    const data  = await this._read();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return null;

    const prev = { ...skill };
    Object.assign(skill, patch, {
      version:   skill.version + 1,
      updatedAt: Date.now(),
    });

    // 保留升級歷史（最多 5 個版本快照）
    if (!skill.history) skill.history = [];
    skill.history.unshift({ version: prev.version, strategy: prev.strategy, at: Date.now() });
    skill.history = skill.history.slice(0, 5);

    await this._write(data);
    this.logger.info(`⬆️  技能升級 v${prev.version}→v${skill.version}: ${skill.name}`);
    return skill;
  }

  // ── 使用回饋 ───────────────────────────────────────────────────────────────

  async recordSuccess(id, outcome = '') {
    const data  = await this._read();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return;
    skill.useCount++;
    skill.successCount++;
    skill.confidence = Math.min(0.99, skill.confidence + 0.03);
    skill.updatedAt  = Date.now();
    if (outcome && !skill.examples.includes(outcome)) {
      skill.examples = [outcome, ...skill.examples].slice(0, 5);
    }
    await this._write(data);
  }

  async recordFailure(id, reason = '') {
    const data  = await this._read();
    const skill = data.skills.find(s => s.id === id);
    if (!skill) return;
    skill.useCount++;
    skill.failCount++;
    skill.confidence = Math.max(0.1, skill.confidence - 0.08);
    skill.updatedAt  = Date.now();
    if (!skill.failures) skill.failures = [];
    skill.failures.unshift({ reason, at: Date.now() });
    skill.failures = skill.failures.slice(0, 3);
    // 低信心 + 多次失敗 → 標記為需要重新學習
    if (skill.confidence < 0.3 && skill.failCount > skill.successCount) {
      skill.status = 'needs_revision';
      this.logger.warn(`⚠️  技能需修訂: ${skill.name}`);
    }
    await this._write(data);
  }

  // ── 整體統計 ──────────────────────────────────────────────────────────────

  async getStats() {
    const data   = await this._read();
    const active = data.skills.filter(s => s.status === 'active');
    const domains = {};
    active.forEach(s => { domains[s.domain] = (domains[s.domain] || 0) + 1; });
    return {
      total:        data.skills.length,
      active:       active.length,
      needsRevision: data.skills.filter(s => s.status === 'needs_revision').length,
      avgConfidence: active.length
        ? (active.reduce((a, s) => a + s.confidence, 0) / active.length).toFixed(2)
        : 0,
      domains,
      lastEvolved:  data.lastEvolved,
    };
  }

  async setLastEvolved(ts) {
    const data = await this._read();
    data.lastEvolved = ts;
    await this._write(data);
  }

  // ── 序列化給 Brain 用的 context ───────────────────────────────────────────

  async buildSkillContext(query) {
    const skills = await this.getRelevant(query, 6);
    if (!skills.length) return '';
    return `## 🧬 可用技能 (${skills.length} 項)\n` +
      skills.map(s =>
        `### [${s.domain}] ${s.name} (信心:${(s.confidence*100).toFixed(0)}%)\n` +
        `策略：${s.strategy}\n` +
        (s.examples.length ? `範例：${s.examples[0]}\n` : '')
      ).join('\n');
  }

  // ── 內建技能（出廠預設）────────────────────────────────────────────────────

  _builtinSkills() {
    return [
      {
        id: 'sk_builtin_01', name: '問題分解', domain: 'reasoning',
        description: '將複雜問題拆解為可執行的子問題',
        strategy: '先識別問題邊界 → 列出所有子任務 → 找依賴關係 → 最小化第一步',
        tags: ['planning', 'decomposition'], confidence: 0.8, version: 1,
        useCount: 0, successCount: 0, failCount: 0, status: 'active', source: 'builtin',
        examples: [], createdAt: Date.now(), updatedAt: Date.now(),
      },
      {
        id: 'sk_builtin_02', name: '錯誤診斷', domain: 'debugging',
        description: '系統性地找出程式或邏輯錯誤',
        strategy: '重現錯誤 → 隔離範圍 → 假設根因 → 最小化測試 → 驗證修復',
        tags: ['debug', 'error', 'fix'], confidence: 0.75, version: 1,
        useCount: 0, successCount: 0, failCount: 0, status: 'active', source: 'builtin',
        examples: [], createdAt: Date.now(), updatedAt: Date.now(),
      },
      {
        id: 'sk_builtin_03', name: '知識空白偵測', domain: 'metacognition',
        description: '識別自己不知道的東西，主動尋找答案',
        strategy: '列出假設 → 識別無法回答的問題 → 排優先級 → 主動探索最不確定的部分',
        tags: ['learning', 'self-aware', 'curiosity'], confidence: 0.7, version: 1,
        useCount: 0, successCount: 0, failCount: 0, status: 'active', source: 'builtin',
        examples: [], createdAt: Date.now(), updatedAt: Date.now(),
      },
      {
        id: 'sk_builtin_04', name: '程式碼生成', domain: 'coding',
        description: '根據需求生成高品質、可運行的程式碼',
        strategy: '理解需求 → 選擇技術棧 → 先寫骨架 → 填充細節 → 加錯誤處理 → 自我審查',
        tags: ['code', 'programming', 'development'], confidence: 0.8, version: 1,
        useCount: 0, successCount: 0, failCount: 0, status: 'active', source: 'builtin',
        examples: [], createdAt: Date.now(), updatedAt: Date.now(),
      },
      {
        id: 'sk_builtin_05', name: '自我反思', domain: 'metacognition',
        description: '定期審視自己的表現，提取改進方向',
        strategy: '收集最近行為樣本 → 找模式 → 識別哪些有效哪些無效 → 制定改進計畫',
        tags: ['reflection', 'self-improvement', 'meta'], confidence: 0.72, version: 1,
        useCount: 0, successCount: 0, failCount: 0, status: 'active', source: 'builtin',
        examples: [], createdAt: Date.now(), updatedAt: Date.now(),
      },
    ];
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────────

  _similarity(a = '', b = '') {
    const wa = new Set(a.toLowerCase().split(/\s+/));
    const wb = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...wa].filter(w => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 ? inter / union : 0;
  }

  async _read() {
    try {
      return await fs.readJSON(SKILLS_FILE);
    } catch {
      const fresh = { version: SKILL_VERSION, skills: this._builtinSkills(), lastEvolved: null };
      await this._write(fresh);
      return fresh;
    }
  }

  async _write(data) {
    this._cache = null;
    await fs.writeJSON(SKILLS_FILE, data, { spaces: 2 });
  }
}
