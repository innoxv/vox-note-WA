const { Twilio } = require('twilio');

class WhatsAppBotNatural {
  constructor(safetyManager) {
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
      NumMedia: numMedia,
      MessageSid: messageId
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
      console.error('Processing error:', error);
      await this.sendMessage(from, 'Sorry, I encountered an error. Please try again.');
    }
  }

  async handleTextMessage(from, message, session) {
    const normalized = message.toLowerCase().trim();
    
    // ============ GREETINGS ============
    if (this.isGreeting(normalized)) {
      return this.handleGreeting(from, session);
    }
    
    // ============ HELP REQUESTS ============
    if (this.isHelpRequest(normalized)) {
      return this.handleHelp(from);
    }
    
    // ============ SESSION STATES ============
    if (session.expecting === 'add_question') {
      return this.handleAddQuestion(from, message, session);
    }
    
    if (session.expecting === 'add_answer') {
      return this.handleAddAnswer(from, message, session);
    }
    
    if (session.expecting === 'search_query') {
      return this.handleSearch(from, message, session);
    }
    
    if (session.waitingForDocumentQuestion) {
      return this.handleDocumentQuestion(from, message, session);
    }
    
    // ============ NATURAL COMMANDS ============
    if (this.isNaturalCommand(normalized)) {
      return this.handleNaturalCommand(from, normalized, session);
    }
    
    // ============ DEFAULT: AI RESPONSE ============
    return this.handleAIResponse(from, message, session);
  }

  // ============ COMMAND DETECTORS ============
  isGreeting(message) {
    const greetings = ['hi', 'hello', 'hey', 'hola', 'good morning', 'good afternoon', 'good evening', 'gm', 'gn'];
    return greetings.some(greet => message.includes(greet));
  }

  isHelpRequest(message) {
    const helpKeywords = ['help', 'what can you do', 'commands', 'menu', 'options', 'features'];
    return helpKeywords.some(keyword => message.includes(keyword));
  }

  isNaturalCommand(message) {
    const commands = {
      // AI Mode
      'use ai': 'ai_on',
      'ai mode': 'ai_on', 
      'turn on ai': 'ai_on',
      'enable ai': 'ai_on',
      
      // KB Mode
      'use knowledge': 'ai_off',
      'kb mode': 'ai_off',
      'knowledge mode': 'ai_off',
      'turn off ai': 'ai_off',
      
      // Teach me
      'teach': 'teach',
      'add knowledge': 'teach',
      'remember this': 'teach',
      'learn something': 'teach',
      
      // Search
      'search for': 'search',
      'find': 'search',
      'look up': 'search',
      
      // Stats
      'stats': 'stats',
      'statistics': 'stats',
      'how many': 'stats',
      'status': 'stats',
      
      // FAQ
      'faq': 'faq',
      'frequently asked': 'faq',
      'questions': 'faq',
      
      // Mode status
      'what mode': 'mode_status',
      'current mode': 'mode_status',
      
      // Document actions (after upload)
      'summarize': 'summarize',
      'summary': 'summarize',
      'save document': 'save_doc',
      'save this': 'save_doc',
      'extract': 'extract',
      'key points': 'extract'
    };
    
    for (const [keyword, command] of Object.entries(commands)) {
      if (message.includes(keyword)) {
        return command;
      }
    }
    
    return null;
  }

  // ============ COMMAND HANDLERS ============
  async handleGreeting(from, session) {
    const stats = await this.ai.getKnowledgeStats();
    const mode = session.voiceAIMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
    
    return {
      text: `👋 Hello! I'm your AI assistant.\n\n` +
            `📊 I have ${stats} pieces of knowledge.\n` +
            `🔧 Current: ${mode}\n\n` +
            `💬 *Just ask me anything!*\n\n` +
            `Need help? Type "help" or "what can you do"`
    };
  }

  async handleHelp(from) {
    return {
      text: `🤖 *Here's what I can do:*\n\n` +
            `💬 *Ask questions* - Just type your question\n\n` +
            `📚 *Teach me* - Say "teach" or "add knowledge"\n\n` +
            `🔍 *Search* - Say "search for [topic]"\n\n` +
            `🤖 *Switch modes* - Say "use AI" or "use knowledge"\n\n` +
            `📄 *Upload documents* - Send PDF/TXT files\n\n` +
            `📊 *See stats* - Say "stats" or "status"\n\n` +
            `❓ *FAQs* - Say "faq" or "questions"\n\n` +
            `🎤 *Voice messages* - Coming soon!\n\n` +
            `👉 *Just start chatting naturally!*`
    };
  }

  async handleNaturalCommand(from, command, session) {
    switch (command) {
      case 'ai_on':
        session.voiceAIMode = true;
        session.textAIMode = true;
        this.updateSession(from, session);
        return { text: '✅ Switched to *AI Mode*. I\'ll use AI for all responses.' };
        
      case 'ai_off':
        session.voiceAIMode = false;
        session.textAIMode = false;
        this.updateSession(from, session);
        return { text: '✅ Switched to *Knowledge Mode*. I\'ll use my knowledge base first.' };
        
      case 'teach':
        session.expecting = 'add_question';
        this.updateSession(from, session);
        return { text: '📚 Great! What question should I learn?\n\nExample: "What is artificial intelligence?"' };
        
      case 'search':
        session.expecting = 'search_query';
        this.updateSession(from, session);
        return { text: '🔍 What would you like me to search for?\n\nExample: "password reset"' };
        
      case 'stats':
        const stats = await this.ai.getKnowledgeStats();
        const mode = session.voiceAIMode ? 'AI Mode' : 'Knowledge Mode';
        return {
          text: `📊 *Bot Statistics*\n\n` +
                `• Knowledge items: ${stats}\n` +
                `• Current mode: ${mode}\n` +
                `• AI available: ${process.env.GROQ_API_KEY ? 'Yes ✅' : 'No'}\n` +
                `• Voice support: Coming soon!\n` +
                `• Session active: ${this.sessions.size} users`
        };
        
      case 'faq':
        const count = await this.ai.getKnowledgeStats();
        return {
          text: `❓ *Frequently Asked Questions*\n\n` +
                `I have ${count} knowledge items.\n\n` +
                `To search, say: "search for [topic]"\n\n` +
                `To add knowledge, say: "teach"\n\n` +
                `Or just ask me anything!`
        };
        
      case 'mode_status':
        const currentMode = session.voiceAIMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
        return { text: `Current mode: ${currentMode}\n\nSay "use AI" or "use knowledge" to switch.` };
        
      default:
        return { text: `I'm not sure what you mean by "${command}". Try saying "help" to see what I can do.` };
    }
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
    
    if (!question || !answer) {
      delete session.expecting;
      delete session.pendingQuestion;
      this.updateSession(from, session);
      return { text: 'Something went wrong. Please try saying "teach" again.' };
    }
    
    try {
      const result = await this.ai.addKnowledge(question, answer);
      delete session.expecting;
      delete session.pendingQuestion;
      this.updateSession(from, session);
      
      return {
        text: `✅ Successfully learned!\n\n` +
              `*Question:* ${question}\n` +
              `*Answer:* ${answer.substring(0, 100)}${answer.length > 100 ? '...' : ''}\n\n` +
              `You can now ask me about "${question.split(' ')[0]}..."`
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
        text: `🔍 *Found in knowledge:*\n\n${result.answer}\n\n` +
              `Want to know more? Just ask!`
      };
    } else {
      return {
        text: `🔍 No exact match found for "${query}".\n\n` +
              `I can try with AI if you'd like. Just ask your question again!`
      };
    }
  }

  async handleAIResponse(from, message, session) {
    const useAI = session.voiceAIMode || false;
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
        text: "🎤 I received your voice message! Voice processing is coming soon. For now, please type your message or send a document."
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
                `💡 *Now you can:*\n` +
                `• Ask questions about it\n` +
                `• Say "summarize" for a summary\n` +
                `• Say "extract" for key points\n` +
                `• Say "save document" to add to knowledge\n\n` +
                `Just type your question!`
        };
      } catch (error) {
        return { text: `❌ Error: ${error.message}` };
      }
    } else {
      return {
        text: `📎 I received your ${mediaType.split('/')[1]} file.\n\n` +
              `I currently support:\n` +
              `• PDF documents\n` +
              `• Text files (.txt)\n` +
              `• Voice messages (coming soon)\n\n` +
              `Try sending a PDF or text file!`
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
    
    await this.sendMessage(from, '🤔 Thinking about your question...');
    
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
        voiceAIMode: false,
        textAIMode: false,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
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
    console.log(`📊 Message ${MessageSid.substring(0, 8)}: ${MessageStatus}`);
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