// core/tools/execute-code.js
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export default {
  name: 'execute_code',
  execute: async (action, { logger }) => {
    const { content, metadata = {} } = action;
    const lang = metadata.lang || 'node';
    const timeout = metadata.timeout || 30000;

    const ext = { node: 'js', python: 'py', bash: 'sh' }[lang] || 'js';
    const tmpFile = path.join('./logs', `exec_${Date.now()}.${ext}`);
    await fs.ensureDir('./logs');
    await fs.writeFile(tmpFile, content, 'utf-8');

    const commands = {
      node: `node "${tmpFile}"`,
      python: `python3 "${tmpFile}"`,
      bash: `bash "${tmpFile}"`
    };

    const cmd = commands[lang];
    if (!cmd) {
      return { success: false, error: `Unsupported language: ${lang}` };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout });
      await fs.remove(tmpFile);
      return { success: true, stdout, stderr, output: stdout || '(no output)' };
    } catch (error) {
      await fs.remove(tmpFile).catch(() => {});
      return {
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      };
    }
  }
};
