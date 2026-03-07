// core/tools/reflect.js
export default {
  name: 'reflect',
  execute: async (action, { memory }) => {
    const stats = await memory.getStats();
    const recentWork = await memory.getRecentWork(10);

    return {
      success: true,
      stats,
      recentWork,
      output: `🪞 反思完成\n記憶: ${stats.total} 條\n最近工作: ${recentWork.length} 項`
    };
  }
};
