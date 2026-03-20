// core/self-evolution.js  (v1 — 真實自我進化核心)
//
// 核心理念：
//  真正的自我進化 = 觀察自己的行为 → 發現模式 → 主動修正 → 驗證改進
//
// 與之前版本的差異：
//  - 不只是記錄失敗，而是主動尋找「可以改進的時刻」
//  - 不只是習得技能，而是真正改變決策邏輯
//  - 不只是累積洞見，而是驗證洞見是否真的有效
//
// 三大支柱：
//  1. 行為追蹤 (Behavior Tracking) — 記錄每個決策和結果
//  2. 模式挖掘 (Pattern Mining) — 從歷史中找出成功/失敗模式
//  3. 主動實驗 (Active Experimentation) — 嘗試新策略並驗證效果

import fs from 'fs-extra';
import { Logger } from './logger.js';

const EVOLUTION_STATE_FILE = './memory/evolution_state.json';
const BEHAVIOR_LOG_FILE = './memory/behavior_log.json';
const EXPERIMENT_LOG_FILE = './memory/experiments.json';

// ── 決策類型 ────────────────────────────────────────────────────────────────
export const DECISION_TYPES = {
  ROUTE_CHOICE: 'route_choice',        // 選擇 API 還是 Web
  SKILL_APPLICATION: 'skill_application', // 選擇使用哪個技能
  ACTION_SELECTION: 'action_selection',   // 選擇執行哪個動作
  CONFIDENCE_CALIBRATION: 'confidence_calibration', // 信心度評估
  FAILURE_RECOVERY: 'failure_recovery',   // 失敗後如何恢復
};

// ── 改進實驗類型 ───────────────────────────────────────────────────────────
export const EXPERIMENT_TYPES = {
  NEW_STRATEGY: 'new_strategy',      // 嘗試新的策略
  SKILL_ADJUSTMENT: 'skill_adjustment', // 調整現有技能
  THRESHOLD_CHANGE: 'threshold_change',  // 調整閾值（如複雜度閾值）
  PROMPT_VARIATION: 'prompt_variation', // 嘗試不同的 prompt 變體
};

export class SelfEvolutionCore {
  constructor(brain) {
    this.brain = brain;
    this.logger = new Logger('SelfEvolution');
    this._initPromise = this._init();
    
    // 當前狀態
    this.state = {
      totalDecisions: 0,
      totalExperiments: 0,
      successfulPatterns: [],
      failedPatterns: [],
      activeExperiments: [],
      lastEvolutionReview: null,
    };
  }

  async _init() {
    await fs.ensureDir('./memory');

    // 載入或初始化狀態
    if (!await fs.pathExists(EVOLUTION_STATE_FILE)) {
      await fs.writeJSON(EVOLUTION_STATE_FILE, {
        version: 1,
        createdAt: Date.now(),
        ...this.state,
      }, { spaces: 2 });
    } else {
      const saved = await fs.readJSON(EVOLUTION_STATE_FILE);
      this.state = { ...this.state, ...saved };
    }

    // 初始化行為日誌（只保留最近 500 條）
    if (!await fs.pathExists(BEHAVIOR_LOG_FILE)) {
      await fs.writeJSON(BEHAVIOR_LOG_FILE, { entries: [] }, { spaces: 2 });
    }

    // 初始化實驗記錄
    if (!await fs.pathExists(EXPERIMENT_LOG_FILE)) {
      await fs.writeJSON(EXPERIMENT_LOG_FILE, { experiments: [], completed: [] }, { spaces: 2 });
    }

    this.logger.info('🧬 自我進化核心已啟動');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  1. 行為追蹤 — 記錄每個重要決策
  // ══════════════════════════════════════════════════════════════════════════
  async trackDecision(decisionType, context, outcome) {
    await this._initPromise;

    const entry = {
      id: `dec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      type: decisionType,
      context,
      outcome,
      metadata: this._extractMetadata(decisionType, context, outcome),
    };

    // 寫入行為日誌
    await this._appendToBehaviorLog(entry);

    // 更新統計
    this.state.totalDecisions++;

    // 檢查是否發現新模式
    await this._checkForPatterns(entry);

    // 每 50 個決策觸發一次深度分析
    if (this.state.totalDecisions % 50 === 0) {
      setImmediate(() => this._runPatternMining());
    }
  }

  _extractMetadata(decisionType, context, outcome) {
    const metadata = {
      success: outcome?.success !== false,
      confidence: context?.confidence || outcome?.confidence || null,
      timeSpent: outcome?.elapsed || null,
    };

    // 根據決策類型提取特定資訊
    switch (decisionType) {
      case DECISION_TYPES.ROUTE_CHOICE:
        metadata.route = context?.route;
        metadata.complexity = context?.complexityScore;
        metadata.reason = context?.reason;
        break;
      case DECISION_TYPES.SKILL_APPLICATION:
        metadata.skillsUsed = context?.skillsApplied || [];
        metadata.taskType = context?.taskType;
        break;
      case DECISION_TYPES.ACTION_SELECTION:
        metadata.actionType = context?.actionType;
        metadata.alternatives = context?.alternatives?.length || 0;
        break;
    }

    return metadata;
  }

  async _appendToBehaviorLog(entry) {
    try {
      const data = await fs.readJSON(BEHAVIOR_LOG_FILE);
      data.entries.unshift(entry);
      
      // 只保留最近 500 條
      data.entries = data.entries.slice(0, 500);
      
      await fs.writeJSON(BEHAVIOR_LOG_FILE, data, { spaces: 2 });
    } catch (e) {
      this.logger.warn(`寫入行為日誌失敗：${e.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  2. 模式挖掘 — 從歷史中找出成功/失敗模式
  // ══════════════════════════════════════════════════════════════════════════
  async _checkForPatterns(newEntry) {
    // 單一條目還不足以發現模式
    const data = await fs.readJSON(BEHAVIOR_LOG_FILE).catch(() => ({ entries: [] }));
    if (data.entries.length < 20) return;

    // 檢查最近條目是否有重複模式
    const recentEntries = data.entries.slice(0, 50);
    
    // 找出重複的失敗模式
    const failureClusters = this._clusterFailures(recentEntries);
    for (const cluster of failureClusters) {
      if (cluster.count >= 3) {
        await this._recordFailedPattern(cluster);
      }
    }

    // 找出成功的模式
    const successClusters = this._clusterSuccesses(recentEntries);
    for (const cluster of successClusters) {
      if (cluster.count >= 3) {
        await this._recordSuccessfulPattern(cluster);
      }
    }
  }

  _clusterFailures(entries) {
    const clusters = {};
    
    for (const entry of entries) {
      if (!entry.metadata.success) {
        // 根據決策類型和失敗原因分群
        const key = `${entry.type}_${JSON.stringify(entry.context).substring(0, 50)}`;
        if (!clusters[key]) {
          clusters[key] = {
            type: entry.type,
            context: entry.context,
            count: 0,
            examples: [],
          };
        }
        clusters[key].count++;
        clusters[key].examples.push(entry);
      }
    }

    return Object.values(clusters).filter(c => c.count >= 2);
  }

  _clusterSuccesses(entries) {
    const clusters = {};
    
    for (const entry of entries) {
      if (entry.metadata.success && entry.metadata.confidence > 0.8) {
        const key = `${entry.type}_${entry.metadata.actionType || 'general'}`;
        if (!clusters[key]) {
          clusters[key] = {
            type: entry.type,
            context: entry.context,
            count: 0,
            examples: [],
          };
        }
        clusters[key].count++;
        clusters[key].examples.push(entry);
      }
    }

    return Object.values(clusters).filter(c => c.count >= 2);
  }

  async _recordFailedPattern(cluster) {
    const patternKey = `fail_${cluster.type}_${Date.now()}`;
    
    // 避免重複記錄
    const existing = this.state.failedPatterns.find(p => 
      p.type === cluster.type && 
      JSON.stringify(p.context).substring(0, 30) === JSON.stringify(cluster.context).substring(0, 30)
    );
    
    if (existing) return;

    const pattern = {
      id: patternKey,
      type: cluster.type,
      context: cluster.context,
      occurrenceCount: cluster.count,
      examples: cluster.examples.slice(0, 3).map(e => ({
        outcome: e.outcome,
        timestamp: e.timestamp,
      })),
      detectedAt: Date.now(),
      analysis: null, // 待深度分析
      improvementPlan: null,
    };

    this.state.failedPatterns.push(pattern);
    await this._saveState();

    // 觸發深度分析
    await this._analyzeFailedPattern(pattern);
  }

  async _recordSuccessfulPattern(cluster) {
    const patternKey = `success_${cluster.type}_${Date.now()}`;
    
    const existing = this.state.successfulPatterns.find(p => 
      p.type === cluster.type && 
      JSON.stringify(p.context).substring(0, 30) === JSON.stringify(cluster.context).substring(0, 30)
    );
    
    if (existing) return;

    const pattern = {
      id: patternKey,
      type: cluster.type,
      context: cluster.context,
      occurrenceCount: cluster.count,
      avgConfidence: cluster.examples.reduce((s, e) => s + (e.metadata.confidence || 0), 0) / cluster.count,
      detectedAt: Date.now(),
      strategy: null, // 待分析
    };

    this.state.successfulPatterns.push(pattern);
    await this._saveState();

    // 提煉成功策略
    await this._extractSuccessStrategy(pattern);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  3. 主動實驗 — 嘗試新策略並驗證效果
  // ══════════════════════════════════════════════════════════════════════════
  async startExperiment(experimentType, hypothesis, changes) {
    await this._initPromise;

    const experiment = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type: experimentType,
      hypothesis,
      changes,
      status: 'active',
      startedAt: Date.now(),
      trials: [],
      results: {
        successCount: 0,
        failureCount: 0,
        avgConfidence: 0,
      },
      conclusion: null,
    };

    this.state.activeExperiments.push(experiment);
    this.state.totalExperiments++;
    
    await this._saveState();
    await this._logExperiment(experiment);

    this.logger.info(`🧪 啟動實驗：${hypothesis.substring(0, 50)}...`);
    return experiment.id;
  }

  async recordExperimentTrial(experimentId, outcome) {
    const experiment = this.state.activeExperiments.find(e => e.id === experimentId);
    if (!experiment || experiment.status !== 'active') return;

    const trial = {
      timestamp: Date.now(),
      outcome,
      success: outcome?.success !== false,
      confidence: outcome?.confidence || 0,
    };

    experiment.trials.push(trial);
    
    // 更新統計
    if (trial.success) {
      experiment.results.successCount++;
    } else {
      experiment.results.failureCount++;
    }
    
    const total = experiment.results.successCount + experiment.results.failureCount;
    experiment.results.avgConfidence = 
      (experiment.results.avgConfidence * (total - 1) + trial.confidence) / total;

    // 檢查是否達到結論條件（至少 5 次試驗）
    if (experiment.trials.length >= 5) {
      await this._concludeExperiment(experiment);
    }

    await this._saveState();
    await this._updateExperimentLog(experiment);
  }

  async _concludeExperiment(experiment) {
    const successRate = experiment.results.successCount / experiment.trials.length;
    
    let conclusion;
    if (successRate > 0.7) {
      conclusion = {
        verdict: 'success',
        confidence: successRate,
        recommendation: '採用此策略',
        evidence: `${experiment.results.successCount}/${experiment.trials.length} 成功`,
      };
      
      // 將成功策略應用到相關系統
      await this._applySuccessfulStrategy(experiment, conclusion);
      
    } else if (successRate < 0.3) {
      conclusion = {
        verdict: 'failure',
        confidence: 1 - successRate,
        recommendation: '放棄此策略',
        evidence: `${experiment.results.failureCount}/${experiment.trials.length} 失敗`,
      };
      
    } else {
      conclusion = {
        verdict: 'inconclusive',
        confidence: 0.5,
        recommendation: '需要更多數據或調整實驗設計',
        evidence: `成功率 ${Math.round(successRate * 100)}%`,
      };
    }

    experiment.conclusion = conclusion;
    experiment.status = 'completed';
    experiment.completedAt = Date.now();

    // 從活躍列表移除，加入完成列表
    this.state.activeExperiments = this.state.activeExperiments.filter(e => e.id !== experiment.id);
    
    const completedData = await fs.readJSON(EXPERIMENT_LOG_FILE).catch(() => ({ experiments: [], completed: [] }));
    completedData.completed.unshift(experiment);
    completedData.completed = completedData.completed.slice(0, 100); // 只保留最近 100 個
    await fs.writeJSON(EXPERIMENT_LOG_FILE, completedData, { spaces: 2 });

    this.logger.info(`📊 實驗結論：${conclusion.verdict} — ${conclusion.recommendation}`);
  }

  async _applySuccessfulStrategy(experiment, conclusion) {
    // 根據實驗類型應用策略
    switch (experiment.type) {
      case EXPERIMENT_TYPES.NEW_STRATEGY:
        // 將新策略注入技能系統
        if (this.brain?.skills && experiment.changes?.newStrategy) {
          await this.brain.skills.upsert({
            name: `實驗策略_${experiment.id.substring(0, 8)}`,
            category: 'experimental',
            description: experiment.hypothesis,
            strategy: experiment.changes.newStrategy,
            strengthLevel: 0.5,
            source: 'experiment',
          });
        }
        break;
      
      case EXPERIMENT_TYPES.THRESHOLD_CHANGE:
        // 調整環境變數或配置
        if (experiment.changes.thresholdName && experiment.changes.newValue !== undefined) {
          process.env[experiment.changes.thresholdName] = experiment.changes.newValue.toString();
          this.logger.info(`⚙️ 已調整閾值：${experiment.changes.thresholdName} = ${experiment.changes.newValue}`);
        }
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  深度分析工具
  // ══════════════════════════════════════════════════════════════════════════
  async _analyzeFailedPattern(pattern) {
    if (!this.brain?.router) return;

    const prompt = `分析這個重複出現的失敗模式：

失敗類型：${pattern.type}
發生情境：${JSON.stringify(pattern.context, null, 2)}
發生次數：${pattern.occurrenceCount}

範例：
${pattern.examples.map(e => `- ${JSON.stringify(e.outcome?.error || e.outcome)} `).join('\n')}

請分析：
1. 根本原因是什麼？
2. 有什麼具體的改進策略？
3. 如何設計一個實驗來驗證這個改進策略？

輸出 JSON：
{
  "rootCause": "根本原因",
  "improvementStrategy": "具體改進策略",
  "experimentDesign": {
    "hypothesis": "假設",
    "changes": {"要改變的變數": "新值"}
  }
}`;

    try {
      const result = await this.brain.router.route(prompt, '');
      const analysis = this._parseJSON(result.response);
      
      if (analysis) {
        pattern.analysis = analysis.rootCause;
        pattern.improvementPlan = analysis.improvementStrategy;
        
        // 自動啟動改進實驗
        if (analysis.experimentDesign) {
          await this.startExperiment(
            EXPERIMENT_TYPES.NEW_STRATEGY,
            analysis.experimentDesign.hypothesis,
            analysis.experimentDesign.changes
          );
        }
        
        await this._saveState();
      }
    } catch (e) {
      this.logger.warn(`分析失敗模式失敗：${e.message}`);
    }
  }

  async _extractSuccessStrategy(pattern) {
    if (!this.brain?.router) return;

    const prompt = `分析這個成功模式：

成功類型：${pattern.type}
成功情境：${JSON.stringify(pattern.context, null, 2)}
平均信心度：${(pattern.avgConfidence * 100).toFixed(0)}%

請提煉出可重複使用的策略：
1. 為什麼這個方法有效？
2. 如何將這個策略應用到其他類似情境？
3. 有什麼條件或限制？

輸出 JSON：
{
  "whyItWorks": "為什麼有效",
  "generalizableStrategy": "可推廣的策略",
  "conditions": ["適用條件 1", "條件 2"],
  "limitations": ["限制 1", "限制 2"]
}`;

    try {
      const result = await this.brain.router.route(prompt, '');
      const strategy = this._parseJSON(result.response);
      
      if (strategy) {
        pattern.strategy = strategy;
        await this._saveState();
      }
    } catch (e) {
      this.logger.warn(`提煉成功策略失敗：${e.message}`);
    }
  }

  async _runPatternMining() {
    this.logger.info('🔍 執行深度模式挖掘...');
    
    const data = await fs.readJSON(BEHAVIOR_LOG_FILE).catch(() => ({ entries: [] }));
    if (data.entries.length < 50) return;

    // 分析最近 100 個決策
    const recent = data.entries.slice(0, 100);
    
    // 計算各類型的成功率
    const stats = {};
    for (const entry of recent) {
      if (!stats[entry.type]) {
        stats[entry.type] = { total: 0, success: 0, avgConfidence: 0 };
      }
      stats[entry.type].total++;
      if (entry.metadata.success) stats[entry.type].success++;
      stats[entry.type].avgConfidence += entry.metadata.confidence || 0;
    }

    // 找出需要改進的領域
    for (const [type, stat] of Object.entries(stats)) {
      const successRate = stat.success / stat.total;
      stat.avgConfidence /= stat.total;
      
      if (successRate < 0.5 && stat.total >= 5) {
        this.logger.warn(`⚠️  ${type} 成功率偏低：${Math.round(successRate * 100)}%`);
      }
    }

    this.logger.debug(`📊 模式挖掘完成：${Object.keys(stats).length} 個決策類型`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  狀態查詢與管理
  // ══════════════════════════════════════════════════════════════════════════
  async getStatus() {
    await this._initPromise;
    
    return {
      totalDecisions: this.state.totalDecisions,
      totalExperiments: this.state.totalExperiments,
      activeExperiments: this.state.activeExperiments.length,
      successfulPatterns: this.state.successfulPatterns.length,
      failedPatterns: this.state.failedPatterns.length,
      lastEvolutionReview: this.state.lastEvolutionReview,
      recentExperiments: this.state.activeExperiments.slice(0, 5).map(e => ({
        id: e.id,
        type: e.type,
        hypothesis: e.hypothesis.substring(0, 50),
        trials: e.trials.length,
        successRate: e.trials.length > 0 
          ? Math.round((e.results.successCount / e.trials.length) * 100) 
          : 0,
      })),
    };
  }

  async getInsights() {
    await this._initPromise;
    
    const insights = [];
    
    // 從成功模式提煉洞察
    for (const pattern of this.state.successfulPatterns.slice(0, 3)) {
      if (pattern.strategy) {
        insights.push({
          type: 'success',
          insight: pattern.strategy.generalizableStrategy || pattern.strategy.whyItWorks,
          confidence: pattern.avgConfidence,
        });
      }
    }
    
    // 從失敗模式提煉洞察
    for (const pattern of this.state.failedPatterns.slice(0, 3)) {
      if (pattern.analysis) {
        insights.push({
          type: 'learning',
          insight: pattern.analysis,
          improvement: pattern.improvementPlan,
        });
      }
    }
    
    return insights;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  工具方法
  // ══════════════════════════════════════════════════════════════════════════
  _parseJSON(text) {
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) return null;
      return JSON.parse(cleaned.substring(start, end + 1));
    } catch {
      return null;
    }
  }

  async _saveState() {
    await fs.writeJSON(EVOLUTION_STATE_FILE, {
      version: 1,
      createdAt: this.state.createdAt,
      ...this.state,
    }, { spaces: 2 });
  }

  async _logExperiment(experiment) {
    try {
      const data = await fs.readJSON(EXPERIMENT_LOG_FILE);
      data.experiments.unshift(experiment);
      data.experiments = data.experiments.slice(0, 50);
      await fs.writeJSON(EXPERIMENT_LOG_FILE, data, { spaces: 2 });
    } catch (e) {}
  }

  async _updateExperimentLog(experiment) {
    try {
      const data = await fs.readJSON(EXPERIMENT_LOG_FILE);
      const idx = data.experiments.findIndex(e => e.id === experiment.id);
      if (idx >= 0) {
        data.experiments[idx] = experiment;
        await fs.writeJSON(EXPERIMENT_LOG_FILE, data, { spaces: 2 });
      }
    } catch (e) {}
  }

  async shutdown() {
    await this._saveState();
  }
}
