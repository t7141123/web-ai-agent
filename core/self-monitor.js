// core/self-monitor.js  (v1 — 自我監控與報告系統)
//
// 核心功能：
//  1. 即時監控系統健康狀態
//  2. 自動生成進化報告（每日/每週）
//  3. 偵測停滯並主動提醒
//  4. 追蹤長期趨勢和模式
//
// 與 self-evolution.js 的差異：
//  - self-evolution: 專注於決策追蹤和實驗
//  - self-monitor: 專注於整體系統健康和報告

import fs from 'fs-extra';
import { Logger } from './logger.js';

const MONITOR_FILE = './memory/self_monitor.json';
const REPORT_FILE = './memory/evolution_reports.json';

export class SelfMonitor {
  constructor(brain) {
    this.brain = brain;
    this.logger = new Logger('SelfMonitor');
    this._initPromise = this._init();
    
    this.state = {
      startTime: Date.now(),
      totalInteractions: 0,
      lastReportAt: null,
      dailyStats: {},
      stagnationDetected: [],
      breakthroughs: [],
    };
  }

  async _init() {
    await fs.ensureDir('./memory');

    if (!await fs.pathExists(MONITOR_FILE)) {
      await fs.writeJSON(MONITOR_FILE, {
        version: 1,
        ...this.state,
      }, { spaces: 2 });
    } else {
      const saved = await fs.readJSON(MONITOR_FILE);
      this.state = { ...this.state, ...saved };
    }

    // 初始化報告檔案
    if (!await fs.pathExists(REPORT_FILE)) {
      await fs.writeJSON(REPORT_FILE, { reports: [] }, { spaces: 2 });
    }

    this.logger.info('👁️ 自我監控系統已啟動');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  1. 互動追蹤
  // ══════════════════════════════════════════════════════════════════════════
  async trackInteraction(userInput, thought, result) {
    await this._initPromise;

    this.state.totalInteractions++;
    const today = this._getTodayKey();

    // 初始化今日統計
    if (!this.state.dailyStats[today]) {
      this.state.dailyStats[today] = {
        date: today,
        interactions: 0,
        successes: 0,
        failures: 0,
        avgConfidence: 0,
        skillsUsed: {},
        routes: { api: 0, web: 0 },
        evolutionTriggers: 0,
      };
    }

    const stats = this.state.dailyStats[today];
    stats.interactions++;

    // 更新成功/失敗
    const isSuccess = result?.success !== false && !thought?.failureDetected;
    if (isSuccess) {
      stats.successes++;
    } else {
      stats.failures++;
    }

    // 更新平均信心度
    if (thought?.confidence) {
      const total = stats.successes + stats.failures;
      stats.avgConfidence = 
        (stats.avgConfidence * (total - 1) + thought.confidence) / total;
    }

    // 追蹤使用的技能
    if (thought?.thinking?.skillsApplied) {
      for (const skill of thought.thinking.skillsApplied) {
        stats.skillsUsed[skill] = (stats.skillsUsed[skill] || 0) + 1;
      }
    }

    // 追蹤路由選擇
    if (thought?._source) {
      if (thought._source === 'api') stats.routes.api++;
      else if (thought._source === 'web') stats.routes.web++;
    }

    // 檢查是否觸發停滯偵測
    await this._checkStagnation(stats);

    // 檢查是否有突破
    if (thought?.confidence > 0.9 && !thought?.failureDetected) {
      await this._recordBreakthrough(userInput, thought);
    }

    // 每 10 次互動檢查是否需要生成報告
    if (this.state.totalInteractions % 10 === 0) {
      setImmediate(() => this._checkAndGenerateReport());
    }

    await this._saveState();
  }

  _getTodayKey() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  2. 停滯偵測
  // ══════════════════════════════════════════════════════════════════════════
  async _checkStagnation(todayStats) {
    // 需要至少 5 次互動才開始偵測
    if (todayStats.interactions < 5) return;

    // 偵測條件：成功率低於 40% 或平均信心度低於 0.5
    const successRate = todayStats.successes / todayStats.interactions;
    const lowConfidence = todayStats.avgConfidence < 0.5;

    if (successRate < 0.4 || lowConfidence) {
      // 避免重複記錄
      const today = this._getTodayKey();
      const alreadyRecorded = this.state.stagnationDetected.some(s => s.date === today);
      
      if (!alreadyRecorded) {
        const stagnation = {
          date: today,
          interactions: todayStats.interactions,
          successRate,
          avgConfidence: todayStats.avgConfidence,
          possibleCauses: await this._analyzeStagnationCause(todayStats),
          suggestions: this._generateSuggestions(todayStats),
          detectedAt: Date.now(),
        };

        this.state.stagnationDetected.push(stagnation);
        this.logger.warn(`⚠️  偵測到停滯：成功率 ${Math.round(successRate * 100)}%, 信心度 ${(todayStats.avgConfidence * 100).toFixed(0)}%`);
        
        // 自動觸發進化週期
        if (this.brain?.evolution) {
          this.logger.info('🧬 自動觸發進化週期以改善停滯...');
          setImmediate(() => {
            this.brain.evolution.runCycle([], this.brain.skills, null)
              .catch(e => this.logger.warn(`進化失敗：${e.message}`));
          });
        }
      }
    }
  }

  async _analyzeStagnationCause(stats) {
    const causes = [];

    // 分析可能的原因
    if (stats.routes.web > stats.routes.api * 2) {
      causes.push('網頁版使用比例過高，可能表示複雜任務過多');
    }

    if (Object.keys(stats.skillsUsed).length < 3) {
      causes.push('使用的技能種類過少，可能缺乏多樣性');
    }

    // 從失敗記錄中分析
    const failures = await fs.readJSON('./memory/failures.json').catch(() => ({ failures: [] }));
    const recentFailures = failures.failures.slice(0, 10);
    if (recentFailures.length > 5) {
      causes.push(`最近失敗次數較多 (${recentFailures.length} 次)`);
    }

    // 從進化狀態分析
    const evo = await fs.readJSON('./memory/evolution.json').catch(() => null);
    if (evo?.totalCycles === 0) {
      causes.push('尚未執行任何進化週期');
    }

    return causes;
  }

  _generateSuggestions(stats) {
    const suggestions = [];

    if (stats.avgConfidence < 0.5) {
      suggestions.push('考慮執行 evolve 指令來提升能力');
    }

    if (stats.failures > stats.successes) {
      suggestions.push('查看 failures 指令了解失敗模式');
    }

    if (Object.keys(stats.skillsUsed || {}).length < 3) {
      suggestions.push('嘗試使用不同類型的任務來激活更多技能');
    }

    suggestions.push('查看 insights 指令獲取進化建議');

    return suggestions;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  3. 突破記錄
  // ══════════════════════════════════════════════════════════════════════════
  async _recordBreakthrough(userInput, thought) {
    const breakthrough = {
      id: `bt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      userInput: userInput.substring(0, 100),
      confidence: thought.confidence,
      skillsUsed: thought.thinking?.skillsApplied || [],
      actionType: thought.action?.type,
      timestamp: Date.now(),
    };

    this.state.breakthroughs.push(breakthrough);
    
    // 只保留最近 50 個突破
    if (this.state.breakthroughs.length > 50) {
      this.state.breakthroughs = this.state.breakthroughs.slice(0, 50);
    }

    await this._saveState();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  4. 報告生成
  // ══════════════════════════════════════════════════════════════════════════
  async _checkAndGenerateReport() {
    const now = Date.now();
    const lastReport = this.state.lastReportAt ? new Date(this.state.lastReportAt) : null;
    
    // 檢查是否需要生成每日報告（距離上次報告超過 24 小時）
    const shouldGenerateDaily = !lastReport || 
      (now - lastReport.getTime()) > 24 * 60 * 60 * 1000;

    if (shouldGenerateDaily) {
      await this.generateReport('daily');
    }
  }

  async generateReport(type = 'daily') {
    await this._initPromise;

    this.logger.info(`📊 生成 ${type} 報告...`);

    const today = this._getTodayKey();
    const stats = this.state.dailyStats[today] || {};

    // 取得進化狀態
    const evoStatus = await this.brain?.getEvolutionStatus?.() || {};
    
    // 取得技能摘要
    const skillsSummary = await this.brain?.getSkillsSummary?.() || {};

    // 取得自我進化狀態
    const selfEvoStatus = await this.brain?.selfEvolution?.getStatus?.() || {};

    const report = {
      id: `report_${today}_${Date.now()}`,
      type,
      date: today,
      generatedAt: Date.now(),
      summary: {
        totalInteractions: this.state.totalInteractions,
        todayInteractions: stats.interactions || 0,
        successRate: stats.interactions > 0 
          ? Math.round((stats.successes / stats.interactions) * 100) 
          : 0,
        avgConfidence: ((stats.avgConfidence || 0) * 100).toFixed(1) + '%',
      },
      details: {
        routes: stats.routes || { api: 0, web: 0 },
        topSkills: Object.entries(stats.skillsUsed || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
        evolutionCycles: evoStatus.totalCycles || 0,
        totalSkills: skillsSummary.total || 0,
        activeExperiments: selfEvoStatus.activeExperiments || 0,
      },
      stagnationDetected: this.state.stagnationDetected.slice(-3),
      recentBreakthroughs: this.state.breakthroughs.slice(-5),
      healthScore: this._calculateHealthScore(stats, evoStatus),
    };

    // 保存報告
    const reportsData = await fs.readJSON(REPORT_FILE).catch(() => ({ reports: [] }));
    reportsData.reports.unshift(report);
    reportsData.reports = reportsData.reports.slice(0, 100); // 只保留最近 100 個
    await fs.writeJSON(REPORT_FILE, reportsData, { spaces: 2 });

    this.state.lastReportAt = Date.now();
    await this._saveState();

    this.logger.info(`✅ ${type} 報告已生成：健康分數 ${report.healthScore}`);
    return report;
  }

  _calculateHealthScore(stats, evoStatus) {
    let score = 50; // 基礎分數

    // 成功率加成（最多 +20）
    if (stats.interactions > 0) {
      const successRate = stats.successes / stats.interactions;
      score += Math.round(successRate * 20);
    }

    // 信心度加成（最多 +15）
    if (stats.avgConfidence > 0.6) {
      score += Math.round((stats.avgConfidence - 0.6) * 30);
    }

    // 進化週期加成（最多 +10）
    if ((evoStatus?.totalCycles || 0) > 0) {
      score += Math.min(10, evoStatus.totalCycles);
    }

    // 停滯扣分
    const recentStagnation = this.state.stagnationDetected.filter(
      s => Date.now() - s.detectedAt < 24 * 60 * 60 * 1000
    ).length;
    score -= recentStagnation * 10;

    return Math.max(0, Math.min(100, score));
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  5. 狀態查詢
  // ══════════════════════════════════════════════════════════════════════════
  async getStatus() {
    await this._initPromise;

    const today = this._getTodayKey();
    const todayStats = this.state.dailyStats[today] || {};

    return {
      totalInteractions: this.state.totalInteractions,
      uptime: Math.round((Date.now() - this.state.startTime) / 1000 / 60), // 分鐘
      todayStats: {
        interactions: todayStats.interactions || 0,
        successes: todayStats.successes || 0,
        failures: todayStats.failures || 0,
        avgConfidence: ((todayStats.avgConfidence || 0) * 100).toFixed(1) + '%',
        routes: todayStats.routes || { api: 0, web: 0 },
      },
      stagnationCount: this.state.stagnationDetected.length,
      breakthroughCount: this.state.breakthroughs.length,
      lastReportAt: this.state.lastReportAt,
    };
  }

  async getRecentReports(limit = 5) {
    await this._initPromise;
    const reportsData = await fs.readJSON(REPORT_FILE).catch(() => ({ reports: [] }));
    return reportsData.reports.slice(0, limit);
  }

  async getBreakthroughs(limit = 10) {
    await this._initPromise;
    return this.state.breakthroughs.slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  工具方法
  // ══════════════════════════════════════════════════════════════════════════
  async _saveState() {
    await fs.writeJSON(MONITOR_FILE, {
      version: 1,
      ...this.state,
    }, { spaces: 2 });
  }

  async shutdown() {
    await this._saveState();
  }
}
