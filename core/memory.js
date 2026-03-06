// core/memory.js
// 💾 Golem Memory System - Persistent Learning & Knowledge Storage

import fs from 'fs-extra';
import path from 'path';

const MEMORY_FILE = './memory/memories.json';
const WORK_LOG_FILE = './memory/work_log.json';

export class MemorySystem {
  constructor() {
    this.shortTerm = []; // In-memory recent items
    this.maxShortTerm = parseInt(process.env.MEMORY_MAX_SHORT_TERM) || 20;
    this.maxLongTerm = parseInt(process.env.MEMORY_MAX_LONG_TERM) || 500;
    this._init();
  }

  async _init() {
    await fs.ensureDir('./memory');
    if (!await fs.pathExists(MEMORY_FILE)) {
      await fs.writeJSON(MEMORY_FILE, { memories: [], version: 1 });
    }
    if (!await fs.pathExists(WORK_LOG_FILE)) {
      await fs.writeJSON(WORK_LOG_FILE, { entries: [] });
    }
  }

  // Store a new memory
  async store(item) {
    const memory = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      ...item,
      timestamp: item.timestamp || Date.now(),
      accessCount: 0,
      importance: item.importance || this._calculateImportance(item)
    };

    // Short-term
    this.shortTerm.unshift(memory);
    if (this.shortTerm.length > this.maxShortTerm) {
      this.shortTerm.pop();
    }

    // Long-term persistence
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      data.memories.unshift(memory);

      // Prune old, low-importance memories
      if (data.memories.length > this.maxLongTerm) {
        data.memories = data.memories
          .sort((a, b) => (b.importance + b.accessCount) - (a.importance + a.accessCount))
          .slice(0, this.maxLongTerm);
      }

      await fs.writeJSON(MEMORY_FILE, data, { spaces: 2 });
    } catch (e) {
      // Memory write failure is non-critical
    }

    return memory;
  }

  // Get memories relevant to a query
  async getRelevant(query, limit = 5) {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

      const scored = data.memories.map(m => {
        const content = (m.content + ' ' + (m.context || '')).toLowerCase();
        let score = 0;

        words.forEach(word => {
          if (content.includes(word)) score += 1;
        });

        // Boost recent memories
        const ageHours = (Date.now() - m.timestamp) / (1000 * 60 * 60);
        score += Math.max(0, 1 - ageHours / 168); // Decay over a week

        // Boost frequently accessed
        score += m.accessCount * 0.1;

        return { ...m, score };
      });

      const relevant = scored
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // Update access count
      for (const mem of relevant) {
        await this._incrementAccess(mem.id);
      }

      return relevant;
    } catch (e) {
      return this.shortTerm.slice(0, limit);
    }
  }

  // Get recent memories
  async getRecent(count = 10) {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      return data.memories.slice(0, count);
    } catch (e) {
      return this.shortTerm.slice(0, count);
    }
  }

  // Get recent conversation history
  async getRecentChat(count = 6) {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      return data.memories
        .filter(m => m.type === 'chat')
        .slice(0, count)
        .reverse(); // Return in chronological order
    } catch (e) {
      return this.shortTerm
        .filter(m => m.type === 'chat')
        .slice(0, count)
        .reverse();
    }
  }

  // Get recent work entries
  async getRecentWork(limit = 5) {
    try {
      const data = await fs.readJSON(WORK_LOG_FILE);
      return data.entries.slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  // Log a work action
  async logWork(action, summary, details = {}) {
    const entry = {
      action,
      summary,
      details,
      timestamp: Date.now()
    };

    try {
      const data = await fs.readJSON(WORK_LOG_FILE);
      data.entries.unshift(entry);
      data.entries = data.entries.slice(0, 100); // Keep last 100
      await fs.writeJSON(WORK_LOG_FILE, data, { spaces: 2 });
    } catch (e) {
      // non-critical
    }
  }

  // Get memory statistics
  async getStats() {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      const byType = {};
      data.memories.forEach(m => {
        byType[m.type] = (byType[m.type] || 0) + 1;
      });
      return {
        total: data.memories.length,
        shortTerm: this.shortTerm.length,
        byType
      };
    } catch (e) {
      return { total: 0, shortTerm: this.shortTerm.length, byType: {} };
    }
  }

  // Search memories by type
  async getByType(type, limit = 10) {
    try {
      const data = await fs.readJSON(MEMORY_FILE);
      return data.memories
        .filter(m => m.type === type)
        .slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  _calculateImportance(item) {
    const typeWeights = {
      'learning': 0.8,
      'reflection': 0.9,
      'error': 0.7,
      'project': 1.0,
      'code': 0.6,
      'fact': 0.5,
      'chat': 0.3 // Lower base importance for regular chat
    };
    return typeWeights[item.type] || 0.5;
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

  // Clear all memories (use with caution)
  async clear() {
    this.shortTerm = [];
    await fs.writeJSON(MEMORY_FILE, { memories: [], version: 1 });
    await fs.writeJSON(WORK_LOG_FILE, { entries: [] });
  }
}
