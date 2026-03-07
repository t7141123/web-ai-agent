// core/tools/search-web.js
export default {
  name: 'search_web',
  execute: async (action, { logger }) => {
    const query = action.content;
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
};
