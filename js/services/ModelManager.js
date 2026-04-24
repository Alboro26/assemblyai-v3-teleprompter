/**
 * js/services/ModelManager.js
 * Handles the full lifecycle of AI models: fetching, caching, and filtering.
 * UI-Agnostic: Does not touch the DOM.
 */
import { StorageService } from './StorageService.js';

export class ModelManager {
    constructor() {
        this.models = StorageService.get(StorageService.KEYS.CACHED_MODELS, []);
        this.lastFetched = StorageService.get(StorageService.KEYS.MODELS_LAST_FETCHED, 0);
        this.TTL = 24 * 60 * 60 * 1000; // 24 hours
        this._readyPromise = null;
    }

    /**
     * Ensures models are loaded before proceeding.
     */
    async ensureReady() {
        if (!this._readyPromise) {
            this._readyPromise = this.fetchModels();
        }
        return this._readyPromise;
    }

    /**
     * Fetch models from the proxy or cache with retry logic.
     */
    async fetchModels(force = false, retries = 3) {
        if (!force && Date.now() - this.lastFetched < this.TTL && this.models.length > 0) {
            return this.models;
        }

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const res = await fetch('/.netlify/functions/openrouter-proxy', { method: 'GET' });
                if (!res.ok) throw new Error(`Model fetch failed (${res.status})`);
                
                const data = await res.json();
                if (data && data.data) {
                    this.models = data.data;
                    this.lastFetched = Date.now();
                    
                    StorageService.set(StorageService.KEYS.CACHED_MODELS, this.models);
                    StorageService.set(StorageService.KEYS.MODELS_LAST_FETCHED, this.lastFetched);
                    
                    return this.models;
                }
            } catch (error) {
                console.warn(`[ModelManager] Fetch attempt ${attempt + 1} failed:`, error);
                if (attempt === retries - 1) {
                    console.error('[ModelManager] All fetch attempts failed. Using cache.');
                    return this.models;
                }
                // Exponential backoff
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
        }
        return this.models;
    }

    /**
     * Get free-tier models.
     */
    getFreeModels() {
        return this.models.filter(m => {
            if (m.id.toLowerCase().includes(':free')) return true;
            const p = m.pricing;
            return (p && parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0);
        });
    }

    /**
     * Get paid/pro models.
     */
    getPaidModels() {
        return this.models.filter(m => {
            const isFree = m.id.toLowerCase().includes(':free');
            const p = m.pricing;
            const hasPrice = (p && (parseFloat(p.prompt) > 0 || parseFloat(p.completion) > 0));
            return !isFree && hasPrice;
        });
    }

    /**
     * Check if a specific model ID exists in the current list.
     */
    hasModel(modelId) {
        return this.models.some(m => m.id === modelId);
    }
}
