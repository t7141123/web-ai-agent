// core/tools/create-file.js
import fs from 'fs-extra';
import path from 'path';

export default {
  name: 'create_file',
  execute: async (action, { workspace, logger }) => {
    const { content, metadata = {} } = action;
    const { filepath, encoding = 'utf-8' } = metadata;

    if (!filepath) {
      return { success: false, error: 'No filepath specified' };
    }

    const fullPath = filepath.startsWith('/') ? filepath : path.join(workspace, filepath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, encoding);

    logger.info(`📄 File created: ${fullPath}`);
    return {
      success: true,
      filepath: fullPath,
      output: `✅ 檔案已建立: ${fullPath}`
    };
  }
};
