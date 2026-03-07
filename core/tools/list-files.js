// core/tools/list-files.js
import fs from 'fs-extra';

export default {
  name: 'list_files',
  execute: async (action, { workspace }) => {
    const dir = action.content || workspace;
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      const list = files.map(f => `${f.isDirectory() ? '📁' : '📄'} ${f.name}`);
      return { success: true, files: list, output: list.join('\n') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
