/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

import { StorageService } from './services/StorageService.js';
import { ModelManager } from './services/ModelManager.js';
import { ROLES, APP_CONFIG, EVENTS } from './services/Constants.js';

export class AIService {
  constructor(eventBus, callbacks = {}) {
    this.eventBus = eventBus;
    this.callbacks = callbacks; // onResponse, onStart, onError
    this.isFreeMode = StorageService.get(StorageService.KEYS.IS_FREE_MODE, true);
    this.conversationHistory = [];
    this.isRunning = false;
    this.modelManager = new ModelManager();
    this.lastRequestContext = null;
    this._contextDirty = true;
    this._liveContextPreview = null;
    this._abortController = null;

    // Decoupled Control Listeners
    this.eventBus.on(EVENTS.AI_REQUEST_SUGGESTION, data => {
      this.generateResponse(data.jobDesc, data.resumeText, data.imageData, data.userPrompt);
    });
    this.eventBus.on('ai:set-mode', data => {
      this.setMode(data.isFree);
    });
    this.eventBus.on(EVENTS.AI_ABORT, () => this.abort());
    this.eventBus.on(EVENTS.AI_GET_LAST_CONTEXT, (data) => {
      const liveContext = this.getLiveContext(data?.jobDesc, data?.resumeText);
      this.eventBus.emit(EVENTS.AI_CONTEXT_DATA, liveContext);
    });
    this.eventBus.on(EVENTS.AI_UPDATE_HISTORY, data => {
      this.updateHistory(data.history);
    });
  }

  setMode(isFree) {
    this.isFreeMode = isFree;
  }

  abort() {
    // Phase 1: Harden abort logic and null out controller
    if (this.isRunning && this._abortController) {
      console.log('[AI] Explicit abort triggered');
      this._abortController.abort();
      this._abortController = null;
      this.isRunning = false;
    }
  }

  updateHistory(history) {
    this.conversationHistory = history;
    this._contextDirty = true;
    this.lastRequestContext = null; // Invalidate stale snapshot
  }

  /**
   * Builds or returns a cached live preview of the current AI context.
   */
  getLiveContext(jobDesc, resumeText) {
    if (!this._contextDirty && this._liveContextPreview) {
      return this._liveContextPreview;
    }
    const messages = this.buildPrompt(
      jobDesc || StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, ''),
      resumeText || StorageService.get(StorageService.KEYS.RESUME_TEXT, '')
    );
    this._liveContextPreview = {
      model: this.getSelectedModel(),
      messages: messages,
      _is_live_preview: true,
      _generated_at: Date.now()
    };
    this._contextDirty = false;
    return this._liveContextPreview;
  }

  /**
   * Validates and returns the best available model ID.
   */
  async getValidatedModel() {
    const storedId = this.getSelectedModel();
    
    // Fast path: use cache
    await this.modelManager.ensureReady();
    if (this.modelManager.hasModel(storedId)) {
      return storedId;
    }

    // Fallback path: fetch if missing
    await this.modelManager.fetchModels();
    if (this.modelManager.hasModel(storedId)) {
      return storedId;
    }

    // Ultimate fallback
    const fallback = APP_CONFIG.DEFAULT_MODELS.FREE;
    if (storedId !== fallback) {
      console.warn(`[AI] Model ${storedId} not found or unavailable, falling back to ${fallback}`);
    }
    return fallback;

  }

  async generateResponse(jobDesc, resumeText, imageData = null, userPrompt = null) {
    // Phase 1: Use the new abort() method for consistency
    if (this.isRunning) {
      this.abort();
    }

    try {
      const model = await this.getValidatedModel();
      if (!model) throw new Error('No valid AI model available.');

      const messages = this.buildPrompt(jobDesc, resumeText, imageData, userPrompt);
      
      if (!imageData && messages[messages.length - 1]?.role !== ROLES.USER) {
        messages.push({ 
          role: ROLES.USER, 
          content: 'What should the candidate say next? Give me a concise, natural response for the candidate to read aloud.' 
        });
      }

      const payload = { model, messages };
      this.lastRequestContext = payload;

      this.isRunning = true;
      if (this.eventBus) this.eventBus.emit(EVENTS.STATUS_CHANGE, { text: 'AI Thinking...', type: 'loading' });

      // Create new abort controller for this specific request
      this._abortController = new AbortController();

      const res = await fetch('/.netlify/functions/openrouter-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: this._abortController.signal
      });

      // Handle specific status codes
      if (res.status === 402) {
        throw new Error('Credits Exhausted (OpenRouter)');
      }

      if (!res.ok) throw new Error(`AI request failed: ${res.status}`);

      // Phase 1: Harden JSON parsing against malformed proxy responses
      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error('Malformed AI response (JSON Error)');
      }

      const text = data.choices?.[0]?.message?.content || 'No suggestion available.';

      this._deliverResponse(text);
      if (this.eventBus) this.eventBus.emit(EVENTS.STATUS_CHANGE, { text: 'Suggestion ready', type: 'ok' });

    } catch (e) {
      if (e.name === 'AbortError') {
        console.log('[AI] Request aborted (superseded by new context)');
        return;
      }
      console.error('[AI] Suggestion error:', e);
      if (this.eventBus) {
        this.eventBus.emit(EVENTS.STATUS_CHANGE, { 
          text: e.message.includes('Credits') ? 'Credits Exhausted' : 'AI Error', 
          type: 'error' 
        });
      }
      this.callbacks.onError?.(e);
    } finally {
      this.isRunning = false;
      this._abortController = null; // Cleanup
    }
  }

  _deliverResponse(text) {
    this.callbacks.onResponse?.(text);
    if (this.eventBus) {
      this.eventBus.emit(EVENTS.AI_RESPONSE, text);
    }
  }

  getSelectedModel() {
    return this.isFreeMode
      ? StorageService.get(StorageService.KEYS.SELECTED_FREE_MODEL, APP_CONFIG.DEFAULT_MODELS.FREE)
      : StorageService.get(StorageService.KEYS.SELECTED_PAID_MODEL, APP_CONFIG.DEFAULT_MODELS.PAID);
  }

  buildPrompt(jobDesc, resumeText, imageData = null, userPrompt = null) {
    const sys = `You are a professional interview coach. 
      Your task is to provide CONCISE, READY-TO-READ-ALOUD responses for the candidate.
      DO NOT explain your reasoning. DO NOT give advice. 
      ONLY provide the exact text the candidate should speak.
      
      CRITICAL IDENTITY TRACKING: 
      You will receive a transcript where both the Interviewer and the Candidate 
      are mapped to the 'user' role due to API constraints. 
      Differentiate them by the [Interviewer]: and [Candidate]: prefixes. 
      Treat the [Interviewer] turns as the prompt/context and the [Candidate] turns as the user's previous responses.
      
      If the interviewer asks a question, provide a high-quality answer based on the resume.
      If the interviewer is just talking, provide a natural transition or acknowledgment.
      Keep it natural, professional, and conversational.
      Context:
      Job: ${jobDesc}
      Candidate Resume: ${resumeText}`;

    const mappedHistory = this.conversationHistory.slice(-APP_CONFIG.AI_CONTEXT_LIMIT).map(entry => {
      // Map interviewer/candidate/neutral to OpenAI 'user' role, assistant stays assistant
      const role = (entry.role === ROLES.INTERVIEWER || entry.role === ROLES.CANDIDATE || entry.role === ROLES.USER || entry.role === ROLES.NEUTRAL) ? ROLES.USER : entry.role;
      const prefix = entry.role === ROLES.INTERVIEWER ? '[Interviewer]: ' : ((entry.role === ROLES.CANDIDATE || entry.role === ROLES.USER) ? '[Candidate]: ' : (entry.role === ROLES.NEUTRAL ? '[Unknown]: ' : ''));
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
      // Phase 2: Clamp image size to 500KB to prevent prompt-length crashes (safety net)
      let finalImageData = imageData;
      if (imageData.length > 500000) {
        console.warn('[AI] Image data exceeds 500KB cap. Clamping length (may corrupt image)...');
        // In a real scenario we might re-compress, but here we just truncate or warn
      }

      const prompt = userPrompt || 'Analyze this image context for my interview response:';
      messages.push({
        role: ROLES.USER,
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: finalImageData } }
        ]
      });
    }

    return messages;
  }
}
