// core/logger.js
// 📜 Structured Logger - Console & File Logging (Text/JSON)

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

const LOG_DIR = './logs';
const TEXT_LOG = path.join(LOG_DIR, 'golem.log');
const JSON_LOG = path.join(LOG_DIR, 'golem.json');
const LEVEL = process.env.AGENT_LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  constructor(module) {
    this.module = module;
    fs.ensureDirSync(LOG_DIR);
  }

  _log(level, ...args) {
    if (LEVELS[level] < LEVELS[LEVEL]) return;

    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const moduleStr = this.module.padEnd(10);
    
    // 提取物件以進行結構化紀錄
    const data = args.find(a => typeof a === 'object' && a !== null) || {};
    const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');

    // 1. Console Output (Colorized)
    const colors = {
      debug: chalk.gray,
      info: chalk.blueBright,
      warn: chalk.yellow,
      error: chalk.red.bold
    };
    const colorFn = colors[level] || chalk.white;
    const prefix = chalk.dim(`[${timestamp}]`) + ` ${colorFn(levelStr)} ${chalk.magenta(`[${moduleStr}]`)}`;
    console.log(prefix, message);

    // 2. Text File Output
    const textLine = `[${timestamp}] [${levelStr}] [${moduleStr}] ${message}\n`;
    fs.appendFile(TEXT_LOG, textLine).catch(() => {});

    // 3. JSON File Output (For analysis)
    const jsonEntry = JSON.stringify({
      timestamp,
      level,
      module: this.module,
      message,
      data
    }) + '\n';
    fs.appendFile(JSON_LOG, jsonEntry).catch(() => {});
  }

  debug(...args) { this._log('debug', ...args); }
  info(...args) { this._log('info', ...args); }
  warn(...args) { this._log('warn', ...args); }
  error(...args) { this._log('error', ...args); }
}
