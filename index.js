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
  if (!API_KEY || API_KEY === 'your_gemini_api_key_here') {
    console.log(boxen(
      chalk.red.bold('❌ 缺少 Gemini API Key\n\n') +
      chalk.yellow('1. 前往 https://aistudio.google.com/app/apikey\n') +
      chalk.yellow('2. 取得免費 API Key\n') +
      chalk.yellow('3. 填入 .env 的 GEMINI_API_KEY'),
      { padding: 1, borderColor: 'red' }
    ));
    process.exit(1);
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
