// core/logger.js
import chalk from 'chalk';
import fs from 'fs-extra';

const LOG_FILE = './logs/golem.log';
const LEVEL = process.env.AGENT_LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  constructor(module) {
    this.module = module;
    fs.ensureDirSync('./logs');
  }

  _log(level, ...args) {
    if (LEVELS[level] < LEVELS[LEVEL]) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.module}]`;

    const colors = {
      debug: chalk.gray,
      info: chalk.cyan,
      warn: chalk.yellow,
      error: chalk.red
    };

    const colorFn = colors[level] || chalk.white;
    console.log(colorFn(prefix), ...args);

    // Also write to log file
    const logLine = `${prefix} ${args.join(' ')}\n`;
    fs.appendFile(LOG_FILE, logLine).catch(() => {});
  }

  debug(...args) { this._log('debug', ...args); }
  info(...args) { this._log('info', ...args); }
  warn(...args) { this._log('warn', ...args); }
  error(...args) { this._log('error', ...args); }
}
