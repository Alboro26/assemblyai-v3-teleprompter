/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

import { StorageService } from './services/StorageService.js';

export class AIService {
  constructor(callbacks = {}) {
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

  async generateResponse(jobDesc, resumeText) {
    if (this.isRunning) {
      console.warn('[AI] Request ignored: Generation already in progress.');
      return;
    }

    const messages = this.buildPrompt(jobDesc, resumeText);
    const cacheKey = JSON.stringify(messages);
    if (this.responseCache.has(cacheKey)) {
      this.callbacks.onResponse?.(this.responseCache.get(cacheKey));
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

  buildPrompt(jobDesc, resumeText) {
    const sys = `You are a professional interview coach.
      Help the candidate respond naturally.
      Context:
      Job: ${jobDesc}
      Candidate Resume: ${resumeText}`;

    return [
      { role: 'system', content: sys },
      ...this.conversationHistory.slice(-10) // Context window
    ];
  }
}
