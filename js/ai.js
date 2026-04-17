/**
 * js/ai.js - AI Suggestion Engine (OpenRouter)
 */

export class AIManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks; // onResponse, onStart, onError
    this.isFreeMode = true;
    this.conversationHistory = [];
    this.isRunning = false;
  }

  setMode(isFree) {
    this.isFreeMode = isFree;
  }

  updateHistory(history) {
    this.conversationHistory = history;
  }

  async generateResponse(apiKey, jobDesc, resumeText) {
    if (this.isRunning) {
      console.warn('[AI] Request ignored: Generation already in progress.');
      return;
    }

    if (!apiKey) {
      this.callbacks.onError?.('Missing OpenRouter API Key');
      return;
    }

    this.callbacks.onStart?.();
    this.isRunning = true;

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
      ...this.conversationHistory.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    const freeModel = localStorage.getItem('selectedFreeModel') || 'google/gemma-4-26b-a4b-it:free';
    const model = this.isFreeMode ? freeModel : 'google/gemini-2.0-flash-exp';
    
    try {
      let data = await this.fetchOpenRouter(apiKey, model, messages);
      
      // Fallback if first model fails
      if (!data.choices?.[0]?.message?.content) {
        console.warn(`[AI] Primary model ${model} failed, trying fallback...`);
        data = await this.fetchOpenRouter(apiKey, 'google/gemini-flash-1.5', messages);
      }

      let answer = data.choices?.[0]?.message?.content;
      if (answer) {
        answer = answer.replace(/[*_`#>]/g, '');
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

  async fetchOpenRouter(apiKey, model, messages) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:8080',
        'X-Title': 'Interview Teleprompter'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
}
