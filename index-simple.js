// index.js - Gemini Web AI Agent (Telegram Bot 版本)
// 
// 🧩 簡化版架構
// 1. 啟動瀏覽器（使用預設模型）
// 2. 透過 Telegram Bot 接收用戶訊息
// 3. 轉發給 Gemini Web
// 4. 回覆結果到 Telegram
//
// 類似 OpenClaw 的功能，但是使用 Gemini Web 免費版本

import 'dotenv/config';
import { TelegramBotService } from './telegram/bot.js';
import { GeminiWebSimple } from './browser/gemini-web-simple.js';
import chalk from 'chalk';
import boxen from 'boxen';
import readline from 'readline';

const VERSION = '1.0.0';

// ════════════════════════════════════════════════════════════════════════════
//  顯示歡迎畫面
// ════════════════════════════════════════════════════════════════════════════
function showBanner() {
  console.clear();
  console.log(
    boxen(
      chalk.bold.cyan(`
  ╔═╗╔═╗╦  ╦╔═╗╔═╗╔═╗╔═╗
  ╠═╣╠═╝╚╗╔╝╠═╣╚═╗╠═╝╠═╣
  ╩ ╩╩   ╚╝ ╩ ╩╚═╝╩  ╩ ╩`) +
      chalk.white(`\n\n  Gemini Web AI Agent v${VERSION}`) +
      chalk.green(`\n\n  🌐 使用 Gemini Web（免費）`) +
      chalk.cyan(`\n  🤖 Telegram Bot 整合`) +
      chalk.dim(`\n\n  類似 OpenClaw 的功能`),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan', textAlignment: 'center' }
    )
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  驗證環境配置
// ════════════════════════════════════════════════════════════════════════════
function validateConfig() {
  const errors = [];

  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your_bot_token_here') {
    errors.push('TELEGRAM_BOT_TOKEN - 請在 .env 中設置您的 Telegram Bot Token');
  }

  if (errors.length > 0) {
    console.log(
      boxen(
        chalk.red.bold('❌ 配置錯誤\n\n') +
        errors.map(e => chalk.yellow('• ') + e).join('\n') +
        chalk.dim('\n\n請複製 .env.example 到 .env 並填寫正確的配置'),
        { padding: 1, borderColor: 'red' }
      )
    );
    return false;
  }

  return true;
}

// ════════════════════════════════════════════════════════════════════════════
//  顯示說明
// ════════════════════════════════════════════════════════════════════════════
function showHelp() {
  console.log(
    boxen(
      chalk.bold.cyan('📖 使用說明\n') +
      chalk.white('\n1️⃣  啟動服務後，在 Telegram 搜尋您的機器人') +
      chalk.white('\n2️⃣  傳送 /start 開始使用') +
      chalk.white('\n3️⃣  直接輸入問題，AI 會回覆您') +
      chalk.white('\n\n📋 可用指令：') +
      chalk.cyan('\n  /start  - 開始使用') +
      chalk.cyan('\n  /help   - 顯示說明') +
      chalk.cyan('\n  /reset  - 重置對話') +
      chalk.cyan('\n  /status - 查看狀態') +
      chalk.white('\n\n🛑 輸入 quit 或按 Ctrl+C 退出'),
      { padding: 1, borderColor: 'cyan' }
    )
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  主程式
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  showBanner();

  if (!validateConfig()) {
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let botService = null;

  console.log(chalk.cyan('\n⚙️  正在啟動服務...\n'));

  try {
    // 啟動 Telegram Bot 服務
    botService = new TelegramBotService();
    await botService.start();

    showHelp();

    // 命令循環
    rl.on('line', async (input) => {
      const cmd = input.trim().toLowerCase();

      if (cmd === 'quit' || cmd === 'exit' || cmd === '離開') {
        console.log(chalk.cyan('\n👋 正在關閉服務...'));
        await botService.stop();
        rl.close();
        process.exit(0);
      } else if (cmd === 'help' || cmd === '?') {
        showHelp();
      } else if (cmd === 'status') {
        const status = botService.getStatus();
        console.log(chalk.cyan('\n📊 服務狀態：'));
        console.log(`   運行中：${status.isRunning ? '✅' : '❌'}`);
        console.log(`   運行時間：${Math.round(status.uptime / 60)} 分鐘`);
        console.log(`   處理訊息：${status.messageCount} 則`);
        console.log(`   Gemini: ${status.geminiReady ? '✅' : '⏳'}`);
      } else if (cmd) {
        console.log(chalk.yellow('   請在 Telegram 中使用機器人，或輸入 help 查看說明'));
      }
    });

    rl.on('SIGINT', async () => {
      console.log(chalk.cyan('\n\n👋 正在關閉服務...'));
      if (botService) await botService.stop();
      rl.close();
      process.exit(0);
    });

  } catch (error) {
    console.error(chalk.red.bold('\n❌ 啟動失敗:'), error.message);
    if (botService) await botService.stop();
    process.exit(1);
  }
}

// 啟動
main().catch(error => {
  console.error(chalk.red.bold('Fatal Error:'), error.message);
  console.error(error.stack);
  process.exit(1);
});
