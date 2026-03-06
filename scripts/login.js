// scripts/login.js
// 🧪 訪客模式連線測試
// 確認 Gemini 訪客模式可以正常使用
// 執行方式: npm run login  (指令名稱保留，避免舊用戶困惑)

import 'dotenv/config';
import { GeminiWebClient } from '../browser/gemini-web.js';
import chalk from 'chalk';
import boxen from 'boxen';

console.log(boxen(
  chalk.bold.cyan('🧪 GOLEM 訪客模式測試\n\n') +
  chalk.white('這個腳本會：\n') +
  chalk.white('  1. 開啟有視窗的 Chrome 瀏覽器\n') +
  chalk.white('  2. 以訪客身份前往 Gemini\n') +
  chalk.white('  3. 確認可以正常使用\n') +
  chalk.white('  4. 測試發送一則訊息\n\n') +
  chalk.dim('完全不需要 Google 帳號'),
  { padding: 1, borderColor: 'cyan', borderStyle: 'double' }
));

async function main() {
  // 強制 headed 模式，讓用戶看到過程
  process.env.BROWSER_MODE = 'headed';
  const client = new GeminiWebClient(process.env.GEMINI_API_KEY);

  try {
    console.log(chalk.cyan('\n🚀 啟動瀏覽器（有視窗模式）...'));
    await client.launch(true);

    console.log(chalk.cyan('🌐 前往 Gemini（訪客模式）...'));
    const nav = await client.navigate();

    if (!nav.ready) {
      throw new Error(nav.error || '無法載入 Gemini');
    }

    console.log(chalk.green('\n✅ Gemini 訪客模式就緒！'));
    console.log(chalk.dim(`   找到 ${Object.values(nav.selectors || {}).filter(Boolean).length} 個 UI 元素\n`));

    // 發送測試訊息
    console.log(chalk.cyan('📤 發送測試訊息...'));
    const result = await client.sendMessage('請用繁體中文回答：1+1等於幾？只需回答數字。');

    if (result.success && result.response) {
      console.log(chalk.green(`✅ 收到回應: "${result.response.substring(0, 80)}"`));
      console.log(boxen(
        chalk.bold.green('🎉 訪客模式運作正常！\n\n') +
        chalk.white('現在可以直接執行:\n') +
        chalk.cyan('  npm start'),
        { padding: 1, borderColor: 'green' }
      ));
    } else {
      throw new Error(result.error || '發送失敗');
    }

  } catch (error) {
    console.error(chalk.red('\n❌ 測試失敗:'), error.message);
    console.log(chalk.yellow('\n💡 可能的原因：'));
    console.log(chalk.dim('  - 網路連線問題'));
    console.log(chalk.dim('  - Gemini 介面有更新 → 執行 npm start 後輸入 rediscover'));
    console.log(chalk.dim('  - 地區限制（某些地區無法使用訪客模式）'));
    process.exit(1);
  } finally {
    await new Promise(r => setTimeout(r, 4000)); // 讓用戶看結果
    await client.close();
    process.exit(0);
  }
}

main();
