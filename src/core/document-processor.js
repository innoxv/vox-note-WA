const { PdfReader } = require("pdfreader");
const axios = require('axios');

class DocumentProcessor {
  constructor() {
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE_MB) * 1024 * 1024 || 10 * 1024 * 1024;
  }

  async extractTextFromPDF(buffer) {
    return new Promise((resolve, reject) => {
      const textByPage = {};
      let pageCount = 0;
      let fullText = '';
      
      const reader = new PdfReader();
      
      reader.parseBuffer(buffer, (err, item) => {
        if (err) {
          reject(new Error(`PDF parsing error: ${err.message}`));
        } else if (!item) {
          const pages = Object.keys(textByPage).sort((a, b) => parseInt(a) - parseInt(b));
          pages.forEach(pageNum => {
            fullText += `Page ${pageNum}: ${textByPage[pageNum]}\n\n`;
          });
          
          resolve({
            text: fullText.trim(),
            numPages: pageCount
          });
        } else if (item.page) {
          pageCount = Math.max(pageCount, item.page);
          
          if (!textByPage[item.page]) {
            textByPage[item.page] = '';
          }
          
          if (item.text) {
            textByPage[item.page] += item.text + ' ';
          }
        }
      });
    });
  }

  async processDocument(url, fileType, fileName = 'document') {
    try {
      // Download file
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: this.maxFileSize
      });
      
      const buffer = Buffer.from(response.data);
      
      // Check file size
      if (buffer.length > this.maxFileSize) {
        throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Maximum: ${this.maxFileSize / 1024 / 1024}MB`);
      }
      
      let extractedText = '';
      let documentInfo = {};
      
      if (fileType === 'pdf') {
        const pdfData = await this.extractTextFromPDF(buffer);
        extractedText = pdfData.text;
        documentInfo.numPages = pdfData.numPages;
      } else if (fileType === 'txt') {
        extractedText = buffer.toString('utf-8');
      } else {
        throw new Error(`Unsupported file type: ${fileType}. I support PDF and TXT files.`);
      }
      
      // Clean and truncate text
      const cleanedText = extractedText
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000); // Limit for processing
      
      return {
        text: cleanedText,
        originalLength: extractedText.length,
        info: documentInfo,
        wasTruncated: cleanedText.length < extractedText.length
      };
    } catch (error) {
      console.error('Document processing error:', error.message);
      throw error;
    }
  }

  async downloadDocument(url) {
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      console.error('Document download error:', error.message);
      throw error;
    }
  }
}

module.exports = DocumentProcessor;