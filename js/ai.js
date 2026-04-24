/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

import { StorageService } from './services/StorageService.js';
import { ModelManager } from './services/ModelManager.js';
import { ROLES } from './services/Constants.js';

export class AIService {
  constructor(eventBus, callbacks = {}) {
    this.eventBus = eventBus;
    this.callbacks = callbacks; // onResponse, onStart, onError
    this.isFreeMode = StorageService.get(StorageService.KEYS.IS_FREE_MODE, true);
    this.conversationHistory = [];
    this.isRunning = false;
    this.responseCache = new Map();
    this.modelManager = new ModelManager();
    this.lastRequestContext = null;

    // Decoupled Control Listeners
    this.eventBus.on('ai:request-suggestion', data => {
      this.generateResponse(data.jobDesc, data.resumeText, data.imageData, data.userPrompt);
    });
    this.eventBus.on('ai:set-mode', data => {
      this.setMode(data.isFree);
    });
    this.eventBus.on('ai:get-last-context', (data) => {
      if (this.lastRequestContext) {
        this.eventBus.emit('ai:context-data', this.lastRequestContext);
      } else {
        // Build a preview context from current history/config
        const jobDesc = data?.jobDesc || StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, '');
        const resumeText = data?.resumeText || StorageService.get(StorageService.KEYS.RESUME_TEXT, '');
        const previewMessages = this.buildPrompt(jobDesc, resumeText);
        this.eventBus.emit('ai:context-data', { 
          model: this.getSelectedModel(), 
          messages: previewMessages,
          _is_preview: true 
        });
      }
    });
    this.eventBus.on('ai:update-history', data => {
      this.updateHistory(data.history);
    });
  }

  setMode(isFree) {
    this.isFreeMode = isFree;
  }

  updateHistory(history) {
    this.conversationHistory = history;
  }

  /**
   * Validates and returns the best available model ID.
   */
  async getValidatedModel() {
    const storedId = this.isFreeMode
      ? StorageService.get(StorageService.KEYS.SELECTED_FREE_MODEL, 'google/gemini-2.0-flash-lite-preview-02-05:free')
      : StorageService.get(StorageService.KEYS.SELECTED_PAID_MODEL, 'google/gemini-2.0-flash-001');
    
    // Fast path: use cache
    if (this.modelManager.hasModel(storedId)) {
      return storedId;
    }

    // Fallback path: fetch if missing
    await this.modelManager.fetchModels();
    if (this.modelManager.hasModel(storedId)) {
      return storedId;
    }

    // Ultimate fallback
    const fallback = 'google/gemini-2.0-flash-lite-preview-02-05:free';
    console.warn(`[AI] Model ${storedId} not found or unavailable, falling back to ${fallback}`);
    return fallback;
  }

  async generateResponse(jobDesc, resumeText, imageData = null, userPrompt = null) {
    if (this.isRunning) {
      console.warn('[AI] Request ignored: Generation already in progress.');
      return;
    }

    try {
      const model = await this.getValidatedModel();
      if (!model) throw new Error('No valid AI model available.');

      const messages = this.buildPrompt(jobDesc, resumeText, imageData, userPrompt);
      
      if (!imageData && messages[messages.length - 1]?.role !== 'user') {
        messages.push({ 
          role: 'user', 
          content: 'What should the candidate say next? Give me a concise, natural response for the candidate to read aloud.' 
        });
      }

      const payload = { model, messages };
      this.lastRequestContext = payload;

      this.isRunning = true;
      if (this.eventBus) this.eventBus.emit('status:change', { text: 'AI Thinking...', type: 'loading' });

      const res = await fetch('/.netlify/functions/openrouter-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Handle credit exhaustion
      if (res.status === 402) {
        throw new Error('Credits Exhausted (OpenRouter)');
      }

      if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || 'No suggestion available.';

      this._deliverResponse(text);
      if (this.eventBus) this.eventBus.emit('status:change', { text: 'Suggestion ready', type: 'ok' });

    } catch (e) {
      console.error('[AI] Suggestion error:', e);
      if (this.eventBus) {
        this.eventBus.emit('status:change', { 
          text: e.message.includes('Credits') ? 'Credits Exhausted' : 'AI Error', 
          type: 'error' 
        });
      }
      this.callbacks.onError?.(e);
    } finally {
      this.isRunning = false;
    }
  }

  _deliverResponse(text) {
    this.callbacks.onResponse?.(text);
    if (this.eventBus) {
      this.eventBus.emit('ai:response', text);
    }
  }

  getSelectedModel() {
    return this.isFreeMode
      ? StorageService.get(StorageService.KEYS.SELECTED_FREE_MODEL, 'google/gemini-2.0-flash-lite-preview-02-05:free')
      : StorageService.get(StorageService.KEYS.SELECTED_PAID_MODEL, 'google/gemini-2.0-flash-001');
  }

  buildPrompt(jobDesc, resumeText, imageData = null, userPrompt = null) {
    const sys = `You are a professional interview coach. 
      Your task is to provide CONCISE, READY-TO-READ-ALOUD responses for the candidate.
      DO NOT explain your reasoning. DO NOT give advice. 
      ONLY provide the exact text the candidate should speak.
      If the interviewer asks a question, provide a high-quality answer based on the resume.
      If the interviewer is just talking, provide a natural transition or acknowledgment.
      Keep it natural, professional, and conversational.
      Context:
      Job: ${jobDesc}
      Candidate Resume: ${resumeText}`;

    const mappedHistory = this.conversationHistory.slice(-20).map(entry => {
      // Map interviewer/candidate to OpenAI 'user' role, assistant stays assistant
      const role = (entry.role === ROLES.INTERVIEWER || entry.role === ROLES.CANDIDATE || entry.role === ROLES.USER) ? ROLES.USER : entry.role;
      const prefix = entry.role === ROLES.INTERVIEWER ? '[Interviewer]: ' : (entry.role === ROLES.CANDIDATE || entry.role === ROLES.USER ? '[Candidate]: ' : '');
      return {
        role: role,
        content: prefix + entry.content
      };
    });

    const messages = [
      { role: 'system', content: sys },
      ...mappedHistory
    ];

    // Multimodal handling
    if (imageData) {
      const prompt = userPrompt || 'Analyze this image context for my interview response:';
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageData } }
        ]
      });
    }

    return messages;
  }
}
