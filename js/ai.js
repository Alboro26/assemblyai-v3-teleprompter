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

    const systemPrompt = `You are an AI assistant providing real-time speaking lines for a job candidate in a live interview.

Context:
JOB DESCRIPTION: ${jobDesc}
CANDIDATE RESUME: ${resumeText}

Your ONLY output should be the exact words the candidate should say aloud. 
DO NOT include any additional text such as:
- Introductions like "Response:" or "Here is a suggestion:"
- Meta-commentary like "Since I don't have the resume..."
- Explanations, notes, or context

The output must be a single, concise, professional sentence or short paragraph that the candidate can read directly without any modification. If you lack context, provide a confident generic answer that demonstrates communication skills.`;

    const lastMessage = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].content : '';
    
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...recentHistory.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      })),
      {
        role: 'user',
        content: `The interviewer just said: "${lastMessage}"\n\nProvide ONLY the candidate's spoken response. No other text.`
      }
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
        
        // Remove common prefixes
        answer = answer.replace(/^(Response:|Answer:|Suggestion:|Here's a suggestion:|Sure,|Certainly,|You could say:)\s*/i, '');
        
        // Trim whitespace and quotes
        answer = answer.trim().replace(/^["']|["']$/g, '');

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
        max_tokens: 150
      })
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    return await res.json();
  }
}
