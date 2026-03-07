import fs   from 'fs-extra';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Logger } from './logger.js';

const MEMORY_FILE   = './memory/memories.json';
const WORK_LOG_FILE = './memory/work_log.json';

export class MemorySystem {
  constructor(apiKey) {
    this.logger    = new Logger('Memory');
    this.shortTerm = []; // 記憶體中的最近項目
    this.maxShortTerm = parseInt(process.env.MEMORY_MAX_SHORT_TERM) || 20;
    this.maxLongTerm  = parseInt(process.env.MEMORY_MAX_LONG_TERM)  || 1000;

    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.embedModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    }

    this._initP = this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(MEMORY_FILE)) {
      await fs.writeJSON(MEMORY_FILE, { memories: [], version: 2 });
    }
    if (!await fs.pathExists(WORK_LOG_FILE)) {
      await fs.writeJSON(WORK_LOG_FILE, { entries: [] });
    }
    this.logger.info('💾 記憶系統就緒');
  }

  // ── 儲存新記憶（含自動生成向量）────────────────────────────────────────
  async store(item) {
    await this._initP;

    const contentForEmbedding = `${item.type}: ${item.content} ${item.context || ''}`;
    const embedding = await this._getEmbedding(contentForEmbedding);

    const memory = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      ...item,
      embedding,
      timestamp:   item.timestamp || Date.now(),
      accessCount: 0,
      importance:  item.importance || this._calculateImportance(item)
    };

    // 短期記憶
    this.shortTerm.unshift(memory);
    if (this.shortTerm.length > this.maxShortTerm) this.shortTerm.pop();

    // 長期持久化
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      data.memories.unshift(memory);

      // 修剪舊的、低重要度的記憶
      if (data.memories.length > this.maxLongTerm) {
        data.memories = data.memories
          .sort((a, b) => (b.importance + (b.accessCount * 0.1)) - (a.importance + (a.accessCount * 0.1)))
          .slice(0, this.maxLongTerm);
      }

      await fs.writeJSON(MEMORY_FILE, data, { spaces: 2 });
    } catch (e) {
      this.logger.warn(`無法寫入記憶檔案: ${e.message}`);
    }

    return memory;
  }

  // ── 檢索相關記憶（混合語意與關鍵字）──────────────────────────────────────
  async getRelevant(query, limit = 5) {
    await this._initP;
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      const queryEmbedding = await this._getEmbedding(query);
      const queryWords     = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

      const scored = data.memories.map(m => {
        let score = 0;

        // 1. 語意相似度 (70%)
        if (queryEmbedding && m.embedding) {
          const sim = this._cosineSimilarity(queryEmbedding, m.embedding);
          score += sim * 0.7;
        }

        // 2. 關鍵字匹配 (20%)
        const content = `${m.content} ${m.context || ''}`.toLowerCase();
        let keywordScore = 0;
        queryWords.forEach(word => {
          if (content.includes(word)) keywordScore += 0.1;
        });
        score += Math.min(keywordScore, 0.2);

        // 3. 時間衰減與重要度 (10%)
        const ageHours = (Date.now() - m.timestamp) / (1000 * 60 * 60);
        const recency  = Math.max(0, 1 - (ageHours / 168)); // 一週內衰減
        score += (recency * 0.05) + (m.importance * 0.05);

        // 存取次數微幅加成
        score += (m.accessCount || 0) * 0.01;

        return { ...m, score };
      });

      const relevant = scored
        .filter(m => m.score > 0.1) // 過濾無關內容
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // 更新存取次數
      relevant.forEach(mem => this._incrementAccess(mem.id));

      return relevant;
    } catch (e) {
      this.logger.warn(`檢索記憶失敗: ${e.message}`);
      return this.shortTerm.slice(0, limit);
    }
  }

  // ── 取得最近記憶 ──────────────────────────────────────────────────────
  async getRecent(count = 10) {
    await this._initP;
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      return data.memories.slice(0, count);
    } catch (e) {
      return this.shortTerm.slice(0, count);
    }
  }

  // ── 取得最近工作記錄 ────────────────────────────────────────────────────
  async getRecentWork(limit = 5) {
    await this._initP;
    try {
      const data = await fs.readJSON(WORK_LOG_FILE);
      return data.entries.slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  // ── 記錄工作行為 ──────────────────────────────────────────────────────
  async logWork(action, summary, details = {}) {
    await this._initP;
    const entry = { action, summary, details, timestamp: Date.now() };

    try {
      const data = await fs.readJSON(WORK_LOG_FILE);
      data.entries.unshift(entry);
      data.entries = data.entries.slice(0, 100);
      await fs.writeJSON(WORK_LOG_FILE, data, { spaces: 2 });
    } catch (e) {}
  }

  // ── 記憶統計 ──────────────────────────────────────────────────────────
  async getStats() {
    await this._initP;
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      const byType = {};
      data.memories.forEach(m => {
        byType[m.type] = (byType[m.type] || 0) + 1;
      });
      return {
        total: data.memories.length,
        shortTerm: this.shortTerm.length,
        byType,
        withEmbedding: data.memories.filter(m => m.embedding).length
      };
    } catch (e) {
      return { total: 0, shortTerm: 0, byType: {} };
    }
  }

  // ── 補全舊記憶的向量（背景執行）────────────────────────────────────────
  async backfillEmbeddings() {
    await this._initP;
    const data = await fs.readJSON(MEMORY_FILE);
    const targets = data.memories.filter(m => !m.embedding).slice(0, 5); // 每次做 5 條

    if (targets.length === 0) return;

    this.logger.info(`🧬 正在補全 ${targets.length} 條記憶的向量...`);
    for (const m of targets) {
      m.embedding = await this._getEmbedding(`${m.type}: ${m.content}`);
      await new Promise(r => setTimeout(r, 1000)); // 避免 API 頻率限制
    }

    await fs.writeJSON(MEMORY_FILE, data, { spaces: 2 });
  }

  // ── 私有助手方法 ──────────────────────────────────────────────────────

  async _getEmbedding(text) {
    if (!this.embedModel || !text) return null;
    try {
      const result = await this.embedModel.embedContent(text.substring(0, 2000));
      return result.embedding.values;
    } catch (err) {
      this.logger.warn(`Embedding 生成失敗: ${err.message}`);
      return null;
    }
  }

  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0, mA = 0, mB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      mA += vecA[i] * vecA[i];
      mB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
  }

  _calculateImportance(item) {
    const weights = { learning: 0.8, reflection: 0.9, error: 0.7, project: 1.0, fact: 0.5 };
    return weights[item.type] || 0.5;
  }

  async _incrementAccess(id) {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      const mem = data.memories.find(m => m.id === id);
      if (mem) {
        mem.accessCount = (mem.accessCount || 0) + 1;
        await fs.writeJSON(MEMORY_FILE, data, { spaces: 2 });
      }
    } catch (e) {}
  }

  async clear() {
    this.shortTerm = [];
    await fs.writeJSON(MEMORY_FILE, { memories: [], version: 2 });
    await fs.writeJSON(WORK_LOG_FILE, { entries: [] });
  }
}
