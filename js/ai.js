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
    this.models = JSON.parse(localStorage.getItem('openrouter_models') || '[]');

    // Initial sync in background
    this.syncModels();
  }

  async syncModels() {
    const CACHE_KEY = 'openrouter_models';
    const TTL = 24 * 60 * 60 * 1000;
    const lastSync = parseInt(localStorage.getItem('openrouter_models_ts') || '0');

    if (Date.now() - lastSync < TTL && this.models.length > 0) {
      this.populateDropdowns();
      return;
    }

    try {
      const res = await fetch('/.netlify/functions/openrouter-proxy', { method: 'GET' });
      if (!res.ok) throw new Error('Model fetch failed');
      const data = await res.json();

      if (data.data) {
        this.models = data.data;
        localStorage.setItem(CACHE_KEY, JSON.stringify(this.models));
        localStorage.setItem(CACHE_KEY + '_ts', Date.now().toString());
        console.log(`[AI] Synced ${this.models.length} models from OpenRouter.`);
        
        // Auto-correct if current selection is discontinued
        const currentFree = localStorage.getItem('selectedFreeModel');
        if (currentFree && !this.models.some(m => m.id === currentFree)) {
            console.warn(`[AI] Selected model ${currentFree} no longer available. Resetting...`);
            localStorage.removeItem('selectedFreeModel');
        }
        
        this.populateDropdowns();
      }
    } catch (e) {
      console.warn('[AI] Model sync from network failed, attempting to load local defaults...', e);
      try {
        const localRes = await fetch('models.json');
        if (localRes.ok) {
          const localData = await localRes.json();
          this.models = localData.data || localData;
          console.log(`[AI] Loaded ${this.models.length} models from local models.json`);
          this.populateDropdowns();
        }
      } catch (localErr) {
        console.error('[AI] Local model fallback also failed.', localErr);
      }
    }
  }

  populateDropdowns() {
    const freeSel = document.getElementById('freeModel');
    const paidSel = document.getElementById('paidModel');
    if (!freeSel || !paidSel) return;

    const currentFree = localStorage.getItem('selectedFreeModel');
    const currentPaid = localStorage.getItem('selectedPaidModel');

    // Clear and repopulate
    freeSel.innerHTML = '';
    paidSel.innerHTML = '';

    this.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.id;

      if (this.isModelFree(m)) {
        freeSel.appendChild(opt);
      } else {
        paidSel.appendChild(opt);
      }
    });

    // Restore selections
    if (currentFree) freeSel.value = currentFree;
    if (currentPaid) paidSel.value = currentPaid;
  }

  isModelFree(m) {
    if (m.id.toLowerCase().includes('free')) return true;
    const p = m.pricing;
    if (p && parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0) return true;
    return false;
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

    const lastMessage = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1].content : '';
    const systemPromptVoice = `You are an AI assistant providing real-time speaking lines for a job candidate in a live interview.

Context:
JOB DESCRIPTION: ${jobDesc}
CANDIDATE RESUME: ${resumeText}

Your ONLY output should be the exact words the candidate should say aloud. 
DO NOT include any additional text such as:
- Introductions like "Response:" or "Here is a suggestion:"
- Meta-commentary like "Since I don't have the resume..."
- Explanations, notes, or context

The output must be a single, concise, professional sentence or short paragraph that the candidate can read directly without any modification. If you lack context, provide a confident generic answer that demonstrates communication skills.`;

    const messages = [
      {
        role: 'system',
        content: systemPromptVoice
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

    const freeModel = localStorage.getItem('selectedFreeModel') || 'google/gemini-2.0-flash-lite-preview-02-05:free';
    const paidModel = localStorage.getItem('selectedPaidModel') || 'google/gemini-2.0-flash-001';
    const model = this.isFreeMode ? freeModel : paidModel;

    try {
      let data;
      try {
        data = await this.fetchOpenRouter(model, messages);
      } catch (err) {
        console.warn(`[AI] Primary model ${model} error, trying stable fallback...`, err);
        data = await this.fetchOpenRouter('openrouter/free', messages);
      }

      // Secondary check for empty response
      if (!data.choices?.[0]?.message?.content) {
        console.warn(`[AI] Primary model ${model} empty, trying stable fallback...`);
        data = await this.fetchOpenRouter('openrouter/free', messages);
      }

      let answer = data.choices?.[0]?.message?.content;
      if (answer) {
        // Cleanup markdown/noise for voice response
        answer = answer.replace(/[*_`#>]/g, '').trim();

        // Remove common prefixes
        const prefixRegex = /^(Response:|Answer:|Suggestion:|Here's a suggestion:|Sure,|Certainly,|You could say:|Candidate:)\s*/i;
        answer = answer.replace(prefixRegex, '').trim();

        // Final trim and quote removal
        answer = answer.replace(/^["']|["']$/g, '').trim();

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

  /**
   * Sends one or more Base64 screenshots directly to the multimodal API.
   * Bypasses OCR entirely — the model sees the raw pixels.
   * @param {string[]} images - Array of Base64 data URLs (e.g. from camera.captureBase64())
   * @param {string} jobDesc
   * @param {string} resumeText
   */
  async generateCodingResponse(images, jobDesc, resumeText) {
    if (this.isRunning) return;
    this.callbacks.onStart?.();
    this.isRunning = true;

    const systemPrompt = `You are an elite Senior Engineer taking a technical interview for this role:
JOB: ${jobDesc}
RESUME: ${resumeText}

Analyze the coding challenge in the screenshots and provide:
1. The solution code WRAPPED in triple backticks (\`\`\`).
2. A brief prose explanation OUTSIDE the backticks.

CRITICAL: Use standard Markdown. Do not put the explanation inside the code block as comments unless they are brief. Keep the prose and code blocks strictly separate so they can be parsed for different UI panels.`;

    // Build multimodal content: one image_url block per screenshot
    const imageBlocks = images.map(dataUrl => ({
      type: 'image_url',
      image_url: { url: dataUrl }
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          ...imageBlocks,
          { type: 'text', text: 'Solve the coding challenge shown in the screenshot(s) above.' }
        ]
      }
    ];

    const freeModel = localStorage.getItem('selectedFreeModel') || 'google/gemini-2.0-flash-lite-preview-02-05:free';
    const paidModel = localStorage.getItem('selectedPaidModel') || 'google/gemini-2.0-flash-001';
    const model = this.isFreeMode ? freeModel : paidModel;

    try {
      const res = await fetch('/.netlify/functions/openrouter-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 1500 })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const data = await res.json();
      const answer = data.choices?.[0]?.message?.content?.trim();
      if (answer) {
        this.callbacks.onResponse?.(answer);
      } else {
        throw new Error('No content returned from AI');
      }
    } catch (err) {
      console.error('[AI] Coding generation failed:', err);
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
