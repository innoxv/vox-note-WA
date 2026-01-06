const { Twilio } = require('twilio');

class WhatsAppBotNatural {
  constructor(safetyManager) {
    console.log('🔧 WhatsApp Bot Constructor');
    console.log('  TWILIO_WHATSAPP_NUMBER:', process.env.TWILIO_WHATSAPP_NUMBER);
    
    this.client = new Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    this.safetyManager = safetyManager;
    this.sessions = new Map();
    
    // Import core modules
    this.AIProcessor = require('../core/ai-processor');
    this.VoiceProcessor = require('../core/voice-processor');
    this.DocumentProcessor = require('../core/document-processor');
    
    // Initialize processors
    this.ai = new this.AIProcessor();
    this.voice = new this.VoiceProcessor();
    this.documents = new this.DocumentProcessor();
    
    console.log('✅ WhatsApp Bot (Natural UX) initialized');
  }

  // Main message handler
  async handleIncoming(req, res) {
    // Immediate response to Twilio
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
    
    // Process asynchronously
    this.safetyManager.processWithTimeout(
      () => this.processMessage(req.body),
      'WhatsApp Message Processing'
    ).catch(error => {
      console.error('Message processing failed:', error.message);
    });
  }

  async processMessage(data) {
    const {
      From: from,
      Body: message,
      MediaUrl0: mediaUrl,
      MediaContentType0: mediaType,
      NumMedia: numMedia
    } = data;

    console.log(`📱 Message from ${from}: "${message?.substring(0, 50) || '(media)'}"`);

    try {
      const session = this.getSession(from);
      
      // Save message to history
      if (message) {
        await this.ai.saveMessage(from, message, 'text');
      }
      
      let response;
      
      // Handle media first
      if (numMedia > 0 && mediaUrl) {
        response = await this.handleMedia(from, mediaUrl, mediaType, session);
      } 
      // Handle text messages
      else if (message) {
        response = await this.handleTextMessage(from, message, session);
      }
      
      // Send response
      if (response) {
        await this.sendMessage(from, response.text, response.media);
      }
    } catch (error) {
      console.error('Processing error:', error.message);
      await this.sendMessage(from, 'Sorry, I encountered an error. Please try again.');
    }
  }

  async handleTextMessage(from, message, session) {
    console.log('📝 Processing text:', message);
    const normalized = message.toLowerCase().trim();
    
    // ============ GREETINGS ============
    if (this.isGreeting(normalized)) {
      console.log('👋 Detected greeting');
      return this.handleGreeting(from, session);
    }
    
    // ============ HELP REQUESTS ============
    if (this.isHelpRequest(normalized)) {
      console.log('❓ Detected help request');
      return this.handleHelp(from);
    }
    
    // ============ MODE COMMANDS (SIMPLIFIED - FIXED) ============
    if (normalized === 'use ai' || normalized === 'ai mode' || 
        normalized === 'turn on ai' || normalized === 'ai on' ||
        normalized === 'enable ai' || normalized === 'switch to ai') {
      console.log('🤖 Switching to AI mode');
      session.voiceAIMode = true;
      session.textAIMode = true;
      this.updateSession(from, session);
      return { text: '✅ Switched to *AI Mode*. I\'ll use AI for all responses.' };
    }
    
    if (normalized === 'use knowledge' || normalized === 'kb mode' || 
        normalized === 'knowledge mode' || normalized === 'turn off ai' ||
        normalized === 'ai off' || normalized === 'use kb') {
      console.log('📚 Switching to KB mode');
      session.voiceAIMode = false;
      session.textAIMode = false;
      this.updateSession(from, session);
      return { text: '✅ Switched to *Knowledge Mode*. I\'ll use my knowledge base first.' };
    }
    
    if (normalized === 'what mode' || normalized === 'current mode' || 
        normalized === 'which mode' || normalized === 'mode?') {
      console.log('🔧 Checking mode');
      const mode = session.voiceAIMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
      return { text: `Current mode: ${mode}\n\nSay "use AI" or "use knowledge" to switch.` };
    }
    
    // ============ SESSION STATES ============
    if (session.expecting === 'add_question') {
      console.log('📝 Processing add question');
      return this.handleAddQuestion(from, message, session);
    }
    
    if (session.expecting === 'add_answer') {
      console.log('📝 Processing add answer');
      return this.handleAddAnswer(from, message, session);
    }
    
    if (session.expecting === 'search_query') {
      console.log('🔍 Processing search');
      return this.handleSearch(from, message, session);
    }
    
    if (session.waitingForDocumentQuestion) {
      console.log('📄 Processing document question');
      return this.handleDocumentQuestion(from, message, session);
    }
    
    // ============ OTHER COMMANDS ============
    if (normalized === 'teach' || normalized === 'add knowledge' || 
        normalized === 'remember this' || normalized === 'learn something') {
      console.log('🎓 Starting teach flow');
      session.expecting = 'add_question';
      this.updateSession(from, session);
      return { text: '📚 Great! What question should I learn?\n\nExample: "What is artificial intelligence?"' };
    }
    
    if (normalized.startsWith('search for ') || normalized.startsWith('find ') || 
        normalized.startsWith('look up ')) {
      console.log('🔍 Starting search');
      const query = normalized.replace(/^(search for|find|look up)\s+/i, '');
      return this.handleSearch(from, query, session);
    }
    
    if (normalized === 'stats' || normalized === 'statistics' || 
        normalized === 'how many' || normalized === 'status') {
      console.log('📊 Getting stats');
      return this.handleStats(from, session);
    }
    
    if (normalized === 'faq' || normalized === 'frequently asked' || 
        normalized === 'questions') {
      console.log('❓ Showing FAQ');
      return this.handleFAQ(from);
    }
    
    // ============ DEFAULT: AI RESPONSE ============
    console.log('💭 Getting AI response');
    return this.handleAIResponse(from, message, session);
  }

  // ============ SIMPLIFIED DETECTORS ============
  isGreeting(message) {
    const greetings = ['hi', 'hello', 'hey', 'hola', 'good morning', 'good afternoon', 'good evening'];
    return greetings.some(greet => message.includes(greet));
  }

  isHelpRequest(message) {
    const helpKeywords = ['help', 'what can you do', 'commands', 'menu', 'options'];
    return helpKeywords.some(keyword => message.includes(keyword));
  }

  // ============ COMMAND HANDLERS ============
  async handleGreeting(from, session) {
    const mode = session.voiceAIMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
    
    return {
      text: `👋 Hello! I'm your AI assistant.\n\n` +
            `🔧 Current: ${mode}\n\n` +
            `💬 *Just ask me anything!*\n\n` +
            `To switch modes:\n` +
            `• Say "use AI" for AI mode\n` +
            `• Say "use knowledge" for knowledge mode\n\n` +
            `Need help? Type "help"`
    };
  }

  async handleHelp(from) {
    return {
      text: `🤖 *Here's what I can do:*\n\n` +
            `💬 *Ask questions* - Just type your question\n\n` +
            `🤖 *Switch to AI mode* - Say "use AI"\n\n` +
            `📚 *Switch to knowledge mode* - Say "use knowledge"\n\n` +
            `🎓 *Teach me* - Say "teach"\n\n` +
            `🔍 *Search* - Say "search for [topic]"\n\n` +
            `📄 *Upload documents* - Send PDF/TXT files\n\n` +
            `📊 *See stats* - Say "stats"\n\n` +
            `❓ *FAQs* - Say "faq"\n\n` +
            `👉 *Just start chatting!*`
    };
  }

  async handleStats(from, session) {
    const stats = await this.ai.getKnowledgeStats();
    const mode = session.voiceAIMode ? 'AI Mode' : 'Knowledge Mode';
    
    return {
      text: `📊 *Bot Statistics*\n\n` +
            `• Knowledge items: ${stats}\n` +
            `• Current mode: ${mode}\n` +
            `• AI available: ${process.env.GROQ_API_KEY ? 'Yes ✅' : 'No'}\n` +
            `• Voice support: Coming soon!\n` +
            `• Active chats: ${this.sessions.size}`
    };
  }

  async handleFAQ(from) {
    const count = await this.ai.getKnowledgeStats();
    return {
      text: `❓ *Frequently Asked Questions*\n\n` +
            `I have ${count} knowledge items.\n\n` +
            `To search: "search for [topic]"\n\n` +
            `To add: "teach"\n\n` +
            `Or just ask me anything!`
    };
  }

  async handleAddQuestion(from, question, session) {
    session.expecting = 'add_answer';
    session.pendingQuestion = question;
    this.updateSession(from, session);
    
    return {
      text: `📝 Question saved: "${question}"\n\nNow, what's the answer?\n\nExample: "Artificial Intelligence is..."`
    };
  }

  async handleAddAnswer(from, answer, session) {
    const question = session.pendingQuestion;
    
    try {
      const result = await this.ai.addKnowledge(question, answer);
      delete session.expecting;
      delete session.pendingQuestion;
      this.updateSession(from, session);
      
      return {
        text: `✅ Successfully learned!\n\n` +
              `*Question:* ${question}\n` +
              `*Answer:* ${answer.substring(0, 100)}${answer.length > 100 ? '...' : ''}`
      };
    } catch (error) {
      delete session.expecting;
      delete session.pendingQuestion;
      this.updateSession(from, session);
      return { text: `❌ Error: ${error.message}` };
    }
  }

  async handleSearch(from, query, session) {
    delete session.expecting;
    this.updateSession(from, session);
    
    const result = await this.ai.getAnswer(query, false);
    
    if (result.source === 'knowledge_base') {
      return {
        text: `🔍 *Found in knowledge:*\n\n${result.answer}`
      };
    } else {
      return {
        text: `🔍 No exact match found for "${query}".\n\n` +
              `Try asking in AI mode by saying "use AI" first.`
      };
    }
  }

  async handleAIResponse(from, message, session) {
    const useAI = session.voiceAIMode || false;
    console.log(`💭 Getting answer (AI mode: ${useAI})`);
    
    const result = await this.ai.getAnswer(message, useAI);
    
    let responseText = result.answer;
    
    // Add source indicator
    const sourceEmoji = result.source === 'knowledge_base' ? '📚' : 
                       result.source === 'groq_ai' ? '🤖' : '💡';
    
    responseText = `${sourceEmoji} ${responseText}`;
    
    // Try to generate voice response
    let voiceMedia = null;
    try {
      const voiceBuffer = await this.voice.textToSpeech(result.answer);
      const filename = `response-${Date.now()}.mp3`;
      const publicUrl = await this.voice.saveAudioToFile(voiceBuffer, filename);
      voiceMedia = publicUrl;
    } catch (err) {
      console.log('Voice generation skipped:', err.message);
    }
    
    return {
      text: responseText,
      media: voiceMedia ? [{ url: `${process.env.BASE_URL}${voiceMedia}`, type: 'audio/mpeg' }] : null
    };
  }

  async handleMedia(from, mediaUrl, mediaType, session) {
    console.log(`Processing ${mediaType} media...`);
    
    if (mediaType.includes('audio')) {
      return {
        text: "🎤 Voice message received! Voice processing coming soon."
      };
    } else if (mediaType.includes('pdf') || mediaType === 'text/plain') {
      const fileType = mediaType.includes('pdf') ? 'PDF' : 'text';
      
      await this.sendMessage(from, `📄 Processing ${fileType} document...`);
      
      try {
        const docInfo = await this.documents.processDocument(
          mediaUrl, 
          mediaType.includes('pdf') ? 'pdf' : 'txt',
          `document_${Date.now()}`
        );
        
        // Store in session
        session.documentText = docInfo.text;
        session.waitingForDocumentQuestion = true;
        this.updateSession(from, session);
        
        return {
          text: `✅ Document processed!\n\n` +
                `I've extracted ${docInfo.text.length} characters.\n\n` +
                `💡 Now you can ask questions about it!`
        };
      } catch (error) {
        return { text: `❌ Error: ${error.message}` };
      }
    } else {
      return {
        text: `📎 I received your ${mediaType.split('/')[1]} file.\n\n` +
              `I support PDF and text files.`
      };
    }
  }

  async handleDocumentQuestion(from, question, session) {
    if (!session.documentText) {
      delete session.waitingForDocumentQuestion;
      this.updateSession(from, session);
      return { text: 'Document context lost. Please upload again.' };
    }
    
    const context = session.documentText.substring(0, 3000);
    
    try {
      const answer = await this.ai.queryGroqAI(
        `Document content:\n${context}\n\nQuestion: ${question}\n\nAnswer:`
      );
      
      if (answer) {
        return { text: `📄 *Answer:*\n\n${answer}` };
      } else {
        return { text: 'Could not answer. Try asking differently.' };
      }
    } catch (error) {
      return { text: 'Error answering. Please try again.' };
    }
  }

  // ============ UTILITY METHODS ============
  async sendMessage(to, text, media = null) {
    try {
      const messageData = {
        from: this.whatsappNumber,
        to: to,
        body: text.substring(0, 1600)
      };
      
      if (media && media.length > 0 && media[0].url) {
        messageData.mediaUrl = media[0].url;
      }
      
      const message = await this.client.messages.create(messageData);
      console.log(`📤 Sent to ${to.substring(0, 15)}...`);
      return message;
    } catch (error) {
      console.error('Send error:', error.message);
      throw error;
    }
  }

  getSession(userId) {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        voiceAIMode: false,  // Default: Knowledge mode
        textAIMode: false,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      console.log(`👤 New session for ${userId.substring(0, 15)}...`);
    }
    
    const session = this.sessions.get(userId);
    session.lastActivity = Date.now();
    return session;
  }

  updateSession(userId, session) {
    session.lastActivity = Date.now();
    this.sessions.set(userId, session);
  }

  handleStatusCallback(req, res) {
    const { MessageSid, MessageStatus } = req.body;
    console.log(`📊 Message ${MessageSid?.substring(0, 8)}: ${MessageStatus}`);
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
  }

  setupWebhook(app, webhookPath = '/whatsapp-webhook', statusPath = '/whatsapp-status') {
    app.post(webhookPath, (req, res) => this.handleIncoming(req, res));
    app.post(statusPath, (req, res) => this.handleStatusCallback(req, res));
    console.log(`✅ WhatsApp webhooks configured`);
  }
}

module.exports = WhatsAppBotNatural;