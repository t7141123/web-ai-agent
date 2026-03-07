// core/diagnostics.js
// 🏥 System Diagnostics - Health checks for API, Disk, and Memory

import os from 'os';
import fs from 'fs-extra';
import { Logger } from './logger.js';

export class SystemDiagnostics {
  constructor(brain) {
    this.brain = brain;
    this.logger = new Logger('Diagnostics');
  }

  async checkHealth() {
    this.logger.info('🏥 正在執行系統健康檢查...');
    
    const results = {
      timestamp: new Date().toISOString(),
      api: await this._checkAPI(),
      storage: await this._checkStorage(),
      memory: this._getMemoryUsage(),
      system: this._getSystemInfo()
    };

    const isHealthy = results.api.status === 'ok' && results.storage.status === 'ok';
    results.overall = isHealthy ? 'HEALTHY' : 'DEGRADED';

    this.logger.info(`🔍 檢查結果: ${results.overall}`, results);
    return results;
  }

  async _checkAPI() {
    try {
      // 測試路由器連通性
      const start = Date.now();
      const route = await this.brain.router.route('health check: respond only with "OK"', { maxTokens: 5 });
      const latency = Date.now() - start;

      if (route.success && route.response.includes('OK')) {
        return { status: 'ok', latency: `${latency}ms`, provider: route.provider };
      }
      return { status: 'error', error: route.error || 'Unexpected response' };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async _checkStorage() {
    try {
      const paths = ['./memory', './logs', './projects'];
      const details = {};
      for (const p of paths) {
        await fs.ensureDir(p);
        const stats = await fs.stat(p);
        details[p] = { exists: true, writable: true };
      }
      return { status: 'ok', details };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  _getMemoryUsage() {
    const used = process.memoryUsage();
    return {
      rss: `${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`,
      heapTotal: `${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`,
      heapUsed: `${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`
    };
  }

  _getSystemInfo() {
    return {
      platform: os.platform(),
      release: os.release(),
      uptime: `${Math.round(os.uptime() / 3600 * 100) / 100} hours`,
      loadAvg: os.loadavg()
    };
  }
}
