require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import core modules
const WhatsAppBot = require('./src/platforms/whatsapp-bot');
const SafetyManager = require('./src/core/safety-manager');

// Initialize
const app = express();
const PORT = process.env.PORT || 3000;
const safetyManager = new SafetyManager();

// Ensure directories exist
const mediaDir = path.join(__dirname, 'public/media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' }));
app.use('/media', express.static(path.join(__dirname, 'public/media')));

// Health check
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>VoxNote WA - WhatsApp AI Assistant</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
        .healthy { background: #d4edda; color: #155724; }
        .warning { background: #fff3cd; color: #856404; }
        .card { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px; }
      </style>
    </head>
    <body>
      <h1>🤖 VoxNote WA - WhatsApp AI Assistant</h1>
      
      <div class="card">
        <h2>📊 System Status</h2>
        <div class="status healthy">✅ Server is running</div>
        <div class="status healthy">✅ WhatsApp Webhook: Active</div>
        <div class="status ${process.env.GROQ_API_KEY ? 'healthy' : 'warning'}">
          ${process.env.GROQ_API_KEY ? '✅' : '⚠️'} Groq AI: ${process.env.GROQ_API_KEY ? 'Configured' : 'Not configured'}
        </div>
        <div class="status ${process.env.SUPABASE_URL ? 'healthy' : 'warning'}">
          ${process.env.SUPABASE_URL ? '✅' : '⚠️'} Supabase: ${process.env.SUPABASE_URL ? 'Connected' : 'Not connected'}
        </div>
      </div>
      
      <div class="card">
        <h2>🔗 Endpoints</h2>
        <ul>
          <li><a href="/health">Health Check</a> - JSON status</li>
          <li><a href="/whatsapp-webhook">WhatsApp Webhook</a> - POST only</li>
          <li><a href="/whatsapp-status">Status Callback</a> - POST only</li>
        </ul>
      </div>
      
      <div class="card">
        <h2>📱 WhatsApp Setup</h2>
        <p>Webhook URL: <code>${process.env.BASE_URL}/whatsapp-webhook</code></p>
        <p>Status URL: <code>${process.env.BASE_URL}/whatsapp-status</code></p>
        <p><strong>Configure in Twilio Console:</strong></p>
        <ol>
          <li>Go to Messaging → Try it out → Send WhatsApp message</li>
          <li>Set "When a message comes in" to above webhook URL</li>
          <li>Set "Status callback URL" to above status URL</li>
          <li>Save and send a test message!</li>
        </ol>
      </div>
    </body>
    </html>
  `);
});

// Health endpoint
app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    service: 'vox-note-wa',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
    },
    safety: {
      activeRequests: safetyManager.activeRequests,
      queueSize: safetyManager.queue.length
    },
    services: {
      twilio: !!process.env.TWILIO_ACCOUNT_SID,
      groq: !!process.env.GROQ_API_KEY,
      supabase: !!process.env.SUPABASE_URL
    }
  });
});

// Initialize WhatsApp bot
const whatsappBot = new WhatsAppBot(safetyManager);

// Setup webhooks
whatsappBot.setupWebhook(app, '/whatsapp-webhook', '/whatsapp-status');

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ============================================
  🚀 VoxNote WA WhatsApp Bot Started!
  ============================================
  Port: ${PORT}
  Mode: ${process.env.NODE_ENV || 'development'}
  
  📱 WhatsApp Webhooks:
  - Messages: ${process.env.BASE_URL || `http://localhost:${PORT}`}/whatsapp-webhook
  - Status: ${process.env.BASE_URL || `http://localhost:${PORT}`}/whatsapp-status
  
  🔗 Health Check: ${process.env.BASE_URL || `http://localhost:${PORT}`}/health
  
  💡 Next Steps:
  1. Configure webhooks in Twilio Console
  2. Send "hello" to your WhatsApp sandbox
  3. Check logs for incoming messages
  ============================================
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  safetyManager.initiateShutdown();
  setTimeout(() => {
    console.log('Force shutdown');
    process.exit(0);
  }, 5000);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  safetyManager.initiateShutdown();
  setTimeout(() => process.exit(0), 3000);
});