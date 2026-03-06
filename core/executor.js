// core/executor.js
// ⚡ Tool Executor - Handles all agent actions

import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from './logger.js';

const execAsync = promisify(exec);
const WORKSPACE = process.env.AGENT_WORKSPACE || './projects';

export class Executor {
  constructor(memory) {
    this.memory = memory;
    this.logger = new Logger('Executor');
    fs.ensureDirSync(WORKSPACE);
  }

  async execute(action, context = {}) {
    this.logger.info(`⚡ Executing: ${action.type}`);

    const handlers = {
      speak: () => this._speak(action),
      code: () => this._generateCode(action),
      create_file: () => this._createFile(action),
      create_project: () => this._createProject(action),
      execute_code: () => this._executeCode(action),
      read_file: () => this._readFile(action),
      search_web: () => this._searchWeb(action),
      remember: () => this._remember(action),
      reflect: () => this._reflect(action),
      ask_user: () => this._askUser(action),
      list_files: () => this._listFiles(action),
      run_command: () => this._runCommand(action),
    };

    const handler = handlers[action.type];
    if (!handler) {
      this.logger.warn(`Unknown action type: ${action.type}`);
      return { success: false, error: `Unknown action: ${action.type}` };
    }

    try {
      const result = await handler();
      await this.memory.logWork(action.type, action.content?.substring(0, 80) || '', result);
      return result;
    } catch (error) {
      this.logger.error(`Execution failed for ${action.type}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  _speak(action) {
    return { success: true, output: action.content };
  }

  async _generateCode(action) {
    const { content, metadata = {} } = action;
    const filename = metadata.filename || `code_${Date.now()}.${metadata.lang || 'js'}`;
    const filepath = path.join(WORKSPACE, metadata.project || 'scratch', filename);

    await fs.ensureDir(path.dirname(filepath));
    await fs.writeFile(filepath, content, 'utf-8');

    this.logger.info(`📝 Code written: ${filepath}`);

    await this.memory.store({
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

  async _createFile(action) {
    const { content, metadata = {} } = action;
    const { filepath, encoding = 'utf-8' } = metadata;

    if (!filepath) {
      return { success: false, error: 'No filepath specified' };
    }

    const fullPath = filepath.startsWith('/') ? filepath : path.join(WORKSPACE, filepath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, encoding);

    this.logger.info(`📄 File created: ${fullPath}`);
    return {
      success: true,
      filepath: fullPath,
      output: `✅ 檔案已建立: ${fullPath}`
    };
  }

  async _createProject(action) {
    const { metadata = {} } = action;
    const {
      name,
      type = 'node', // node, python, web, react
      description = '',
      files = []
    } = metadata;

    if (!name) {
      return { success: false, error: 'Project name required' };
    }

    const projectDir = path.join(WORKSPACE, name);
    await fs.ensureDir(projectDir);

    // Create project structure based on type
    const structures = {
      node: {
        'package.json': JSON.stringify({
          name,
          version: '1.0.0',
          description,
          main: 'index.js',
          type: 'module',
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

    // Write template files
    for (const [filename, content] of Object.entries(template)) {
      await fs.writeFile(path.join(projectDir, filename), content, 'utf-8');
    }

    // Write any additional custom files
    for (const file of files) {
      const filePath = path.join(projectDir, file.path);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, file.content, 'utf-8');
    }

    // Create project manifest
    const manifest = {
      name,
      type,
      description,
      created: new Date().toISOString(),
      files: Object.keys(template).concat(files.map(f => f.path))
    };
    await fs.writeJSON(path.join(projectDir, '.golem-manifest.json'), manifest, { spaces: 2 });

    await this.memory.store({
      type: 'project',
      content: `Created project: ${name} (${type})`,
      context: description,
      projectDir
    });

    this.logger.info(`🚀 Project created: ${projectDir}`);
    return {
      success: true,
      projectDir,
      files: manifest.files,
      output: `✅ 專案 "${name}" 已建立！\n📁 位置: ${projectDir}\n📄 檔案: ${manifest.files.join(', ')}`
    };
  }

  async _executeCode(action) {
    const { content, metadata = {} } = action;
    const lang = metadata.lang || 'node';
    const timeout = metadata.timeout || 30000;

    // Write temp file
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

      return {
        success: true,
        stdout,
        stderr,
        output: stdout || '(no output)'
      };
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

  async _readFile(action) {
    const filepath = action.content || action.metadata?.filepath;
    if (!filepath) return { success: false, error: 'No filepath' };

    const fullPath = filepath.startsWith('/') ? filepath : path.join(WORKSPACE, filepath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, content, filepath: fullPath };
    } catch (e) {
      return { success: false, error: `Cannot read file: ${e.message}` };
    }
  }

  async _searchWeb(action) {
    const query = action.content;
    // Use DuckDuckGo instant answer API (no auth needed)
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
      const response = await fetch(url);
      const data = await response.json();

      const results = {
        abstract: data.Abstract || '',
        answer: data.Answer || '',
        relatedTopics: (data.RelatedTopics || []).slice(0, 5).map(t => t.Text || '').filter(Boolean)
      };

      return {
        success: true,
        results,
        output: `🔍 搜尋結果:\n${results.abstract || results.answer || results.relatedTopics.join('\n') || '無結果'}`
      };
    } catch (e) {
      return { success: false, error: `Search failed: ${e.message}` };
    }
  }

  async _remember(action) {
    const memory = await this.memory.store({
      type: action.metadata?.type || 'fact',
      content: action.content,
      importance: action.metadata?.importance || 0.7
    });
    return { success: true, memoryId: memory.id, output: `✅ 已記住: ${action.content}` };
  }

  async _reflect(action) {
    const stats = await this.memory.getStats();
    const recentWork = await this.memory.getRecentWork(10);

    return {
      success: true,
      stats,
      recentWork,
      output: `🪞 反思完成\n記憶: ${stats.total} 條\n最近工作: ${recentWork.length} 項`
    };
  }

  _askUser(action) {
    return {
      success: true,
      needsInput: true,
      question: action.content,
      output: action.content
    };
  }

  async _listFiles(action) {
    const dir = action.content || WORKSPACE;
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      const list = files.map(f => `${f.isDirectory() ? '📁' : '📄'} ${f.name}`);
      return { success: true, files: list, output: list.join('\n') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _runCommand(action) {
    // Safety check - only allow safe commands
    const cmd = action.content;
    const BLOCKED = ['rm -rf', 'sudo', 'curl | bash', 'wget | sh', 'chmod 777'];
    if (BLOCKED.some(b => cmd.includes(b))) {
      return { success: false, error: '⛔ 危險命令被攔截' };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000,
        cwd: WORKSPACE
      });
      return { success: true, stdout, stderr, output: stdout };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
