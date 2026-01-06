const gTTS = require('gtts');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class VoiceProcessor {
  constructor() {
    this.whisperModel = null;
    this.isModelLoading = false;
    this.modelLoadQueue = [];
  }

  async textToSpeech(text, language = 'en') {
    return new Promise((resolve, reject) => {
      try {
        const safeText = text.replace(/\*\*/g, '').replace(/`/g, '').substring(0, 500);
        
        const tts = new gTTS(safeText, language);
        const tempFile = path.join(__dirname, '../../temp', `tts-${Date.now()}.mp3`);
        
        // Ensure temp directory exists
        const tempDir = path.dirname(tempFile);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        tts.save(tempFile, (err) => {
          if (err) return reject(err);
          
          fs.readFile(tempFile, (readErr, data) => {
            // Clean up temp file
            fs.unlink(tempFile, () => {});
            
            if (readErr) return reject(readErr);
            resolve(data);
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async saveAudioToFile(audioBuffer, filename) {
    return new Promise((resolve, reject) => {
      const mediaDir = path.join(__dirname, '../../public/media');
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }
      
      const filepath = path.join(mediaDir, filename);
      
      fs.writeFile(filepath, audioBuffer, (err) => {
        if (err) return reject(err);
        resolve(`/media/${filename}`);
      });
    });
  }

  async downloadAudioFromUrl(url) {
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      console.error('Audio download error:', error.message);
      throw error;
    }
  }

  async convertAudioToText(audioBuffer) {
    // Note: For WhatsApp, voice messages are in .ogg format
    // This requires ffmpeg conversion and Whisper model
    // For now, return a placeholder message
    
    return "Voice message received! I'm working on voice-to-text conversion. For now, please send text messages.";
  }

  async processVoiceMessage(audioUrl) {
    try {
      // Download audio
      const audioBuffer = await this.downloadAudioFromUrl(audioUrl);
      
      // Generate a filename
      const filename = `voice-${Date.now()}.ogg`;
      
      // Save to file
      const publicUrl = await this.saveAudioToFile(audioBuffer, filename);
      
      // Convert to text (simplified for now)
      const text = await this.convertAudioToText(audioBuffer);
      
      return {
        text,
        audioUrl: publicUrl,
        filename
      };
    } catch (error) {
      console.error('Voice processing error:', error);
      throw error;
    }
  }
}

module.exports = VoiceProcessor;