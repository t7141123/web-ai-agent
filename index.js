// index.js  (v6 — 真實自我進化版)
import 'dotenv/config';
import readline from 'readline';
import chalk    from 'chalk';
import boxen    from 'boxen';
import ora      from 'ora';
import { GolemAgent } from './core/agent.js';

const VERSION = '6.0.0';
const API_KEY = process.env.GEMINI_API_KEY;

function showBanner() {
  console.clear();
  console.log(boxen(
    chalk.bold.cyan(`
  ██████╗  ██████╗ ██╗     ███████╗███╗   ███╗
 ██╔════╝ ██╔═══██╗██║     ██╔════╝████╗ ████║
 ██║  ███╗██║   ██║██║     █████╗  ██╔████╔██║
 ██║   ██║██║   ██║██║     ██╔══╝  ██║╚██╔╝██║
 ╚██████╔╝╚██████╔╝███████╗███████╗██║ ╚═╝ ██║
  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚═╝`) +
    chalk.white(`\n\n  自我進化 AI 智能體 v${VERSION}`) +
    chalk.magenta(`\n  🧬 真實進化引擎`) +
    chalk.green(` × 💰 零成本`) +
    chalk.dim(`  Flash API × Gemini 網頁版`),
    { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'cyan', textAlignment: 'center' }
  ));
}

function showHelp() {
  const sections = [
    {
      title: '🧬 進化指令',
      color: 'magenta',
      cmds: [
        ['evolve',       '執行一個完整進化週期（評估→自問→學習→提煉技能）'],
        ['evolve N',     '執行 N 個週期（例：evolve 3）'],
        ['evolve loop',  '持續自動進化模式（每30分鐘一個週期）'],
        ['evolution',    '查看進化儀表板（維度得分 + 趨勢 + 失敗模式）'],
        ['skills',       '查看技能庫（強度 + 觸發條件 + 執行步驟）'],
        ['questions',    '查看待答和已答的自我提問'],
        ['failures',     '查看失敗記錄和分析出的模式'],
        ['insights',     '查看自我進化洞察（成功/失敗模式）'],
        ['experiments',  '查看活躍實驗和結果'],
        ['monitor',      '查看系統監控狀態和健康分數'],
        ['report',       '生成並查看進化報告'],
      ]
    },
    {
      title: '🤖 Agent 指令',
      color: 'cyan',
      cmds: [
        ['auto <目標>',  '自主模式：Agent 自動規劃並完成目標'],
        ['build <描述>', '一鍵建立完整軟體專案'],
        ['memory',       '查看記憶庫統計'],
        ['stats',        '路由統計（API vs 免費網頁版）'],
      ]
    },
    {
      title: '🌐 瀏覽器',
      color: 'blue',
      cmds: [
        ['tabs',         '查看分頁狀態'],
        ['newtab',       '換新分頁'],
        ['headed',       '切換為有視窗模式'],
        ['headless',     '切換為背景模式'],
        ['rediscover',   '重新偵測 Gemini UI selector'],
      ]
    }
  ];

  sections.forEach(sec => {
    console.log(chalk[sec.color].bold(`\n${sec.title}`));
    sec.cmds.forEach(([cmd, desc]) =>
      console.log(`  ${chalk.cyan(cmd.padEnd(16))} ${chalk.white(desc)}`)
    );
  });
  console.log(chalk.dim('\n  其他輸入：直接對話（自動智能路由）\n'));
}

function validateSetup() {
  // 🧬 允許沒有 API Key，此時只使用 Gemini Web（訪客模式）
  if (!API_KEY || API_KEY === 'your_gemini_api_key_here') {
    console.log(boxen(
      chalk.yellow.bold('⚠️  未設置 Gemini API Key\n\n') +
      chalk.dim('將僅使用 Gemini Web（訪客模式）\n') +
      chalk.dim('某些功能可能受限，但基本對話可用'),
      { padding: 1, borderColor: 'yellow' }
    ));
    // 不退出，繼續執行
  }
}

async function main() {
  showBanner();
  validateSetup();

  const agent = new GolemAgent(API_KEY);

  // 🏥 執行系統健康檢查
  const spHealth = ora(chalk.cyan('系統診斷中...')).start();
  const { SystemDiagnostics } = await import('./core/diagnostics.js');
  const diagnostics = new SystemDiagnostics(agent.brain);
  const health = await diagnostics.checkHealth();
  spHealth.stop();

  if (health.overall === 'HEALTHY') {
    console.log(chalk.green('✅ 系統狀態良好 (API 延遲: ' + health.api.latency + ')'));
  } else {
    console.log(chalk.yellow('⚠️ 系統狀態異常: ' + (health.api.error || '硬體/網路限制')));
  }

  // 啟動資訊
  const [evo, skills] = await Promise.all([
    agent.brain.getEvolutionStatus(),
    agent.brain.getSkillsSummary()
  ]);

  console.log(chalk.green('  ✅ 訪客模式（無需登入）'));
  console.log(chalk.dim(`  🧬 進化週期 ${evo.totalCycles} 次 | 整體 ${evo.overallScore} | 技能 ${skills.total} 個`));
  console.log(chalk.dim(`  💬 微進化：每 ${process.env.MICRO_EVOLVE_EVERY||3} 次對話 | 完整週期：每 ${process.env.FULL_EVOLVE_EVERY||25} 次`));
  if (evo.totalCycles === 0)
    console.log(chalk.yellow('\n  💡 提示：輸入 evolve 開始第一次自我進化！'));

  showHelp();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question(chalk.bold.green('\n你 → '), async (raw) => {
    const text = raw.trim();
    if (!text) return ask();

    // ── 退出 ───────────────────────────────────────────────────────────────
    if (['exit','quit','離開'].includes(text)) {
      const sp = ora('關閉中...').start();
      await agent.shutdown(); sp.succeed('已關閉');
      console.log(chalk.cyan('👋 再見！'));
      rl.close(); return;
    }
    if (text === 'stop')  { agent.stop(); console.log(chalk.yellow('⏹  已停止')); return ask(); }
    if (text === 'help' || text === '?') { showHelp(); return ask(); }

    // ── 🧬 進化指令 ────────────────────────────────────────────────────────
    if (text === 'evolve loop') {
      agent.startContinuousEvolution(parseInt(process.env.EVOLVE_INTERVAL_MIN)||30)
        .catch(e => console.log(chalk.red(`❌ ${e.message}`)));
      return ask();
    }

    const evolveMatch = text.match(/^evolve(?:\s+(\d+))?$/);
    if (evolveMatch) {
      const n = parseInt(evolveMatch[1]) || 1;
      try { await agent.evolve({ cycles: n }); }
      catch (e) { console.log(chalk.red(`❌ 進化失敗：${e.message}`)); }
      return ask();
    }

    if (text === 'evolution' || text === '進化狀態') {
      const sp = ora('讀取...').start();
      const status = await agent.brain.getEvolutionStatus(); sp.stop();
      agent._showEvolutionDashboard(status, '當前狀態');
      const _fsExtra = await import('fs-extra');
      const _evoRaw  = await _fsExtra.default.readJSON('./memory/evolution.json').catch(()=>null);
      const log = _evoRaw?.evolutionLog?.[0];
      if (log?.topInsight) console.log(chalk.yellow(`\n  上次洞見：「${log.topInsight.substring(0,80)}」`));
      if (log?.topAction)  console.log(chalk.cyan(`  上次行動：${log.topAction.substring(0,80)}`));
      return ask();
    }

    if (text === 'skills' || text === '技能') {
      const sp = ora('讀取...').start();
      const s = await agent.brain.getSkillsSummary(); sp.stop();
      console.log(boxen(
        chalk.bold(`🛠️  技能庫（${s.total} 個）\n\n`) +
        chalk.bold.green('💪 最強：\n') +
        s.strongest.map(sk =>
          `  ${chalk.green('●')} ${sk.name.padEnd(16)} ${(sk.strengthLevel*100).toFixed(0).padStart(3)}%  ` +
          chalk.dim(`${sk.triggerWhen?.substring(0,40)||''}`)
        ).join('\n') +
        (s.newest?.length ? '\n\n' + chalk.bold.yellow('✨ 最新習得：\n') +
          s.newest.map(sk =>
            `  ${chalk.yellow('★')} ${sk.name} — ${sk.description?.substring(0,50)||''}`
          ).join('\n') : '') +
        (s.mostUsed?.[0]?.usageCount > 0 ? '\n\n' + chalk.bold.cyan('🔥 最常用：\n') +
          s.mostUsed.map(sk =>
            `  ${chalk.cyan('◆')} ${sk.name} ${chalk.dim(`(${sk.usageCount}次)`)}`
          ).join('\n') : ''),
        { padding: 1, borderColor: 'green' }
      ));
      const byCat = s.byCategory || {};
      if (Object.keys(byCat).length) {
        console.log(chalk.dim('  分類：' + Object.entries(byCat).map(([c,ss]) => `${c}(${ss.length})`).join(' · ')));
      }
      return ask();
    }

    if (text === 'questions' || text === '問題') {
      const qData = await import('fs-extra').then(m => m.default.readJSON('./memory/self_questions.json').catch(()=>({pending:[],answered:[],totalGenerated:0})));
      console.log(chalk.bold(`\n📋 自我提問庫（共生成 ${qData.totalGenerated||0} 個）`));
      if (qData.pending.length) {
        console.log(chalk.yellow(`\n  待答 (${qData.pending.length})：`));
        qData.pending.slice(0,5).forEach((q,i) =>
          console.log(chalk.dim(`  ${i+1}. [${q.dimension}] ${q.question.substring(0,70)}`))
        );
      }
      if (qData.answered.length) {
        console.log(chalk.green(`\n  已答 (${qData.answered.length})，最近 3 個：`));
        qData.answered.slice(0,3).forEach((q,i) =>
          console.log(chalk.dim(`  ${i+1}. ${q.question.substring(0,60)}\n     → ${q.coreInsight?.substring(0,60)||''}  [${q.quality}]`))
        );
      }
      return ask();
    }

    if (text === 'failures' || text === '失敗記錄') {
      const data = await import('fs-extra').then(m => m.default.readJSON('./memory/failures.json').catch(()=>({failures:[],patterns:[]})));
      console.log(chalk.bold(`\n⚠️  失敗記錄（${data.failures.length} 條）`));
      if (data.patterns?.length) {
        console.log(chalk.red('\n  分析出的失敗模式：'));
        data.patterns.forEach(p => console.log(chalk.red(`  ⚡ ${p}`)));
      }
      if (data.failures.length) {
        console.log(chalk.dim('\n  最近 5 次失敗：'));
        data.failures.slice(0,5).forEach((f,i) =>
          console.log(chalk.dim(`  ${i+1}. ${f.task} → ${f.reason.substring(0,60)}`))
        );
      }
      return ask();
    }

    // 🧬 新增：自我進化洞察
    if (text === 'insights' || text === '進化洞察') {
      const sp = ora('讀取進化洞察...').start();
      const [evoStatus, insights] = await Promise.all([
        agent.brain.selfEvolution.getStatus(),
        agent.brain.selfEvolution.getInsights()
      ]);
      sp.stop();

      console.log(boxen(
        chalk.bold('🧬 自我進化洞察\n\n') +
        chalk.white(`總決策數：${chalk.cyan(evoStatus.totalDecisions)}\n`) +
        chalk.white(`實驗總數：${chalk.cyan(evoStatus.totalExperiments)}\n`) +
        chalk.white(`活躍實驗：${chalk.yellow(evoStatus.activeExperiments)}\n`) +
        chalk.white(`成功模式：${chalk.green(evoStatus.successfulPatterns)}\n`) +
        chalk.white(`失敗模式：${chalk.red(evoStatus.failedPatterns)}\n\n`) +
        (insights.length ? chalk.bold('洞察：\n') + insights.map(i => 
          `  ${i.type === 'success' ? '✅' : '💡'} ${i.insight?.substring(0, 80) || ''}` +
          (i.improvement ? `\n     → ${i.improvement.substring(0, 60)}` : '')
        ).join('\n') : chalk.dim('  暫無洞察，繼續互動以累積數據')),
        { padding: 1, borderColor: 'magenta' }
      ));
      return ask();
    }

    // 🧪 新增：實驗狀態
    if (text === 'experiments' || text === '實驗') {
      const sp = ora('讀取實驗狀態...').start();
      const status = await agent.brain.selfEvolution.getStatus();
      sp.stop();

      console.log(chalk.bold(`\n🧪 實驗狀態（${status.activeExperiments} 個活躍）\n`));
      
      if (status.recentExperiments?.length) {
        status.recentExperiments.forEach((exp, i) => {
          const bar = '█'.repeat(Math.round(exp.successRate / 20)) + '░'.repeat(5 - Math.round(exp.successRate / 20));
          console.log(chalk.cyan(`  ${i+1}. [${exp.type}] ${exp.hypothesis.substring(0, 40)}...`));
          console.log(chalk.dim(`     試驗 ${exp.trials} 次 | 成功率 ${bar} ${exp.successRate}%`));
        });
      } else {
        console.log(chalk.dim('  暫無活躍實驗'));
      }
      
      if (status.activeExperiments > 0) {
        console.log(chalk.yellow('\n  💡 實驗會自動根據失敗模式生成，並在累積足夠數據後得出結論'));
      }
      return ask();
    }

    // 👁️ 新增：系統監控狀態
    if (text === 'monitor' || text === '監控') {
      const sp = ora('讀取監控狀態...').start();
      const [monitorStatus, evoStatus] = await Promise.all([
        agent.brain.selfMonitor.getStatus(),
        agent.brain.selfEvolution.getStatus()
      ]);
      sp.stop();

      const healthScore = agent.brain.selfMonitor._calculateHealthScore(
        monitorStatus.todayStats,
        { totalCycles: evoStatus.totalDecisions > 0 ? 1 : 0 }
      );

      const healthColor = healthScore >= 70 ? 'green' : healthScore >= 40 ? 'yellow' : 'red';
      const healthBar = '█'.repeat(Math.round(healthScore / 10)) + '░'.repeat(10 - Math.round(healthScore / 10));

      console.log(boxen(
        chalk.bold('👁️  系統監控狀態\n\n') +
        chalk.white(`運行時間：${chalk.cyan(monitorStatus.uptime)} 分鐘\n`) +
        chalk.white(`總互動數：${chalk.cyan(monitorStatus.totalInteractions)}\n`) +
        chalk.white(`今日互動：${chalk.cyan(monitorStatus.todayStats.interactions)}\n`) +
        chalk.white(`成功率：${chalk.cyan(monitorStatus.todayStats.successes)}/${chalk.cyan(monitorStatus.todayStats.interactions)}\n`) +
        chalk.white(`平均信心：${chalk.cyan(monitorStatus.todayStats.avgConfidence)}\n`) +
        chalk.white(`路由分佈：API ${chalk.yellow(monitorStatus.todayStats.routes.api || 0)} | Web ${chalk.yellow(monitorStatus.todayStats.routes.web || 0)}\n\n`) +
        chalk.bold[healthColor](`健康分數：${healthBar} ${healthScore}/100\n`) +
        (monitorStatus.stagnationCount > 0
          ? chalk.red(`\n⚠️  偵測到 ${monitorStatus.stagnationCount} 次停滯`)
          : chalk.green('\n✅ 系統運行良好')) +
        (monitorStatus.breakthroughCount > 0
          ? chalk.green(`\n✨ 記錄了 ${monitorStatus.breakthroughCount} 次突破`)
          : ''),
        { padding: 1, borderColor: healthColor }
      ));
      return ask();
    }

    // 📊 新增：生成報告
    if (text === 'report' || text === '報告') {
      const sp = ora('生成報告中...').start();
      try {
        const report = await agent.brain.selfMonitor.generateReport('daily');
        sp.stop();

        console.log(boxen(
          chalk.bold(`📊 進化報告 (${report.date})\n\n`) +
          chalk.white(`健康分數：${chalk[report.healthScore >= 70 ? 'green' : 'yellow'](report.healthScore + '/100')}\n`) +
          chalk.white(`今日互動：${chalk.cyan(report.summary.todayInteractions)}\n`) +
          chalk.white(`成功率：${chalk.cyan(report.summary.successRate + '%')}\n`) +
          chalk.white(`平均信心：${chalk.cyan(report.summary.avgConfidence)}\n`) +
          chalk.white(`進化週期：${chalk.cyan(report.details.evolutionCycles)}\n`) +
          chalk.white(`技能總數：${chalk.cyan(report.details.totalSkills)}\n`) +
          chalk.white(`活躍實驗：${chalk.cyan(report.details.activeExperiments)}\n`) +
          (report.recentBreakthroughs?.length
            ? chalk.green('\n✨ 最近突破：\n') + report.recentBreakthroughs.map(b =>
                `  • ${b.userInput.substring(0, 50)}... (信心：${(b.confidence * 100).toFixed(0)}%)`
              ).join('\n')
            : '') +
          (report.stagnationDetected?.length
            ? chalk.red('\n⚠️  停滯記錄：\n') + report.stagnationDetected.map(s =>
                `  • ${s.date}: ${s.possibleCauses?.join('；') || '原因不明'}`
              ).join('\n')
            : ''),
          { padding: 1, borderColor: report.healthScore >= 70 ? 'green' : 'yellow' }
        ));
      } catch (e) {
        sp.fail('報告生成失敗');
        console.log(chalk.red(`錯誤：${e.message}`));
      }
      return ask();
    }

    // ── 一般指令 ───────────────────────────────────────────────────────────
    if (text === 'stats') {
      const s = agent.brain.getRouterStats();
      console.log(boxen(
        chalk.bold('📊 路由統計\n\n') +
        `Flash API：   ${chalk.white(s.apiCalls)} 次\n網頁版(免費)：${chalk.white(s.webCalls)} 次\n網頁版比例：  ${chalk.white(s.webPercentage)}`,
        { padding: 1, borderColor: 'cyan' }
      ));
      return ask();
    }

    if (text === 'memory') {
      const [stats, recent] = await Promise.all([
        agent.brain.memory.getStats(),
        agent.brain.memory.getRecent(5)
      ]);
      console.log(chalk.cyan('\n💾'), JSON.stringify(stats, null, 2));
      recent.forEach(m => console.log(chalk.dim(`  [${m.type}] ${String(m.content||'').substring(0,80)}`)));
      return ask();
    }

    if (['headless','headed'].includes(text)) {
      process.env.BROWSER_MODE = text;
      console.log(chalk.green(`✅ 下次瀏覽器將使用 ${text} 模式`));
      return ask();
    }

    if (text === 'tabs') {
      const wc = agent.brain.router.webClient;
      if (!wc) { console.log(chalk.yellow('  瀏覽器尚未啟動')); return ask(); }
      const h = await wc.healthCheck();
      console.log(boxen(
        chalk.bold('🗂️  瀏覽器\n\n') +
        chalk.cyan(`分頁：#${h.activeTab||'-'}\n`) +
        (h.blocked ? chalk.red(`阻擋：${h.blocked}`) : chalk.green('狀態：正常')),
        { padding: 1, borderColor: h.healthy ? 'cyan' : 'red' }
      ));
      return ask();
    }

    if (text === 'newtab') {
      const wc = agent.brain.router.webClient;
      if (!wc) { console.log(chalk.yellow('  瀏覽器尚未啟動')); return ask(); }
      const sp = ora('換新分頁...').start();
      await wc._rotateTab();
      sp.succeed('✅ 已切換');
      return ask();
    }

    if (text === 'rediscover') {
      const wc = agent.brain.router.webClient;
      if (!wc) { console.log(chalk.yellow('  瀏覽器尚未啟動')); return ask(); }
      const sp = ora('重新偵測...').start();
      const r = await wc.rediscover();
      r.success ? sp.succeed('完成') : sp.fail(r.error);
      return ask();
    }

    if (text.startsWith('auto '))  { await agent.runAutonomous(text.slice(5));  return ask(); }
    if (text.startsWith('build ')) { await agent.buildProject(text.slice(6));   return ask(); }
    if (text === 'clear')          { agent.brain.clearHistory?.(); console.log(chalk.green('✅ 已清除')); return ask(); }

    // ── 一般對話 ───────────────────────────────────────────────────────────
    try {
      const r = await agent.chat(text);
      if (r?.thought?._source) {
        const src = r.thought._source === 'web' ? chalk.green('[網頁·免費]') : chalk.yellow('[Flash]');
        console.log(chalk.dim(`  ${src} ${r.thought._elapsed}ms | 對話 #${agent.brain.iteration}`));
      }
    } catch (e) {
      console.log(chalk.red(`\n❌ ${e.message}`));
      if (e.message.includes('阻擋')||e.message.includes('blocked'))
        console.log(chalk.yellow('💡 輸入 newtab 換個新分頁'));
    }

    ask();
  });

  rl.on('SIGINT', async () => {
    console.log(chalk.cyan('\n\n正在關閉...'));
    await agent.shutdown();
    process.exit(0);
  });

  ask(); // 啟動對話循環
}

main().catch(e => { console.error(chalk.red('Fatal:'), e.message); process.exit(1); });
