const { createClient } = require('@supabase/supabase-js');

class KnowledgeBase {
  constructor() {
    this.supabase = null;
    this.isAvailable = false;
    
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        this.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
        this.isAvailable = true;
        console.log('✅ Supabase knowledge base connected');
      } catch (error) {
        console.warn('❌ Supabase connection failed:', error.message);
      }
    } else {
      console.log('ℹ️  Supabase not configured - knowledge base disabled');
    }
  }

  async search(query, limit = 1) {
    if (!this.isAvailable) return null;
    
    try {
      const q = query.trim().toLowerCase();
      
      // Try exact match first
      let { data, error } = await this.supabase
        .from('knowledge_base')
        .select('question, answer, content')
        .ilike('question', q)
        .limit(limit);
      
      if (error) throw error;
      if (data && data.length > 0) {
        return data[0].answer || data[0].content;
      }
      
      // Try content match
      ({ data, error } = await this.supabase
        .from('knowledge_base')
        .select('answer, content')
        .or(`answer.ilike.%${q}%,content.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(limit));
      
      if (error) throw error;
      if (data && data.length > 0) {
        return data[0].answer || data[0].content;
      }
      
      return null;
    } catch (error) {
      console.error('Knowledge base search error:', error.message);
      return null;
    }
  }

  async addKnowledge(question, answer) {
    if (!this.isAvailable) {
      throw new Error('Knowledge base not available');
    }
    
    try {
      const { data: existing } = await this.supabase
        .from('knowledge_base')
        .select('id')
        .ilike('question', question)
        .limit(1);
      
      let result;
      if (existing && existing.length > 0) {
        const { error } = await this.supabase
          .from('knowledge_base')
          .update({
            answer,
            content: answer,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing[0].id);
        
        if (error) throw error;
        result = `Updated: "${question}"`;
      } else {
        const { error } = await this.supabase
          .from('knowledge_base')
          .insert([{
            question,
            answer,
            content: answer,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }]);
        
        if (error) throw error;
        result = `Added: "${question}"`;
      }
      
      return { question, answer, result };
    } catch (error) {
      console.error('Add knowledge error:', error);
      throw error;
    }
  }

  async getStats() {
    if (!this.isAvailable) return 0;
    
    try {
      const { count, error } = await this.supabase
        .from('knowledge_base')
        .select('*', { count: 'exact', head: true });
      
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Get stats error:', error);
      return 0;
    }
  }

  async saveMessage(userId, text, source = 'whatsapp', platform = 'whatsapp') {
    if (!this.isAvailable) return;
    
    try {
      await this.supabase
        .from('messages')
        .insert([{
          user_id: userId?.toString?.() || null,
          text,
          source,
          platform,
          created_at: new Date().toISOString()
        }]);
    } catch (error) {
      console.error('Save message error:', error.message);
    }
  }
}

module.exports = KnowledgeBase;