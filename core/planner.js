// core/planner.js
// 🗺️ Task Planner - Breaks down complex goals into actionable sub-tasks
//
// 支援：
//  - 多步驟計畫生成
//  - 動態調整計畫 (Replanning)
//  - 任務狀態追蹤

import { Logger } from './logger.js';

export class TaskPlanner {
  constructor(brain) {
    this.brain  = brain;
    this.logger = new Logger('Planner');
    this.plan   = [];
    this.goal   = '';
    this.currentStepIndex = -1;
    this.history = [];
  }

  // ── 生成初步計畫 ──────────────────────────────────────────────────────
  async createPlan(goal) {
    this.goal = goal;
    this.logger.info(`🗺️ 為目標生成計畫: ${goal}`);

    const prompt = `你是一個高級工作規劃顧問。請將以下用戶目標拆解為一個詳細的執行計畫。
每個步驟必須是 Golem Agent 可以執行的單一動作（例如：create_project, run_command, search_web, code）。

目標：${goal}

請以 JSON 陣列格式輸出計畫，每個物件包含：
- id: 步驟編號 (1, 2, 3...)
- title: 簡短標題
- description: 詳細描述該步驟要做什麼
- type: 預期使用的工具類型 (optional)

輸出必須是純 JSON。`;

    try {
      // 利用 router 進行規劃 (強制使用 Web 版以獲得更好的推理)
      const route = await this.brain.router.forceRoute(prompt, 'web');
      if (!route.success) throw new Error(route.error);

      // 解析 JSON (處理 Markdown 區塊包裹的情況)
      const cleanJson = route.response.replace(/```json|```/g, '').trim();
      this.plan = JSON.parse(cleanJson);
      this.currentStepIndex = 0;
      this.history = [];

      this.logger.info(`✅ 計畫已生成，共 ${this.plan.length} 個步驟`);
      return this.plan;
    } catch (e) {
      this.logger.error(`計畫生成失敗: ${e.message}`);
      // Fallback: 單一步驟計畫
      this.plan = [{ id: 1, title: '直接執行', description: goal }];
      this.currentStepIndex = 0;
      return this.plan;
    }
  }

  // ── 取得當前步驟 ──────────────────────────────────────────────────────
  getCurrentTask() {
    if (this.currentStepIndex < 0 || this.currentStepIndex >= this.plan.length) {
      return null;
    }
    return this.plan[this.currentStepIndex];
  }

  // ── 完成步驟並決定下一步 ───────────────────────────────────────────────
  async nextStep(result) {
    const current = this.getCurrentTask();
    if (current) {
      this.history.push({ 
        step: current, 
        result: typeof result === 'string' ? result.substring(0, 500) : result 
      });
    }

    this.currentStepIndex++;
    
    // 每 3 步做一次「適應性評估」，看是否需要調整計畫
    if (this.currentStepIndex > 0 && this.currentStepIndex % 3 === 0 && !this.isFinished()) {
      await this.reevaluate();
    }

    return this.getCurrentTask();
  }

  // ── 計畫重新評估 (能否達成目標？是否需要修正？) ──────────────────────────
  async reevaluate() {
    this.logger.info('🔍 正在重新評估計畫進度...');
    
    const prompt = `你是一個計畫分析師。目前的目標是「${this.goal}」。
已完成的步驟：
${this.history.map(h => `- ${h.step.title}: ${JSON.stringify(h.result)}`).join('\n')}

剩餘計畫：
${this.plan.slice(this.currentStepIndex).map(s => `- ${s.title}: ${s.description}`).join('\n')}

請問計畫是否仍有效？
1. 若有效，請回覆 "KEEP"。
2. 若需要新增、刪除或修改步驟，請回覆全新的 JSON 計畫陣列（包含剩餘的步驟和新步驟）。

輸出必須是 "KEEP" 或 純 JSON 陣列。`;

    try {
      const route = await this.brain.router.route(prompt);
      const resp = route.response.trim();

      if (resp !== 'KEEP') {
        const cleanJson = resp.replace(/```json|```/g, '').trim();
        const newPlanSteps = JSON.parse(cleanJson);
        if (Array.isArray(newPlanSteps)) {
          // 保留已完成的歷史，替換剩餘部分
          this.plan = [
            ...this.plan.slice(0, this.currentStepIndex),
            ...newPlanSteps
          ];
          this.logger.info('🔄 計畫已根據進度進行調整');
        }
      }
    } catch (e) {
      this.logger.warn(`重新評估失敗 (跳過): ${e.message}`);
    }
  }

  isFinished() {
    return this.currentStepIndex >= this.plan.length;
  }

  getExecutionSummary() {
    return {
      goal: this.goal,
      totalSteps: this.plan.length,
      completedSteps: this.currentStepIndex,
      isFinished: this.isFinished(),
      progress: `${Math.round((this.currentStepIndex / this.plan.length) * 100)}%`
    };
  }
}
