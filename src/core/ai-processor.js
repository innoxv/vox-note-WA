const axios = require('axios');

class AIProcessor {
  constructor() {
    this.groqEnabled = !!process.env.GROQ_API_KEY;
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    
    // Initialize Supabase if available
    this.supabase = null;
    this.supabaseEnabled = false;
    
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        this.supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_ANON_KEY
        );
        this.supabaseEnabled = true;
        console.log('✅ Supabase knowledge base connected');
      } catch (error) {
        console.warn('❌ Supabase connection failed:', error.message);
      }
    } else {
      console.log('ℹ️  Supabase not configured');
    }
    
    if (this.groqEnabled) {
      console.log(`✅ Groq AI enabled (model: ${this.groqModel})`);
    } else {
      console.log('ℹ️  Groq AI disabled - set GROQ_API_KEY to enable');
    }
  }

  async queryGroqAI(question, context = null) {
    if (!this.groqEnabled) return null;
    
    try {
      let messages = [
        { 
          role: 'system', 
          content: 'You are a helpful AI assistant. Provide accurate, concise answers in plain text (no markdown).' 
        }
      ];
      
      if (context) {
        messages.push({
          role: 'system',
          content: `Context: ${context}`
        });
      }
      
      messages.push({ role: 'user', content: question });
      
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: this.groqModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: 800
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      
      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content.trim();
      }
      return null;
    } catch (error) {
      console.error('Groq AI error:', error.message);
      return null;
    }
  }

  async searchKnowledge(query) {
    if (!this.supabaseEnabled) return null;
    
    try {
      const q = query.trim().toLowerCase();
      
      // Try exact match
      let { data, error } = await this.supabase
        .from('knowledge_base')
        .select('question, answer, content')
        .ilike('question', q)
        .limit(1);
      
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
        .limit(1));
      
      if (error) throw error;
      if (data && data.length > 0) {
        return data[0].answer || data[0].content;
      }
      
      return null;
    } catch (error) {
      console.error('Knowledge search error:', error.message);
      return null;
    }
  }

  async getAnswer(query, useAI = false) {
    // Always try knowledge base first (if available)
    if (this.supabaseEnabled) {
      const kbAnswer = await this.searchKnowledge(query);
      if (kbAnswer) {
        return {
          source: 'knowledge_base',
          answer: kbAnswer
        };
      }
    }
    
    // Use AI if requested or if no KB answer
    if (useAI || !this.supabaseEnabled) {
      if (this.groqEnabled) {
        // Get context from knowledge base for AI
        let context = null;
        if (this.supabaseEnabled) {
          const kbResults = await this.searchKnowledge(query);
          if (kbResults) context = kbResults;
        }
        
        const aiAnswer = await this.queryGroqAI(query, context);
        if (aiAnswer) {
          return {
            source: 'groq_ai',
            answer: aiAnswer
          };
        }
      }
    }
    
    // Default response
    return {
      source: 'default',
      answer: this.getDefaultResponse(query, useAI)
    };
  }

  getDefaultResponse(query, useAI) {
    if (useAI && !this.groqEnabled) {
      return 'AI mode is enabled but Groq AI is not configured. Please set GROQ_API_KEY.';
    }
    
    const responses = [
      `I don't have information about "${query}" in my knowledge yet.`,
      `That's interesting! I'm still learning about "${query}".`,
      `Great question! I need to learn more about "${query}".`
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    if (this.supabaseEnabled) {
      return randomResponse + '\n\nYou can teach me by saying "teach"!';
    }
    
    return randomResponse + (this.groqEnabled ? '\n\nTry saying "use AI" to enable AI mode!' : '');
  }

  async addKnowledge(question, answer) {
    if (!this.supabaseEnabled) {
      throw new Error('Knowledge base not available. Supabase is not configured.');
    }
    
    try {
      // Check if question already exists
      const { data: existing } = await this.supabase
        .from('knowledge_base')
        .select('id')
        .ilike('question', question)
        .limit(1);
      
      let result;
      if (existing && existing.length > 0) {
        // Update existing
        const { error } = await this.supabase
          .from('knowledge_base')
          .update({
            answer: answer,
            content: answer,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing[0].id);
        
        if (error) throw error;
        result = `Updated: "${question}"`;
      } else {
        // Insert new
        const { error } = await this.supabase
          .from('knowledge_base')
          .insert([{
            question: question,
            answer: answer,
            content: answer,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }]);
        
        if (error) throw error;
        result = `Added: "${question}"`;
      }
      
      return {
        question: question,
        answer: answer,
        result: result
      };
    } catch (error) {
      console.error('Add knowledge error:', error);
      throw error;
    }
  }

  async getKnowledgeStats() {
    if (!this.supabaseEnabled) return 0;
    
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

  async saveMessage(userId, text, source = 'text') {
    if (!this.supabaseEnabled) return;
    
    try {
      await this.supabase
        .from('messages')
        .insert([{
          user_id: userId?.toString?.() || null,
          text: text,
          source: source,
          platform: 'whatsapp',
          created_at: new Date().toISOString()
        }]);
    } catch (error) {
      console.error('Save message error:', error.message);
    }
  }
}

module.exports = AIProcessor;