// core/tools/remember.js
export default {
  name: 'remember',
  execute: async (action, { memory }) => {
    const memoryItem = await memory.store({
      type: action.metadata?.type || 'fact',
      content: action.content,
      importance: action.metadata?.importance || 0.7
    });
    return { success: true, memoryId: memoryItem.id, output: `✅ 已記住: ${action.content}` };
  }
};
