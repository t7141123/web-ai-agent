// setup/install.js
// ⚙️ GOLEM 跨平台安裝程式（Node.js 版本）
// 當 setup.sh / setup.bat 安裝好 Node.js 後，接手完成剩餘設定
// 也可單獨執行：node setup/install.js

import { execSync, spawn } from 'child_process';
import { createInterface }  from 'readline';
import fs                   from 'fs';
import path                 from 'path';
import os                   from 'os';
import https                from 'https';
import { fileURLToPath }    from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const IS_WIN    = process.platform === 'win32';
const IS_MAC    = process.platform === 'darwin';
const VERSION   = '3.1.0';

// ── 顏色（純 ANSI，不依賴 chalk）─────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',  dim:    '\x1b[2m',
  red:    '\x1b[31m', green:  '\x1b[32m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', white:  '\x1b[37m', bgCyan: '\x1b[46m',
};
const ok   = (m) => console.log(`  ${C.green}✅  ${m}${C.reset}`);
const info = (m) => console.log(`  ${C.cyan}→   ${m}${C.reset}`);
const warn = (m) => console.log(`  ${C.yellow}⚠   ${m}${C.reset}`);
const err  = (m) => console.log(`  ${C.red}❌  ${m}${C.reset}`);
const step = (n, t) => console.log(`\n${C.bold}[${n}/6] ${t}${C.reset}`);
const hr   = () => console.log(`  ${'─'.repeat(52)}`);

// ── 執行命令（同步，顯示輸出）────────────────────────────────────────────────
function run(cmd, opts = {}) {
  const { silent = false, cwd = ROOT, allowFail = false } = opts;
  try {
    const stdio = silent ? 'pipe' : 'inherit';
    execSync(cmd, { cwd, stdio, encoding: 'utf8' });
    return true;
  } catch (e) {
    if (!allowFail) throw e;
    return false;
  }
}

// ── 執行命令（非同步，回傳輸出）─────────────────────────────────────────────
function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
  } catch {
    return '';
  }
}

// ── 互動式輸入 ──────────────────────────────────────────────────────────────
async function ask(question, defaultVal = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = defaultVal ? `  ${question} [${defaultVal}]: ` : `  ${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

// ── 進度 spinner（純 ASCII，不依賴 ora）──────────────────────────────────────
function spinner(message) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan}${frames[i++ % frames.length]}${C.reset}  ${message}  `);
  }, 80);
  return {
    succeed: (msg) => { clearInterval(timer); process.stdout.write(`\r  ${C.green}✅${C.reset}  ${msg}\n`); },
    fail:    (msg) => { clearInterval(timer); process.stdout.write(`\r  ${C.red}❌${C.reset}  ${msg}\n`); },
    update:  (msg) => { message = msg; }
  };
}

// ── Banner ───────────────────────────────────────────────────────────────────
function showBanner() {
  process.stdout.write('\x1bc'); // clear
  console.log(`${C.cyan}${C.bold}`);
  console.log('  ██████╗  ██████╗ ██╗     ███████╗███╗   ███╗');
  console.log(' ██╔════╝ ██╔═══██╗██║     ██╔════╝████╗ ████║');
  console.log(' ██║  ███╗██║   ██║██║     █████╗  ██╔████╔██║');
  console.log(' ██║   ██║██║   ██║██║     ██╔══╝  ██║╚██╔╝██║');
  console.log(' ╚██████╔╝╚██████╔╝███████╗███████╗██║ ╚═╝ ██║');
  console.log("  ╚═════╝  ╚═════╝ ╚══════╝╚══════╝╚═╝     ╚═╝");
  console.log(`${C.reset}`);
  console.log(`  ${C.bold}零成本自主 AI 智能體 v${VERSION}${C.reset} — 安裝程式`);
  console.log(`  ${C.dim}平台: ${process.platform} | Node: ${process.version} | Arch: ${os.arch()}${C.reset}`);
  hr();
}

// ════════════════════════════════════════════════════════════════════════════
//  檢查項目
// ════════════════════════════════════════════════════════════════════════════

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1));
  if (major < 18) {
    err(`Node.js ${process.version} 版本過舊`);
    console.log(`\n  請安裝 Node.js 18 或以上版本：${C.cyan}https://nodejs.org${C.reset}\n`);
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);
}

function checkNpm() {
  const ver = runCapture('npm --version');
  if (!ver) { err('找不到 npm'); process.exit(1); }
  ok(`npm v${ver}`);
}

// ════════════════════════════════════════════════════════════════════════════
//  安裝 npm 套件
// ════════════════════════════════════════════════════════════════════════════

async function installDeps() {
  step(2, '安裝套件依賴');
  const sp = spinner('執行 npm install...');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'pipe' });
    sp.succeed('套件安裝完成');
  } catch (e) {
    sp.update('清除快取後重試...');
    execSync('npm cache clean --force', { cwd: ROOT, stdio: 'pipe' });
    try {
      execSync('npm install', { cwd: ROOT, stdio: 'pipe' });
      sp.succeed('套件安裝完成（重試成功）');
    } catch (e2) {
      sp.fail('npm install 失敗');
      console.log(`\n  錯誤詳情: ${e2.message}\n`);
      process.exit(1);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  安裝 Playwright + Chromium
// ════════════════════════════════════════════════════════════════════════════

async function installPlaywright() {
  step(3, '安裝 Chromium 瀏覽器（自動化用）');
  info('首次安裝約需 1-3 分鐘，請耐心等待...');

  // Linux：預先安裝系統依賴
  if (process.platform === 'linux') {
    await installLinuxDeps();
  }

  const sp = spinner('下載 Chromium...');
  const ok1 = run('npx playwright install chromium', { silent: true, allowFail: true });
  if (ok1) {
    sp.succeed('Chromium 安裝完成');
    return;
  }

  // 備用：只安裝 chromium，不帶系統依賴
  sp.update('嘗試備用安裝方式...');
  const ok2 = run('npx playwright install chromium', { silent: true, allowFail: true });
  if (ok2) {
    sp.succeed('Chromium 安裝完成（備用方式）');
  } else {
    sp.fail('Chromium 自動安裝失敗');
    warn('請手動執行: npx playwright install chromium');
    warn('或確認有安裝系統 Chrome（程式仍可使用）');
  }
}

async function installLinuxDeps() {
  // 嘗試安裝 Playwright 的 Linux 系統依賴
  const hasSudo  = runCapture('which sudo') !== '';
  const hasApt   = runCapture('which apt-get') !== '';
  const hasDnf   = runCapture('which dnf') !== '';

  if (hasApt && hasSudo) {
    info('安裝 Linux 系統依賴...');
    run(
      'sudo apt-get install -y libnss3 libnspr4 libdbus-1-3 ' +
      'libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 ' +
      'libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 ' +
      'libgbm1 libasound2 2>/dev/null || true',
      { silent: true, allowFail: true }
    );
  } else if (hasDnf && hasSudo) {
    run('sudo dnf install -y nss atk at-spi2-atk libdrm libxkbcommon libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib 2>/dev/null || true',
      { silent: true, allowFail: true }
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  設定 .env
// ════════════════════════════════════════════════════════════════════════════

async function setupEnv() {
  step(4, '設定環境');

  const envPath    = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');

  // 建立 .env（如果不存在）
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(examplePath, envPath);
    info('已建立 .env 設定檔');
  } else {
    ok('.env 已存在');
  }

  // 建立必要目錄
  for (const dir of ['browser', 'memory', 'projects', 'logs']) {
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  }
  ok('目錄結構就緒');

  // 讀取目前 .env
  let envContent = fs.readFileSync(envPath, 'utf8');
  const needsKey = envContent.includes('your_gemini_api_key_here');

  if (needsKey) {
    console.log('');
    console.log(`  ${C.bold}╔════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`  ${C.bold}║  需要設定 Gemini API Key（完全免費）              ║${C.reset}`);
    console.log(`  ${C.bold}║                                                    ║${C.reset}`);
    console.log(`  ${C.bold}║  步驟：                                            ║${C.reset}`);
    console.log(`  ${C.bold}║  1. 前往 https://aistudio.google.com/app/apikey  ║${C.reset}`);
    console.log(`  ${C.bold}║  2. 登入 Google 帳號                              ║${C.reset}`);
    console.log(`  ${C.bold}║  3. 點擊「Create API Key」                        ║${C.reset}`);
    console.log(`  ${C.bold}║  4. 複製後貼到下方（每月免費 150 萬 token）      ║${C.reset}`);
    console.log(`  ${C.bold}╚════════════════════════════════════════════════════╝${C.reset}`);
    console.log('');

    const apiKey = await ask('請貼上你的 Gemini API Key（Enter 跳過）');
    if (apiKey && apiKey.length > 10) {
      envContent = envContent.replace('your_gemini_api_key_here', apiKey);
      fs.writeFileSync(envPath, envContent, 'utf8');
      ok('API Key 已儲存');
    } else {
      warn('跳過 API Key 設定');
      warn('請之後手動編輯 .env 填入 GEMINI_API_KEY');
    }
  } else {
    ok('API Key 已設定');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  建立快速啟動腳本
// ════════════════════════════════════════════════════════════════════════════

function createLaunchers() {
  step(5, '建立快速啟動腳本');

  if (!IS_WIN) {
    const sh = `#!/usr/bin/env bash\ncd "$(dirname "$0")"\nnode index.js\n`;
    fs.writeFileSync(path.join(ROOT, 'start.sh'), sh, { mode: 0o755 });
    ok('start.sh');
  }

  if (IS_WIN) {
    fs.writeFileSync(path.join(ROOT, 'start.bat'), '@echo off\nchcp 65001 >nul\ncd /d "%~dp0"\nnode index.js\npause\n');
    ok('start.bat');
  }

  ok('npm start 可用');
}

// ════════════════════════════════════════════════════════════════════════════
//  連線驗證（訪客模式，不需登入）
// ════════════════════════════════════════════════════════════════════════════

async function verifyConnection() {
  step(6, '驗證 Gemini 訪客模式連線');
  console.log('');
  console.log(`  ${C.cyan}不需要 Google 帳號，以訪客身份直接使用 Gemini${C.reset}`);
  console.log('');

  const doTest = await ask('立即開啟瀏覽器測試連線? [Y/n]', 'Y');
  if (doTest.toLowerCase() === 'n') {
    warn('跳過測試，直接執行 npm start 啟動');
    return;
  }

  info('開啟瀏覽器，驗證訪客模式...');
  try {
    run('node scripts/login.js', { silent: false });
    ok('連線驗證完成');
  } catch {
    warn('驗證中斷，請直接執行 npm start（訪客模式仍然可用）');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  完成畫面
// ════════════════════════════════════════════════════════════════════════════

function showSuccess() {
  console.log('');
  console.log(`  ${C.green}${C.bold}══════════════════════════════════════════════════════${C.reset}`);
  console.log(`  ${C.green}${C.bold}  🎉 GOLEM Agent 安裝完成！${C.reset}`);
  console.log(`  ${C.green}${C.bold}══════════════════════════════════════════════════════${C.reset}`);
  console.log('');
  console.log(`  ${C.bold}啟動方式：${C.reset}`);

  if (IS_WIN) {
    console.log(`    ${C.cyan}雙擊 start.bat${C.reset}     ${C.dim}# 最簡單${C.reset}`);
    console.log(`    ${C.cyan}npm start${C.reset}          ${C.dim}# 命令列${C.reset}`);
  } else {
    console.log(`    ${C.cyan}./start.sh${C.reset}        ${C.dim}# 最簡單${C.reset}`);
    console.log(`    ${C.cyan}npm start${C.reset}         ${C.dim}# 命令列${C.reset}`);
  }

  console.log('');
  console.log(`  ${C.bold}對話範例：${C.reset}`);
  console.log(`    ${C.dim}你 → 幫我寫一個 Python 爬蟲${C.reset}`);
  console.log(`    ${C.dim}你 → build 一個 Express.js REST API${C.reset}`);
  console.log(`    ${C.dim}你 → auto 研究最新 AI 框架趨勢${C.reset}`);
  console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
//  主流程
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  showBanner();

  // 步驟 1：環境檢查
  step(1, '檢查執行環境');
  checkNodeVersion();
  checkNpm();

  // 步驟 2-6
  await installDeps();
  await installPlaywright();
  await setupEnv();
  createLaunchers();
  await verifyConnection();

  showSuccess();
}

main().catch((e) => {
  console.log('');
  err(`安裝失敗：${e.message}`);
  console.log(`\n  ${C.dim}詳細錯誤：${e.stack}${C.reset}\n`);
  process.exit(1);
});
