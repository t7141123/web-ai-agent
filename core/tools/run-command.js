// core/tools/run-command.js
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export default {
  name: 'run_command',
  execute: async (action, { workspace, logger }) => {
    const cmd = action.content;
    const BLOCKED = ['rm -rf', 'sudo', 'curl | bash', 'wget | sh', 'chmod 777'];
    if (BLOCKED.some(b => cmd.includes(b))) {
      return { success: false, error: '⛔ 危險命令被攔截' };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000,
        cwd: workspace
      });
      return { success: true, stdout, stderr, output: stdout };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
