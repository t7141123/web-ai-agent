// core/tools/code.js
import fs from 'fs-extra';
import path from 'path';

export default {
  name: 'code',
  execute: async (action, { memory, logger, workspace }) => {
    const { content, metadata = {} } = action;
    const filename = metadata.filename || `code_${Date.now()}.${metadata.lang || 'js'}`;
    const filepath = path.join(workspace, metadata.project || 'scratch', filename);

    await fs.ensureDir(path.dirname(filepath));
    await fs.writeFile(filepath, content, 'utf-8');

    logger.info(`📝 Code written: ${filepath}`);

    await memory.store({
      type: 'code',
      content: `Created ${filename}`,
      context: content.substring(0, 200),
      filepath
    });

    return {
      success: true,
      filepath,
      filename,
      output: `✅ 程式碼已寫入: ${filepath}`
    };
  }
};
