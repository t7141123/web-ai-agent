// core/tools/speak.js
export default {
  name: 'speak',
  execute: async (action) => {
    return { success: true, output: action.content };
  }
};
