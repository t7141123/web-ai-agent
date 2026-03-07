// core/agent.js  (v7 — 品質回饋迴路)
import chalk   from 'chalk';
import boxen   from 'boxen';
import ora     from 'ora';
import { Brain }          from './brain.js';
import { Executor }       from './executor.js';
import { Logger }         from './logger.js';

export class GolemAgent {
  constructor(apiKey) {
    this.brain         = new Brain(apiKey);
    this.executor      = new Executor(this.brain.memory);
    this.promptEvolver = this.brain.promptEvolver;
    this.logger        = new Logger('Agent');
    this.isRunning     = false;
    this.name          = process.env.AGENT_NAME || 'Golem';
    this._lastResponse = null; // 追蹤上一次回應，用於推測滿意度
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  一般對話
  // ══════════════════════════════════════════════════════════════════════════
  async chat(userInput) {
    // 🔄 品質回饋迴路：從本次輸入推測對上次回應的滿意度
    if (this._lastResponse) {
      const inference = this.promptEvolver.inferSatisfaction(userInput, this._lastResponse);
      if (inference) {
        await this.promptEvolver.recordFeedback({
          satisfied: inference.satisfied,
          signal: inference.signal,
          confidence: inference.confidence,
          userInput: userInput.substring(0, 100),
        }).catch(() => {});
      }
    }

    const sp = ora({ text: chalk.cyan('思考中...'), color: 'cyan' }).start();
    try {
      const thought = await this.brain.think(userInput, await this._ctx());
      sp.stop();

      const result = await this.executor.execute(thought.action);
      
      // 🔗 關鍵修復：將執行結果回傳給大腦，強化或降低剛才所用技能的信心度
      await this.brain.processOutcome(thought, result);

      this._showThinking(thought);
      if (result.output) this._showResponse(thought.response, result);

      if (thought.nextActions?.length)
        thought.nextActions.forEach(a => console.log(chalk.dim(`  → ${a}`)));

      // 對話中產生的自我問題（dim 顯示，讓用戶知道 Agent 在思考）
      if (thought.selfQuestion)
        console.log(chalk.dim(`\n  🔮 自我提問：${thought.selfQuestion}`));

      // 如果偵測到失敗，提示
      if (thought.failureDetected)
        console.log(chalk.yellow(`\n  ⚠️  失敗已記錄，將在下次進化週期中分析`));

      // 記錄本次回應，供下次對話推測滿意度
      this._lastResponse = thought.response || '';

      return { thought, result };
    } catch (e) {
      sp.fail(chalk.red('錯誤'));
      throw e;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  🧬 完整進化週期（手動觸發）
  // ══════════════════════════════════════════════════════════════════════════
  async evolve(opts = {}) {
    const { cycles = 1 } = opts;

    console.log(boxen(
      chalk.bold.magenta('🧬 GOLEM 自我進化\n\n') +
      chalk.white(`週期數：${cycles}\n`) +
      chalk.dim('評估 → 自問 → 深度回答 → 提煉技能 → 更新模型'),
      { padding: 1, borderColor: 'magenta', borderStyle: 'double' }
    ));

    const before = await this.brain.getEvolutionStatus();
    this._showEvolutionDashboard(before, '進化前');

    let totalSkills = 0, totalQ = 0, allInsights = [];

    for (let c = 1; c <= cycles; c++) {
      if (cycles > 1) {
        console.log(chalk.bold.magenta(`\n${'─'.repeat(50)}`));
        console.log(chalk.bold.magenta(`  週期 ${c}/${cycles}`));
        console.log(chalk.bold.magenta(`${'─'.repeat(50)}`));
      }

      const sp = ora('準備中...').start();
      const result = await this.brain.triggerEvolution(msg => { sp.text = chalk.cyan(msg); });
      sp.stop();

      // 顯示結果
      if (result.newSkills?.length) {
        console.log(chalk.green('\n  ✨ 習得技能：'));
        result.newSkills.forEach(s =>
          console.log(`    ${chalk.green('●')} ${chalk.bold(s.name)} — ${s.description?.substring(0,55)}`)
        );
      }

      const insights = result.summary?.topInsight ? [result.summary.topInsight] : [];
      const action   = result.summary?.topAction;
      if (insights.length) {
        console.log(chalk.yellow('\n  💡 核心洞見：'));
        insights.forEach(i => console.log(chalk.yellow(`    「${i?.substring(0,80)}」`)));
      }
      if (action) console.log(chalk.cyan(`\n  🎯 具體行動：${action?.substring(0,80)}`));

      if (result.summary?.weaknessesFound > 0)
        console.log(chalk.red(`\n  ⚠️  發現 ${result.summary.weaknessesFound} 個真實弱點（已記錄，下次針對改進）`));

      totalSkills  += result.newSkills?.length || 0;
      totalQ       += result.questionsAnswered || 0;
      allInsights.push(...insights);

      if (c < cycles) { await this._sleep(2000); }
    }

    const after = await this.brain.getEvolutionStatus();
    this._showEvolutionDashboard(after, '進化後');

    console.log(boxen(
      chalk.bold.magenta(`🧬 完成！${cycles} 個週期\n\n`) +
      chalk.white(`自問自答：  ${chalk.cyan(totalQ)} 題\n`) +
      chalk.white(`習得技能：  ${chalk.green(totalSkills)} 個\n`) +
      chalk.white(`整體得分：  ${chalk.yellow(after.overallScore)}\n`),
      { padding: 1, borderColor: 'magenta' }
    ));

    return { cycles, totalSkills, totalQ, insights: allInsights };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  持續進化（loop 模式）
  // ══════════════════════════════════════════════════════════════════════════
  async startContinuousEvolution(intervalMin = 30) {
    console.log(chalk.magenta(`\n🔄 持續進化啟動（每 ${intervalMin} 分鐘）`));
    console.log(chalk.dim('  輸入 stop 停止\n'));
    this.isRunning = true;
    let n = 0;
    while (this.isRunning) {
      n++;
      const t = new Date().toLocaleTimeString();
      process.stdout.write(chalk.dim(`[${t}] 週期 #${n}...`));
      try {
        const r = await this.brain.triggerEvolution();
        const growth = r.summary?.totalGrowth || 0;
        console.log(chalk.green(` ✅ +${(growth*100).toFixed(2)}% | ${r.newSkills?.length||0} 技能 | ${r.questionsAnswered||0} 問答`));
      } catch (e) {
        console.log(chalk.red(` ❌ ${e.message}`));
      }
      if (!this.isRunning) break;
      await this._sleep(intervalMin * 60 * 1000);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  自主模式 (TaskPlanner 驅動)
  // ══════════════════════════════════════════════════════════════════════════
  async runAutonomous(goal, maxSteps = 30) {
    const { TaskPlanner } = await import('./planner.js');
    const planner = new TaskPlanner(this.brain);

    console.log(boxen(
      chalk.bold.cyan(`🤖 自主任務模式啟動\n\n`) + chalk.white(`目標: ${goal}`),
      { padding: 1, borderColor: 'cyan', borderStyle: 'double' }
    ));

    const plan = await planner.createPlan(goal);
    if (!plan || plan.length === 0) {
      console.log(chalk.red('❌ 無法生成計畫，終止任務'));
      return;
    }

    console.log(chalk.bold.yellow('\n📋 執行計畫：'));
    plan.forEach(s => console.log(chalk.dim(`  [${s.id}] ${s.title}`)));

    this.isRunning = true;
    let stepCount = 0;

    while (this.isRunning && !planner.isFinished() && stepCount < maxSteps) {
      stepCount++;
      const task = planner.getCurrentTask();
      
      console.log(chalk.bold.blue(`\n${'═'.repeat(10)} 步驟 ${planner.currentStepIndex + 1}/${planner.plan.length} : ${task.title} ${'═'.repeat(10)}`));
      console.log(chalk.dim(`任務描述: ${task.description}`));

      const sp = ora(chalk.cyan('思考中...')).start();
      try {
        // 將計畫背景傳遞給 Brain
        const thought = await this.brain.think(task.description, {
          ...(await this._ctx()),
          autonomousMode: true,
          originalGoal: goal,
          currentPlan: planner.plan,
          currentStep: task
        });
        sp.stop();
        this._showThinking(thought);

        const result = await this.executor.execute(thought.action);
        
        // 🔗 關鍵修復：自主模式下也要回饋執行結果
        await this.brain.processOutcome(thought, result);
        
        if (result.output) this._showResponse(thought.response, result);

        // 告知 Planner 完成情況，以便決定下一步（或自動調整計畫）
        await planner.nextStep({ response: thought.response, action: thought.action?.type, output: result.output });

        if (thought.failureDetected) {
          this.logger.warn(`偵測到失敗: ${thought.failureDetected}`);
        }

        await this._sleep(1000);
      } catch (e) {
        sp.fail(chalk.red(`步驟執行錯誤`));
        this.logger.error(`步驟錯誤: ${e.message}`);
        await this._sleep(2000);
      }
    }

    this.isRunning = false;
    const summary = planner.getExecutionSummary();
    console.log(boxen(
      chalk.bold.green('🏁 任務完成摘要\n\n') +
      chalk.white(`目標：${summary.goal}\n`) +
      chalk.white(`完成：${summary.completedSteps}/${summary.totalSteps} 步驟\n`) +
      chalk.white(`進度：${summary.progress}`),
      { padding: 1, borderColor: 'green' }
    ));
  }

  async buildProject(desc) {
    return this.runAutonomous(
      `建立完整軟體專案：${desc}\n步驟：分析→架構→建立→實現→測試→README`,
      30
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  顯示方法（外部可呼叫）
  // ══════════════════════════════════════════════════════════════════════════
  _showThinking(t) {
    const debug = process.env.AGENT_LOG_LEVEL === 'debug';
    if (debug) {
      console.log(chalk.dim('\n  🧠 推理：'));
      if (t.thinking?.iDontKnow) console.log(chalk.dim(`     不確定：${t.thinking.iDontKnow}`));
      if (t.thinking?.skillsApplied?.length) console.log(chalk.dim(`     技能：${t.thinking.skillsApplied.join(', ')}`));
    }
    const conf = t.confidence || 0;
    const bar  = '█'.repeat(Math.round(conf*10)) + '░'.repeat(10-Math.round(conf*10));
    const src  = t._source === 'web' ? chalk.green('[網頁·免費]') : chalk.yellow('[Flash]');
    console.log(chalk.dim(`\n  🎯 ${chalk.cyan(t.action?.type||'?')} ${src} ${bar} ${(conf*100).toFixed(0)}%`));
  }

  _showResponse(response, result) {
    if (!response) return;
    console.log(boxen(chalk.white(response), {
      padding: 1, borderColor: 'cyan',
      title: `🤖 ${this.name}`, titleAlignment: 'left'
    }));
    if (result.filepath) console.log(chalk.green(`  📁 ${result.filepath}`));
  }

  _showEvolutionDashboard(status, label) {
    const dimLines = Object.entries(status.dimensions || {}).map(([name, score]) => {
      const pct = parseFloat(score);
      const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10-Math.round(pct/10));
      return `  ${name.padEnd(12)} ${bar} ${score}`;
    }).join('\n');

    const line2 = chalk.dim(
      `問題已答：${status.questionsAnswered} | 失敗記錄：${status.totalFailures || 0}` +
      ` | 今日微洞見：${status.microInsightsToday || 0}`
    );

    console.log(boxen(
      chalk.bold(`📊 ${label}\n\n`) +
      chalk.cyan(`週期：${status.totalCycles} | 整體：${status.overallScore}\n`) +
      line2 + '\n\n' +
      chalk.white(dimLines),
      { padding: 1, borderColor: 'magenta', title: '🧬 進化儀表板' }
    ));

    if (status.failurePatterns?.length) {
      console.log(chalk.dim('\n  常見失敗模式：'));
      status.failurePatterns.forEach(p => console.log(chalk.dim(`    ⚠ ${p}`)));
    }
  }

  async _ctx() {
    const [stats, recentWork, evo] = await Promise.all([
      this.brain.memory.getStats(),
      this.brain.memory.getRecentWork(3),
      this.brain.getEvolutionStatus()
    ]);
    return {
      memoryStats: stats, recentWork,
      evolutionCycles: evo.totalCycles,
      overallScore: evo.overallScore,
      timestamp: new Date().toISOString(),
      workspace: process.env.AGENT_WORKSPACE || './projects'
    };
  }

  async _goalMet(goal, actions, thought) {
    if (actions.length < 3) return false;
    const kws     = goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const summary = actions.map(a => a.summary).join(' ').toLowerCase();
    const covered = kws.filter(k => summary.includes(k));
    return covered.length / kws.length > 0.6
      || (thought.confidence > 0.9 && !thought.nextActions?.length);
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  stop()     { this.isRunning = false; }
  async shutdown() {
    this.isRunning = false;
    await this.brain.shutdown();
  }
}
