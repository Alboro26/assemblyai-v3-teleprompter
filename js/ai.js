/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

import { StorageService } from './services/StorageService.js';

export class AIService {
  constructor(eventBus, callbacks = {}) {
    this.eventBus = eventBus;
    this.callbacks = callbacks; // onResponse, onStart, onError
    this.isFreeMode = StorageService.get(StorageService.KEYS.IS_FREE_MODE, true);
    this.conversationHistory = [];
    this.isRunning = false;
    this.responseCache = new Map();
  }

  setMode(isFree) {
    this.isFreeMode = isFree;
  }

  updateHistory(history) {
    this.conversationHistory = history;
  }

  /**
   * Generates a response from the AI.
   * @param {string} jobDesc 
   * @param {string} resumeText 
   * @param {string|null} imageData - Optional Base64 data URL for vision support.
   * @param {string|null} userPrompt - Optional custom user prompt for multimodal requests.
   */
  async generateResponse(jobDesc, resumeText, imageData = null, userPrompt = null) {
    if (this.isRunning) {
      console.warn('[AI] Request ignored: Generation already in progress.');
      return;
    }

    const messages = this.buildPrompt(jobDesc, resumeText, imageData, userPrompt);
    const cacheKey = JSON.stringify(messages);
    if (this.responseCache.has(cacheKey)) {
      const cachedText = this.responseCache.get(cacheKey);
      this.callbacks.onResponse?.(cachedText);
      if (this.eventBus) this.eventBus.emit('ai:response', cachedText);
      return;
    }

    this.isRunning = true;
    this.callbacks.onStart?.();

    try {
      const model = this.getSelectedModel();
      const res = await fetch('/.netlify/functions/openrouter-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages })
      });

      if (!res.ok) throw new Error('AI request failed');
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || 'No suggestion available.';

      this.responseCache.set(cacheKey, text);
      
      this.callbacks.onResponse?.(text);
      if (this.eventBus) {
        this.eventBus.emit('ai:response', text);
      }
    } catch (e) {
      console.error('[AI] Suggestion error:', e);
      this.callbacks.onError?.(e);
    } finally {
      this.isRunning = false;
    }
  }

  getSelectedModel() {
    return this.isFreeMode
      ? StorageService.get(StorageService.KEYS.SELECTED_FREE_MODEL, 'google/gemini-2.0-flash-lite-preview-02-05:free')
      : StorageService.get(StorageService.KEYS.SELECTED_PAID_MODEL, 'google/gemini-2.0-flash-001');
  }

  buildPrompt(jobDesc, resumeText, imageData = null, userPrompt = null) {
    const sys = `You are a professional interview coach.
      Help the candidate respond naturally.
      Context:
      Job: ${jobDesc}
      Candidate Resume: ${resumeText}`;

    const messages = [
      { role: 'system', content: sys },
      ...this.conversationHistory.slice(-10) // Context window
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
