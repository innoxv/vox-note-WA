const { Twilio } = require('twilio');

class WhatsAppBotNatural {
  constructor(safetyManager) {
    console.log('🔧 WhatsApp Bot Constructor');
    
    this.client = new Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    this.safetyManager = safetyManager;
    this.sessions = new Map();
    
    // Import processors (keep document, skip voice)
    this.AIProcessor = require('../core/ai-processor');
    this.DocumentProcessor = require('../core/document-processor');
    
    // Initialize
    this.ai = new this.AIProcessor();
    this.documents = new this.DocumentProcessor();
    
    console.log('✅ WhatsApp Bot initialized');
    console.log('✅ PDF/TXT document processing enabled');
    console.log('🔇 Voice processing disabled');
  }

  async handleIncoming(req, res) {
    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');
    
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

    console.log(`📱 Message from ${from}: "${message?.substring(0, 100) || '(media)'}"`);

    try {
      const session = this.getSession(from);
      
      // Save message
      if (message) {
        await this.ai.saveMessage(from, message, 'text');
      }
      
      let response;
      
      // Handle media (PDF/TXT only, no voice)
      if (numMedia > 0 && mediaUrl && mediaType) {
        response = await this.handleMedia(from, mediaUrl, mediaType, session);
      } 
      // Handle text messages
      else if (message) {
        response = await this.handleTextMessage(from, message.trim(), session);
      }
      
      // Send response
      if (response) {
        await this.sendMessage(from, response.text);
      }
    } catch (error) {
      console.error('Processing error:', error.message);
      await this.sendMessage(from, 'Sorry, I encountered an error. Please try again.');
    }
  }

  async handleTextMessage(from, message, session) {
    console.log('📝 Processing text:', message);
    const normalized = message.toLowerCase().trim();
    
    // ============ MODE SWITCHING ============
    if (normalized === 'use ai') {
      console.log('🤖 Switching to AI mode');
      session.aiMode = true;
      this.updateSession(from, session);
      return { text: '✅ Switched to *AI Mode*.\n\nAll questions will now use Groq AI.' };
    }
    
    if (normalized === 'use knowledge') {
      console.log('📚 Switching to KB mode');
      session.aiMode = false;
      this.updateSession(from, session);
      return { text: '✅ Switched to *Knowledge Mode*.\n\nUsing Supabase knowledge base first.' };
    }
    
    if (normalized === 'what mode') {
      console.log('🔧 Checking mode');
      const mode = session.aiMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
      const aiStatus = process.env.GROQ_API_KEY ? 'Available ✅' : 'Not configured';
      const kbStatus = process.env.SUPABASE_URL ? 'Available ✅' : 'Not configured';
      return { 
        text: `Current mode: ${mode}\n\n` +
              `AI Status: ${aiStatus}\n` +
              `Knowledge Base: ${kbStatus}\n\n` +
              `Say "use AI" or "use knowledge" to switch.` 
      };
    }
    
    // ============ GREETINGS ============
    if (this.isGreeting(normalized)) {
      console.log('👋 Detected greeting');
      return this.handleGreeting(from, session);
    }
    
    // ============ HELP ============
    if (this.isHelpRequest(normalized)) {
      console.log('❓ Detected help request');
      return this.handleHelp(from, session);
    }
    
    // ============ TEACH COMMAND ============
    if (normalized === 'teach' || normalized === 'add knowledge') {
      console.log('🎓 Starting teach flow');
      session.expecting = 'add_question';
      this.updateSession(from, session);
      return { text: '📚 Great! What question should I learn?\n\nExample: "What is the return policy?"' };
    }
    
    // ============ ADD QUESTION FLOW ============
    if (session.expecting === 'add_question') {
      console.log('📝 Processing add question');
      return this.handleAddQuestion(from, message, session);
    }
    
    if (session.expecting === 'add_answer') {
      console.log('📝 Processing add answer');
      return this.handleAddAnswer(from, message, session);
    }
    
    // ============ DOCUMENT ACTIONS ============
    if (session.documentText) {
      if (normalized === 'summarize' || normalized === 'summary') {
        return this.handleDocumentSummary(from, session);
      }
      if (normalized === 'save document' || normalized === 'save this') {
        return this.handleSaveDocument(from, session);
      }
      if (normalized === 'extract' || normalized === 'key points') {
        return this.handleExtractInfo(from, session);
      }
    }
    
    // ============ DOCUMENT QUESTION ============
    if (session.waitingForDocumentQuestion) {
      console.log('📄 Processing document question');
      return this.handleDocumentQuestion(from, message, session);
    }
    
    // ============ STATS ============
    if (normalized === 'stats' || normalized === 'statistics') {
      console.log('📊 Getting stats');
      return this.handleStats(from, session);
    }
    
    // ============ DEFAULT: GET ANSWER ============
    console.log(`💭 Getting answer (AI mode: ${session.aiMode})`);
    return this.handleAIResponse(from, message, session);
  }

  // ============ SIMPLE DETECTORS ============
  isGreeting(message) {
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    return greetings.some(greet => message.includes(greet));
  }

  isHelpRequest(message) {
    const helpKeywords = ['help', 'what can you do', 'commands', 'menu', 'options'];
    return helpKeywords.some(keyword => message.includes(keyword));
  }

  // ============ COMMAND HANDLERS ============
  async handleGreeting(from, session) {
    const mode = session.aiMode ? '🤖 AI Mode' : '📚 Knowledge Mode';
    const totalKnowledge = await this.ai.getKnowledgeStats();
    
    return {
      text: `👋 Hello! I'm your AI assistant.\n\n` +
            `🔧 Current: ${mode}\n` +
            `📚 Knowledge: ${totalKnowledge} items\n` +
            `📄 Documents: PDF/TXT support ✅\n` +
            `🔇 Voice: Disabled\n\n` +
            `💬 *Just ask me anything!*\n\n` +
            `To switch modes:\n` +
            `• Say "use AI" for AI mode\n` +
            `• Say "use knowledge" for knowledge mode\n\n` +
            `Need help? Type "help"`
    };
  }

  async handleHelp(from, session) {
    const mode = session.aiMode ? 'AI' : 'Knowledge';
    const aiStatus = process.env.GROQ_API_KEY ? 'Available' : 'Not configured';
    const kbStatus = process.env.SUPABASE_URL ? 'Available' : 'Not configured';
    
    return {
      text: `🤖 *Available Commands:*\n\n` +
            `💬 Ask any question\n\n` +
            `🔧 *Modes:*\n` +
            `• "use AI" - Enable AI responses (Status: ${aiStatus})\n` +
            `• "use knowledge" - Use knowledge base (Status: ${kbStatus})\n` +
            `• "what mode" - Check current mode\n\n` +
            `🎓 *Learning:*\n` +
            `• "teach" - Teach me something new\n\n` +
            `📄 *Documents:*\n` +
            `• Send PDF/TXT files to upload\n` +
            `• Then ask questions about them\n` +
            `• Say "summarize" for document summary\n\n` +
            `📊 *Info:*\n` +
            `• "stats" - See statistics\n\n` +
            `👉 Just start chatting or send a document!`
    };
  }

  async handleAddQuestion(from, question, session) {
    session.expecting = 'add_answer';
    session.pendingQuestion = question;
    this.updateSession(from, session);
    
    return {
      text: `📝 Question: "${question}"\n\nNow, what's the answer?`
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
              `*Q:* ${question}\n` +
              `*A:* ${answer.substring(0, 200)}${answer.length > 200 ? '...' : ''}\n\n` +
              `You can now ask about "${question.split(' ')[0]}..."`
      };
    } catch (error) {
      delete session.expecting;
      delete session.pendingQuestion;
      this.updateSession(from, session);
      return { text: `❌ Error: ${error.message}` };
    }
  }

  async handleStats(from, session) {
    const totalKnowledge = await this.ai.getKnowledgeStats();
    const mode = session.aiMode ? 'AI Mode' : 'Knowledge Mode';
    const aiStatus = process.env.GROQ_API_KEY ? 'Available ✅' : 'Not configured';
    const kbStatus = process.env.SUPABASE_URL ? 'Available ✅' : 'Not configured';
    const activeSessions = this.sessions.size;
    
    return {
      text: `📊 *Bot Statistics*\n\n` +
            `• Knowledge items: ${totalKnowledge}\n` +
            `• Current mode: ${mode}\n` +
            `• AI Status: ${aiStatus}\n` +
            `• Knowledge Base: ${kbStatus}\n` +
            `• Active chats: ${activeSessions}\n` +
            `• Document support: PDF/TXT ✅\n` +
            `• Voice support: Disabled`
    };
  }

  async handleAIResponse(from, message, session) {
    try {
      const useAI = session.aiMode || false;
      const result = await this.ai.getAnswer(message, useAI);
      
      let responseText = result.answer;
      
      // Add source indicator
      const sourceEmoji = result.source === 'knowledge_base' ? '📚' : 
                         result.source === 'groq_ai' ? '🤖' : '💡';
      
      responseText = `${sourceEmoji} ${responseText}`;
      
      return { text: responseText };
      
    } catch (error) {
      console.error('AI response error:', error);
      return {
        text: `Sorry, I encountered an error: ${error.message}\n\nTry asking again or switch modes.`
      };
    }
  }

  // ============ MEDIA HANDLING (PDF/TXT ONLY) ============
  async handleMedia(from, mediaUrl, mediaType, session) {
    console.log(`📄 Processing ${mediaType} media...`);
    
    // Check if it's a supported document type
    if (mediaType.includes('audio')) {
      return {
        text: `🎤 Voice message received.\n\n` +
              `Voice processing is currently disabled.\n` +
              `Please send text messages or PDF/TXT documents instead.\n\n` +
              `Say "help" to see what I can do.`
      };
    }
    
    if (mediaType.includes('pdf') || mediaType === 'text/plain') {
      const fileType = mediaType.includes('pdf') ? 'PDF' : 'TXT';
      
      await this.sendMessage(from, `📄 Processing ${fileType} document...`);
      
      try {
        const docInfo = await this.documents.processDocument(
          mediaUrl, 
          mediaType.includes('pdf') ? 'pdf' : 'txt',
          `document_${Date.now()}.${fileType.toLowerCase()}`
        );
        
        // Store document in session
        session.documentText = docInfo.text;
        session.documentInfo = docInfo.info;
        session.waitingForDocumentQuestion = true;
        this.updateSession(from, session);
        
        return {
          text: `✅ Document processed successfully!\n\n` +
                `📊 Extracted ${docInfo.text.length} characters` +
                (docInfo.info.numPages ? ` from ${docInfo.info.numPages} pages` : '') +
                (docInfo.wasTruncated ? ' (truncated for processing)' : '') +
                `\n\n💡 *Now you can:*\n` +
                `• Ask questions about the document\n` +
                `• Say "summarize" for a summary\n` +
                `• Say "extract" for key points\n` +
                `• Say "save document" to add to knowledge\n\n` +
                `Just type your question about the document!`
        };
      } catch (error) {
        console.error('Document processing error:', error);
        return { 
          text: `❌ Error processing document:\n${error.message}\n\n` +
                `Please ensure it's a valid PDF or text file and try again.`
        };
      }
    } else {
      return {
        text: `📎 I received a ${mediaType.split('/')[1]} file.\n\n` +
              `I currently support:\n` +
              `• PDF documents\n` +
              `• Text files (.txt)\n\n` +
              `Voice messages are currently disabled.\n\n` +
              `Try sending a PDF or text file instead!`
      };
    }
  }

  async handleDocumentQuestion(from, question, session) {
    if (!session.documentText) {
      delete session.waitingForDocumentQuestion;
      this.updateSession(from, session);
      return { text: 'Document context lost. Please upload the document again.' };
    }
    
    const context = session.documentText.substring(0, 3000);
    
    try {
      const answer = await this.ai.queryGroqAI(
        `Based on this document content:\n\n${context}\n\nQuestion: ${question}\n\nAnswer:`
      );
      
      if (answer) {
        return { text: `📄 *Answer:*\n\n${answer}` };
      } else {
        return { text: 'Could not answer question. Try asking differently.' };
      }
    } catch (error) {
      console.error('Document question error:', error);
      return { text: 'Error answering question. Please try again.' };
    }
  }

  async handleDocumentSummary(from, session) {
    if (!session.documentText) {
      return { text: 'No document loaded. Please upload a document first.' };
    }
    
    const context = session.documentText.substring(0, 4000);
    
    try {
      const summary = await this.ai.queryGroqAI(
        `Please summarize the following document content in 3-5 key bullet points:\n\n${context}\n\nSummary:`
      );
      
      if (summary) {
        delete session.waitingForDocumentQuestion;
        this.updateSession(from, session);
        return { text: `📄 *Document Summary:*\n\n${summary}` };
      }
    } catch (error) {
      console.error('Summary error:', error);
    }
    
    return { text: 'Could not generate summary. Try asking a specific question instead.' };
  }

  async handleSaveDocument(from, session) {
    if (!session.documentText) {
      return { text: 'No document to save. Please upload a document first.' };
    }
    
    try {
      const question = `Document content (${session.documentInfo?.numPages || 'unknown'} pages)`;
      const answer = `Document content:\n\n${session.documentText.substring(0, 2000)}${session.documentText.length > 2000 ? '...' : ''}`;
      
      const result = await this.ai.addKnowledge(question, answer);
      
      delete session.documentText;
      delete session.waitingForDocumentQuestion;
      delete session.documentInfo;
      this.updateSession(from, session);
      
      return { text: `✅ Document saved to knowledge base!\n\n${result.result}` };
    } catch (error) {
      console.error('Save document error:', error);
      return { text: `❌ Error saving document: ${error.message}` };
    }
  }

  async handleExtractInfo(from, session) {
    if (!session.documentText) {
      return { text: 'No document loaded. Please upload a document first.' };
    }
    
    const context = session.documentText.substring(0, 4000);
    
    try {
      const keyInfo = await this.ai.queryGroqAI(
        `Extract the most important information from this document:\n\n${context}\n\n` +
        `Provide:\n1. Main topics\n2. Key dates/numbers\n3. Important names\n4. Main conclusions`
      );
      
      if (keyInfo) {
        return { text: `📄 *Key Information:*\n\n${keyInfo}` };
      }
    } catch (error) {
      console.error('Extract info error:', error);
    }
    
    return { text: 'Could not extract information. Try asking specific questions.' };
  }

  // ============ UTILITY METHODS ============
  async sendMessage(to, text) {
    try {
      const messageData = {
        from: this.whatsappNumber,
        to: to,
        body: text.substring(0, 1600)
      };
      
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
        aiMode: false, // Default to knowledge mode
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
      console.log(`👤 New session for ${userId.substring(0, 15)}... (Default: Knowledge mode)`);
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
    console.log(`📊 Status: ${MessageSid?.substring(0, 8)} = ${MessageStatus}`);
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