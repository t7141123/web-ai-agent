#!/usr/bin/env node
// scripts/test-simple.js
// 測試簡化版 Gemini Web 客戶端

import { GeminiWebSimple } from '../browser/gemini-web-simple.js';
import chalk from 'chalk';

async function test() {
  console.log(chalk.cyan.bold('\n🧪 測試 Gemini Web Simple\n'));

  const gemini = new GeminiWebSimple();

  try {
    // 1. 啟動瀏覽器
    console.log(chalk.white('1. 啟動瀏覽器...'));
    await gemini.launch(false); // headed 模式
    console.log(chalk.green('   ✅ 啟動成功\n'));

    // 2. 開啟對話
    console.log(chalk.white('2. 開啟對話頁...'));
    const opened = await gemini.openChat();
    if (!opened) {
      throw new Error('無法開啟對話頁');
    }
    console.log(chalk.green('   ✅ 對話頁就緒\n'));

    // 3. 發送測試問題
    console.log(chalk.white('3. 發送測試問題...'));
    const testQuestion = '你好，請簡單介紹你自己';
    console.log(chalk.dim(`   問題：${testQuestion}\n`));
    
    const result = await gemini.ask(testQuestion);
    
    if (result.success) {
      console.log(chalk.green('   ✅ 收到回覆\n'));
      console.log(chalk.cyan.bold('回覆內容：'));
      console.log(chalk.white(result.response.substring(0, 500) + '...\n'));
      console.log(chalk.dim(`   長度：${result.response.length} 字元`));
      console.log(chalk.dim(`   時間：${result.timestamp}\n`));
    } else {
      throw new Error(`發送失敗：${result.error}`);
    }

    // 4. 健康檢查
    console.log(chalk.white('4. 健康檢查...'));
    const health = await gemini.healthCheck();
    console.log(chalk.green(`   ✅ 狀態：${JSON.stringify(health, null, 2)}\n`));

    console.log(chalk.green.bold('✅ 測試完成！\n'));

  } catch (error) {
    console.error(chalk.red.bold('\n❌ 測試失敗:'), error.message);
    console.error(error.stack);
  } finally {
    // 關閉瀏覽器
    console.log(chalk.white('\n5. 關閉瀏覽器...'));
    await gemini.close();
    console.log(chalk.green('   ✅ 已關閉\n'));
  }
}

// 執行測試
test().catch(error => {
  console.error(chalk.red('Fatal:', error.message));
  process.exit(1);
});
