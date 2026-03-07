// core/executor.js
// ⚡ Tool Executor (v2 - Plugin Architecture)
//
// 動態載入 core/tools/ 下的所有工具插件，使其更易擴展

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.AGENT_WORKSPACE || './projects';
const TOOLS_DIR = path.join(__dirname, 'tools');

export class Executor {
  constructor(memory) {
    this.memory = memory;
    this.logger = new Logger('Executor');
    this.tools  = new Map();
    this._initP = this._loadTools();
    fs.ensureDirSync(WORKSPACE);
  }

  // ── 動態載入工具插件 ──────────────────────────────────────────────────
  async _loadTools() {
    try {
      const files = await fs.readdir(TOOLS_DIR);
      for (const file of files) {
        if (file.endsWith('.js')) {
          const fullPath = path.join(TOOLS_DIR, file);
          const toolModule = await import(pathToFileURL(fullPath).href);
          const tool = toolModule.default;
          
          if (tool && tool.name && tool.execute) {
            this.tools.set(tool.name, tool);
          }
        }
      }
      this.logger.info(`⚡ 已載入 ${this.tools.size} 個工具插件`);
    } catch (e) {
      this.logger.error(`工具載入失敗: ${e.message}`);
    }
  }

  async execute(action, context = {}) {
    await this._initP;
    this.logger.info(`⚡ Executing: ${action.type}`);

    const tool = this.tools.get(action.type);
    if (!tool) {
      this.logger.warn(`Unknown action type: ${action.type}`);
      return { success: false, error: `Unknown action: ${action.type}` };
    }

    try {
      const result = await tool.execute(action, {
        memory: this.memory,
        logger: this.logger,
        workspace: WORKSPACE,
        context
      });

      // 記錄工作日誌
      await this.memory.logWork(
        action.type, 
        action.content?.substring(0, 80) || '', 
        result
      ).catch(() => {});

      return result;
    } catch (error) {
      this.logger.error(`Execution failed for ${action.type}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // 取得所有可用工具列表
  getAvailableTools() {
    return Array.from(this.tools.keys());
  }
}
