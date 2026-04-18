/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

export class AIManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks; // onResponse, onStart, onError
    this.isFreeMode = true;
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

    this.callbacks.onStart?.();
    this.isRunning = true;

    const recentHistory = this.conversationHistory.slice(-10);
    const cacheKey = JSON.stringify(recentHistory);
    
    if (this.responseCache.has(cacheKey)) {
        console.log('[AI] Serving response from cache.');
        this.callbacks.onResponse?.(this.responseCache.get(cacheKey));
        this.isRunning = false;
        return;
    }

    const messages = [
      {
        role: 'system',
        content: `You are an expert interview coach. Context:
JOB DESCRIPTION: ${jobDesc}
CANDIDATE RESUME: ${resumeText}

SCENARIO: You are listening to a real-time interview.
Goal: Provide the CANDIDATE with a SHORT, TACTICAL response or talking point based on the last question asked.
- Keep it under 40 words.
- Be direct.
- Focus on the STAR method if applicable.`
      },
      ...recentHistory.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    const freeModel = localStorage.getItem('selectedFreeModel') || 'google/gemma-4-26b-a4b-it:free';
    const model = this.isFreeMode ? freeModel : 'google/gemini-2.0-flash-exp';
    
    try {
      let data = await this.fetchOpenRouter(model, messages);
      
      // Fallback if first model fails
      if (!data.choices?.[0]?.message?.content) {
        console.warn(`[AI] Primary model ${model} failed, trying fallback...`);
        data = await this.fetchOpenRouter('google/gemini-flash-1.5', messages);
      }

      let answer = data.choices?.[0]?.message?.content;
      if (answer) {
        answer = answer.replace(/[*_`#>]/g, '');
        this.responseCache.set(cacheKey, answer);
        this.callbacks.onResponse?.(answer);
      } else {
        throw new Error('No content returned from AI');
      }
    } catch (err) {
      console.error('[AI] Generation failed:', err);
      this.callbacks.onError?.(err.message);
    } finally {
      this.isRunning = false;
    }
  }

  async fetchOpenRouter(model, messages) {
    const res = await fetch('/.netlify/functions/openrouter-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    return await res.json();
  }
}
