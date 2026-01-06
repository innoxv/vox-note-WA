const axios = require('axios');
const KnowledgeBase = require('./knowledge-base');

class AIProcessor {
  constructor() {
    this.knowledgeBase = new KnowledgeBase();
    this.groqEnabled = !!process.env.GROQ_API_KEY;
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    
    if (this.groqEnabled) {
      console.log(`✅ Groq AI enabled (model: ${this.groqModel})`);
    } else {
      console.log('ℹ️  Groq AI disabled - set GROQ_API_KEY to enable');
    }
  }

  async queryGroqAI(question, context = null) {
    if (!this.groqEnabled) return null;
    
    try {
      const systemPrompt = `You are a helpful AI assistant. Provide accurate, concise, and friendly answers.`;
      let fullPrompt = question;
      
      if (context) {
        fullPrompt = `Context: ${context}\n\nQuestion: ${question}\n\nAnswer:`;
      }
      
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: this.groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: fullPrompt }
          ],
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
      console.error('Groq AI request failed:', error.message);
      return null;
    }
  }

  async getAnswer(query, useAI = false) {
    // Always try knowledge base first (if available)
    if (this.knowledgeBase.isAvailable) {
      const kbAnswer = await this.knowledgeBase.search(query);
      if (kbAnswer) {
        return {
          source: 'knowledge_base',
          answer: kbAnswer,
          confidence: 'high'
        };
      }
    }
    
    // Use AI if requested or if no KB answer
    if (useAI || !this.knowledgeBase.isAvailable) {
      if (this.groqEnabled) {
        // Try to get context from knowledge base
        let context = null;
        if (this.knowledgeBase.isAvailable) {
          const kbResults = await this.knowledgeBase.search(query, 3);
          if (kbResults) context = kbResults;
        }
        
        const aiAnswer = await this.queryGroqAI(query, context);
        if (aiAnswer) {
          return {
            source: 'groq_ai',
            answer: aiAnswer,
            confidence: 'medium'
          };
        }
      }
    }
    
    // Default response
    return {
      source: 'default',
      answer: this.getDefaultResponse(query),
      confidence: 'low'
    };
  }

  getDefaultResponse(query) {
    const responses = [
      `I'm still learning about "${query}". Would you like to teach me? Use: /add "question" || "answer"`,
      `That's interesting! I don't have information about "${query}" yet. Want to add it to my knowledge?`,
      `I'd love to help with "${query}"! First, I need to learn about it. You can teach me!`,
      `Great question about "${query}"! I need more information on this topic.`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  async addKnowledge(input) {
    return this.knowledgeBase.addKnowledge(input);
  }

  async getKnowledgeStats() {
    return this.knowledgeBase.getStats();
  }

  async saveMessage(userId, text, source = 'text') {
    return this.knowledgeBase.saveMessage(userId, text, source);
  }
}

module.exports = AIProcessor;