// core/agent.js
// 🤖 Golem Agent Orchestrator - The autonomous loop

import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import { Brain } from './brain.js';
import { Executor } from './executor.js';
import { MemorySystem } from './memory.js';
import { Logger } from './logger.js';

export class GolemAgent {
  constructor(apiKey) {
    this.memory = new MemorySystem();
    this.brain = new Brain(apiKey);
    this.executor = new Executor(this.memory);
    this.logger = new Logger('Agent');
    this.isRunning = false;
    this.maxIterations = parseInt(process.env.AUTO_MODE_MAX_ITERATIONS) || 50;
    this.name = process.env.AGENT_NAME || 'Golem';
  }

  // Single interaction - for chat mode
  async chat(userInput) {
    const spinner = ora({
      text: chalk.cyan('思考中...'),
      color: 'cyan'
    }).start();

    try {
      // Get current context
      const context = await this._getContext();

      // Think
      const thought = await this.brain.think(userInput, context);
      spinner.stop();

      // Execute the action
      const result = await this.executor.execute(thought.action);

      // Display thinking process
      this._displayThinking(thought);

      // Display result
      if (result.output) {
        this._displayResponse(thought.response, result);
      }

      // Show next actions if any
      if (thought.next_actions?.length > 0) {
        console.log(chalk.dim('\n💭 下一步考慮:'));
        thought.next_actions.forEach(a => console.log(chalk.dim(`  → ${a}`)));
      }

      return { thought, result };

    } catch (error) {
      spinner.fail(chalk.red('發生錯誤'));
      this.logger.error('Chat error:', error.message);
      throw error;
    }
  }

  // Autonomous mode - agent runs continuously with a goal
  async runAutonomous(goal, maxSteps = 20) {
    console.log(boxen(
      chalk.bold.cyan(`🤖 GOLEM 自主模式\n\n`) +
      chalk.white(`目標: ${goal}\n`) +
      chalk.dim(`最大步驟: ${maxSteps}`),
      { padding: 1, borderColor: 'cyan', borderStyle: 'double' }
    ));

    this.isRunning = true;
    let step = 0;
    let currentTask = goal;
    const completedActions = [];

    while (this.isRunning && step < maxSteps) {
      step++;
      console.log(chalk.dim(`\n${'─'.repeat(50)}`));
      console.log(chalk.yellow(`📍 步驟 ${step}/${maxSteps}`));

      const spinner = ora(chalk.cyan('分析中...')).start();

      try {
        const context = {
          ...(await this._getContext()),
          autonomousMode: true,
          originalGoal: goal,
          currentTask,
          stepNumber: step,
          completedActions: completedActions.slice(-5),
          maxSteps
        };

        const thought = await this.brain.think(currentTask, context);
        spinner.stop();

        this._displayThinking(thought);

        // Execute
        const result = await this.executor.execute(thought.action);

        if (result.output) {
          this._displayResponse(thought.response, result);
        }

        completedActions.push({
          step,
          action: thought.action.type,
          summary: thought.response?.substring(0, 100)
        });

        // Check if goal is achieved
        if (thought.response?.includes('完成') || thought.response?.includes('done') ||
            thought.action.type === 'speak' && thought.confidence > 0.9 &&
            thought.next_actions?.length === 0) {

          const isGoalMet = await this._checkGoalAchieved(goal, completedActions);
          if (isGoalMet) {
            console.log(boxen(
              chalk.bold.green('✅ 目標已達成！\n\n') + chalk.white(thought.response),
              { padding: 1, borderColor: 'green' }
            ));
            break;
          }
        }

        // Determine next task from next_actions
        if (thought.next_actions?.length > 0) {
          currentTask = `繼續執行: ${thought.next_actions[0]}。原始目標: ${goal}`;
        } else {
          currentTask = `回顧進度並繼續。原始目標: ${goal}。已完成: ${completedActions.map(a => a.action).join(', ')}`;
        }

        // Brief pause between steps
        await this._sleep(1000);

      } catch (error) {
        spinner.fail(chalk.red(`步驟 ${step} 失敗`));
        this.logger.error('Autonomous step error:', error.message);

        // Self-heal: try to recover
        currentTask = `遇到錯誤: ${error.message}。請分析問題並嘗試不同方法。原始目標: ${goal}`;
      }
    }

    this.isRunning = false;
    console.log(chalk.dim('\n🏁 自主模式結束'));
  }

  // Multi-step code project builder
  async buildProject(description) {
    console.log(boxen(
      chalk.bold.magenta('🏗️ 專案建構模式\n\n') +
      chalk.white(description),
      { padding: 1, borderColor: 'magenta' }
    ));

    const projectGoal = `
建立一個完整的軟體專案，描述如下：
${description}

請執行以下步驟：
1. 分析需求，確定技術棧
2. 設計專案架構
3. 建立專案結構（使用 create_project action）
4. 逐一實現每個功能模組
5. 為主要功能寫測試
6. 建立 README 文件
7. 驗證整個專案能正常運行

使用繁體中文提供進度更新。
`;

    return this.runAutonomous(projectGoal, 30);
  }

  _displayThinking(thought) {
    if (thought.thinking && process.env.AGENT_LOG_LEVEL === 'debug') {
      console.log(chalk.dim('\n🧠 思考過程:'));
      console.log(chalk.dim(`  目標: ${thought.thinking.goal}`));
      console.log(chalk.dim(`  決策: ${thought.thinking.decision}`));
    }

    const confidence = thought.confidence || 0;
    const confBar = '█'.repeat(Math.floor(confidence * 10)) + '░'.repeat(10 - Math.floor(confidence * 10));
    console.log(chalk.dim(`\n🎯 動作: ${chalk.cyan(thought.action?.type || 'unknown')} | 信心: ${confBar} ${(confidence * 100).toFixed(0)}%`));
  }

  _displayResponse(response, result) {
    if (!response) return;

    console.log(boxen(
      chalk.white(response),
      {
        padding: 1,
        borderColor: 'cyan',
        title: `🤖 ${this.name}`,
        titleAlignment: 'left'
      }
    ));

    if (result.filepath) {
      console.log(chalk.green(`  📁 ${result.filepath}`));
    }
  }

  async _getContext() {
    const stats = await this.memory.getStats();
    const recentWork = await this.memory.getRecentWork(3);
    return {
      memoryStats: stats,
      recentWork,
      timestamp: new Date().toISOString(),
      workspace: process.env.AGENT_WORKSPACE || './projects'
    };
  }

  async _checkGoalAchieved(goal, actions) {
    if (actions.length < 3) return false;
    const keywords = goal.toLowerCase().split(/\s+/);
    const actionSummary = actions.map(a => a.summary).join(' ').toLowerCase();
    const covered = keywords.filter(k => k.length > 3 && actionSummary.includes(k));
    return covered.length / keywords.filter(k => k.length > 3).length > 0.6;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    this.logger.info('Agent stopped');
  }

  // 關閉所有資源（含瀏覽器）
  async shutdown() {
    this.isRunning = false;
    if (this.brain.shutdown) await this.brain.shutdown();
    this.logger.info('Agent shutdown complete');
  }
}
