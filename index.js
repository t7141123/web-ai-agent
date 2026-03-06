// index.js  (v3)
import 'dotenv/config';
import readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import { GolemAgent } from './core/agent.js';

const VERSION = '4.1.0';
const API_KEY = process.env.GEMINI_API_KEY;

function showBanner() {
  console.clear();
  console.log(boxen(
    chalk.bold.cyan(`
  ██╗    ██╗███████╗██████╗      █████╗ ██╗     ██████╗ ███████╗███╗   ██╗████████╗
  ██║    ██║██╔════╝██╔══██╗    ██╔══██╗██║    ██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
  ██║ █╗ ██║█████╗  ██████╔╝    ███████║██║    ██║  ███╗█████╗  ██╔██╗ ██║   ██║   
  ██║███╗██║██╔══╝  ██╔══██╗    ██╔══██║██║    ██║   ██║██╔══╝  ██║╚██╗██║   ██║   
  ╚███╔███╔╝███████╗██████╔╝    ██║  ██║██║    ╚██████╔╝███████╗██║ ╚████║   ██║   
   ╚══╝╚══╝ ╚══════╝╚═════╝     ╚═╝  ╚═╝╚═╝     ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝`) +
    chalk.white(`\n\n  Web AI Agent v${VERSION} — 零成本自主 AI 智能體`) +
    chalk.green(`\n  💰 零成本模式 | ⚡ Gemini 3 (Flash)`) +
    chalk.dim(`\n  Flash API 路由 × Gemini 網頁版`),
    { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'cyan', textAlignment: 'center' }
  ));
}

function showHelp() {
  const cmds = [
    ['auto <目標>',    '自主模式：Agent 自動規劃並完成目標'],
    ['build <描述>',  '自動建立完整軟體專案'],
    ['tabs',             '查看分頁池狀態'],
    ['newtab',           '強制開啟新分頁（被阻擋時使用）'],
    ['headless/headed',  '切換瀏覽器顯示模式'],
    ['selectors',       '查看 selector 快取狀態（7天有效）'],
    ['rediscover',      '強制重新偵測所有 Gemini UI selector'],
    ['stats',           '路由統計（API vs 網頁版比例）'],
    ['memory',         '查看記憶統計'],
    ['clear',          '清除對話歷史'],
    ['exit',           '退出（自動關閉瀏覽器）'],
  ];
  console.log(chalk.bold.yellow('\n📖 指令:'));
  cmds.forEach(([cmd, desc]) => console.log(`  ${chalk.cyan(cmd.padEnd(18))} ${chalk.white(desc)}`));
  console.log(chalk.dim('\n  其他輸入直接與 Web AI Agent 對話（自動智能路由）\n'));
}

function validateSetup() {
  if (!API_KEY || API_KEY === 'your_gemini_api_key_here') {
    console.log(boxen(
      chalk.red.bold('❌ 缺少 Gemini API Key\n\n') +
      chalk.yellow('  1. cp .env.example .env\n') +
      chalk.yellow('  2. https://aistudio.google.com/app/apikey 取得免費 Key\n') +
      chalk.yellow('  3. 填入 .env 的 GEMINI_API_KEY'),
      { padding: 1, borderColor: 'red' }
    ));
    process.exit(1);
  }
}

async function main() {
  showBanner();
  validateSetup();

  const agent = new GolemAgent(API_KEY);

  console.log(chalk.green('  ✅ 訪客模式 — Gemini 網頁版（無需登入）'))

  const threshold = process.env.COMPLEXITY_THRESHOLD || '0.6';
  console.log(chalk.dim(`  🧭 路由閾值: ${threshold} | 複雜→網頁版(免費) | 簡單→Flash API`));

  const memStats = await agent.brain.memory.getStats();
  console.log(chalk.dim(`  💾 已載入 ${memStats.total} 條記憶`));

  showHelp();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question(chalk.bold.green('\n你 → '), async (input) => {
      const text = input.trim();
      if (!text) return prompt();

      if (text === 'exit' || text === 'quit') {
        const spinner = ora('關閉瀏覽器...').start();
        await agent.shutdown();
        spinner.succeed('已關閉');
        console.log(chalk.cyan('👋 再見！'));
        rl.close();
        return;
      }

      if (text === 'help' || text === '?') { showHelp(); return prompt(); }

      if (text === 'stats' || text === '統計') {
        const s = agent.brain.getRouterStats();
        console.log(boxen(
          chalk.bold('📊 路由統計\n\n') +
          chalk.yellow('Flash API：  ') + chalk.white(`${s.apiCalls} 次\n`) +
          chalk.green('網頁版(免費)：') + chalk.white(`${s.webCalls} 次\n`) +
          chalk.cyan('網頁版比例：  ') + chalk.white(`${s.webPercentage}`),
          { padding: 1, borderColor: 'cyan' }
        ));
        return prompt();
      }

      if (text === 'memory' || text === '記憶') {
        const stats  = await agent.brain.memory.getStats();
        const recent = await agent.brain.memory.getRecent(5);
        console.log(chalk.cyan('\n💾'), JSON.stringify(stats, null, 2));
        recent.forEach(m => console.log(chalk.dim(`  [${m.type}] ${(m.content||'').substring(0,80)}`)));
        return prompt();
      }

      if (text === 'clear')    { await agent.brain.clearHistory(); console.log(chalk.green('✅ 已清除')); return prompt(); }
      if (text === 'headless') { process.env.BROWSER_MODE = 'headless'; console.log(chalk.green('✅ 下次啟動瀏覽器時使用背景模式')); return prompt(); }
      if (text === 'headed')   { process.env.BROWSER_MODE = 'headed';   console.log(chalk.green('✅ 下次啟動瀏覽器時顯示視窗'));    return prompt(); }
      if (text === 'selectors' || text === 'sel') {
        const wc = agent.brain.router.webClient;
        if (!wc) { console.log(chalk.yellow('⚠️  瀏覽器尚未啟動')); return prompt(); }
        const sp = ora('查詢 selector...').start();
        const rows = await wc.selectorStatus(); sp.stop();
        if (!rows.length) { console.log(chalk.yellow('  尚無快取，將在下次使用時自動偵測')); return prompt(); }
        console.log(chalk.bold(`
🔍 Selector 快取:`));
        rows.forEach(r => console.log('  ' + r.status + ' ' + chalk.cyan(r.element.padEnd(18)) + ' ' + chalk.dim((r.selector||'').substring(0,50)) + '  ' + chalk.dim(r.age)));
        console.log(chalk.dim(`
  輸入 rediscover 強制重新偵測
`));
        return prompt();
      }
      if (text === 'tabs' || text === '分頁') {
        const wc = agent.brain.router.webClient;
        if (!wc) { console.log(chalk.yellow('  瀏覽器尚未啟動，首次對話時自動開啟')); return prompt(); }
        const health = await wc.healthCheck();
        console.log(boxen(
          chalk.bold('🗂️  分頁池狀態\n\n') +
          chalk.cyan('存活分頁：  ') + chalk.white(health.tabs?.alive + ' / ' + health.tabs?.total + '（上限 ' + health.tabs?.max + '）\n') +
          chalk.green('當前分頁：  ') + chalk.white('#' + (health.activeTab || '-') + '\n') +
          (health.blocked ? chalk.red('阻擋狀態：  ' + health.blocked) : chalk.green('阻擋狀態：  正常')),
          { padding: 1, borderColor: health.healthy ? 'cyan' : 'red' }
        ));
        return prompt();
      }
      if (text === 'newtab' || text === '新分頁') {
        const wc = agent.brain.router.webClient;
        if (!wc) { console.log(chalk.yellow('  瀏覽器尚未啟動')); return prompt(); }
        const sp = ora(chalk.cyan('開啟新分頁...')).start();
        await wc._rotateTab();
        sp.succeed(chalk.green('✅ 已切換到新分頁'));
        return prompt();
      }
      if (text === 'rediscover') {
        const wc = agent.brain.router.webClient;
        if (!wc) { console.log(chalk.yellow('⚠️  瀏覽器尚未啟動')); return prompt(); }
        const sp = ora(chalk.cyan('重新偵測所有 selector...')).start();
        const r = await wc.rediscover();
        if (r.success) {
          const n = Object.values(r.selectors).filter(Boolean).length;
          sp.succeed(chalk.green('✅ 完成！找到 ' + n + ' 個 selector'));
          Object.entries(r.selectors).forEach(([k,v]) => console.log('  ' + (v?chalk.green('✅'):chalk.red('❌')) + ' ' + chalk.cyan(k.padEnd(18)) + ' ' + chalk.dim(v||'未找到')));
        } else { sp.fail(chalk.red('❌ ' + r.error)); }
        return prompt();
      }

      if (text.startsWith('auto '))  { await agent.runAutonomous(text.slice(5));  return prompt(); }
      if (text.startsWith('build ')) { await agent.buildProject(text.slice(6));   return prompt(); }

      try {
        const result = await agent.chat(text);
        if (result?.thought?._source) {
          const src = result.thought._source;
          const ms  = result.thought._elapsed;
          const badge = src === 'web' ? chalk.green('[網頁版·免費]') : chalk.yellow('[Flash API]');
          console.log(chalk.dim(`  ${badge} ${ms}ms`));
        }
      } catch (error) {
        console.log(chalk.red(`\n❌ ${error.message}`));
        if (error.message.includes('阻擋') || error.message.includes('blocked')) console.log(chalk.yellow('💡 輸入 rediscover 重新偵測 UI selector'));
      }

      prompt();
    });
  };

  rl.on('SIGINT', async () => {
    console.log(chalk.cyan('\n\n正在關閉...'));
    await agent.shutdown();
    process.exit(0);
  });

  prompt();
}

main().catch(e => { console.error(chalk.red('Fatal:'), e.message); process.exit(1); });
