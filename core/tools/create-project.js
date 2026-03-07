// core/tools/create-project.js
import fs from 'fs-extra';
import path from 'path';

export default {
  name: 'create_project',
  execute: async (action, { memory, logger, workspace }) => {
    const { metadata = {} } = action;
    const { name, type = 'node', description = '', files = [] } = metadata;

    if (!name) return { success: false, error: 'Project name required' };

    const projectDir = path.join(workspace, name);
    await fs.ensureDir(projectDir);

    const structures = {
      node: {
        'package.json': JSON.stringify({
          name, version: '1.0.0', description, main: 'index.js', type: 'module',
          scripts: { start: 'node index.js', test: 'node test.js' }
        }, null, 2),
        'index.js': `// ${name}\n// ${description}\n\nconsole.log('${name} started');\n`,
        'README.md': `# ${name}\n\n${description}\n\n## Setup\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`,
        '.gitignore': 'node_modules/\n.env\nlogs/\n'
      },
      python: {
        'main.py': `#!/usr/bin/env python3\n# ${name}\n# ${description}\n\nif __name__ == '__main__':\n    print('${name} started')\n`,
        'requirements.txt': '# Add dependencies here\n',
        'README.md': `# ${name}\n\n${description}\n\n## Setup\n\`\`\`bash\npip install -r requirements.txt\npython main.py\n\`\`\`\n`,
        '.gitignore': '__pycache__/\n*.pyc\n.env\nvenv/\n'
      },
      web: {
        'index.html': `<!DOCTYPE html>\n<html lang="zh-TW">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <p>${description}</p>\n  <script src="main.js"></script>\n</body>\n</html>\n`,
        'style.css': `/* ${name} styles */\nbody {\n  font-family: system-ui, sans-serif;\n  max-width: 800px;\n  margin: 0 auto;\n  padding: 2rem;\n}\n`,
        'main.js': `// ${name}\nconsole.log('${name} loaded');\n`,
        'README.md': `# ${name}\n\n${description}\n`
      }
    };

    const template = structures[type] || structures.node;
    for (const [filename, content] of Object.entries(template)) {
      await fs.writeFile(path.join(projectDir, filename), content, 'utf-8');
    }

    for (const file of files) {
      const filePath = path.join(projectDir, file.path);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, file.content, 'utf-8');
    }

    const manifest = {
      name, type, description,
      created: new Date().toISOString(),
      files: Object.keys(template).concat(files.map(f => f.path))
    };
    await fs.writeJSON(path.join(projectDir, '.golem-manifest.json'), manifest, { spaces: 2 });

    await memory.store({
      type: 'project',
      content: `Created project: ${name} (${type})`,
      context: description, projectDir
    });

    logger.info(`🚀 Project created: ${projectDir}`);
    return {
      success: true, projectDir, files: manifest.files,
      output: `✅ 專案 "${name}" 已建立！\n📁 位置: ${projectDir}\n📄 檔案: ${manifest.files.join(', ')}`
    };
  }
};
