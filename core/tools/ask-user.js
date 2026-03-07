// core/tools/ask-user.js
export default {
  name: 'ask_user',
  execute: async (action) => {
    return {
      success: true,
      needsInput: true,
      question: action.content,
      output: action.content
    };
  }
};
