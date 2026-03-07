// core/tools/read-file.js
import fs from 'fs-extra';
import path from 'path';

export default {
  name: 'read_file',
  execute: async (action, { workspace }) => {
    const filepath = action.content || action.metadata?.filepath;
    if (!filepath) return { success: false, error: 'No filepath' };

    const fullPath = filepath.startsWith('/') ? filepath : path.join(workspace, filepath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, content, filepath: fullPath };
    } catch (e) {
      return { success: false, error: `Cannot read file: ${e.message}` };
    }
  }
};
