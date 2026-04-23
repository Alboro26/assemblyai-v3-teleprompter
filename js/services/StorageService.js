/**
 * Centralized service for localStorage operations.
 * Handles JSON parsing, type coercion, and key management.
 */
export class StorageService {
    static KEYS = {
        // API Keys
        OPENROUTER_KEY: 'openrouter_key',
        ASSEMBLYAI_KEY: 'assemblyai_key',

        // Model Preferences
        SELECTED_FREE_MODEL: 'selectedFreeModel',
        SELECTED_PAID_MODEL: 'selectedPaidModel',
        IS_ASSEMBLY_MODE: 'isAssemblyMode',
        IS_FREE_MODE: 'isFreeMode',

        // UI Preferences
        FONT_SIZE: 'fontSize',
        
        // Session Data
        CONVERSATION_HISTORY: 'conversationHistory',
        USER_VOICE_SIGNATURE: 'userVoiceSignature',

        // Settings
        VOICE_THRESHOLD: 'voiceThreshold',
        NOISE_FLOOR_THRESHOLD: 'noiseFloorThreshold',
        AI_TRIGGER_DELAY: 'aiTriggerDelay',
        JOB_DESCRIPTION: 'jobDescription',
        RESUME_TEXT: 'resumeText',
        CANDIDATE_LABEL_OVERRIDE: 'candidateLabelOverride'
    };

    /**
     * Get a value from localStorage with type-safe defaults.
     * @param {string} key - Storage key.
     * @param {any} defaultValue - Fallback value.
     */
    static get(key, defaultValue = null) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return defaultValue;

            let parsed = JSON.parse(raw);

            // Type Coercion: Handle legacy stringified numbers/booleans
            if (typeof defaultValue === 'number') {
                const num = Number(parsed);
                return !isNaN(num) ? num : defaultValue;
            }
            if (typeof defaultValue === 'boolean') {
                if (typeof parsed === 'string') return parsed === 'true';
                return !!parsed;
            }

            return parsed;
        } catch (error) {
            // Fallback for non-JSON strings (like old manual localStorage.setItem)
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                if (typeof defaultValue === 'number') return Number(raw) || defaultValue;
                if (typeof defaultValue === 'boolean') return raw === 'true';
                return raw;
            }
            return defaultValue;
        }
    }

    static MAX_HISTORY_LIMIT = 50;

    /**
     * Set a value in localStorage.
     * @param {string} key - Storage key.
     * @param {any} value - Value to store.
     */
    static set(key, value) {
        try {
            let dataToStore = value;

            // Robustness: Prune history on write to prevent quota overflow
            if (key === this.KEYS.CONVERSATION_HISTORY && Array.isArray(value)) {
                if (value.length > this.MAX_HISTORY_LIMIT) {
                    dataToStore = value.slice(-this.MAX_HISTORY_LIMIT);
                }
            }

            localStorage.setItem(key, JSON.stringify(dataToStore));
        } catch (error) {
            console.error(`StorageService: Error saving ${key}`, error);
        }
    }

    /**
     * Remove a key.
     * @param {string} key 
     */
    static remove(key) {
        localStorage.removeItem(key);
    }

    /**
     * Clear all application data.
     */
    static clearAll(keepApiKeys = true) {
        const keysToKeep = keepApiKeys
            ? [this.KEYS.OPENROUTER_KEY, this.KEYS.ASSEMBLYAI_KEY]
            : [];

        Object.values(this.KEYS).forEach(key => {
            if (!keysToKeep.includes(key)) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * Programmatically migrate legacy storage formats to proper JSON types.
     * Idempotent: safe to run every app launch.
     */
    static migrate() {
        // Keys that must be numbers, not strings
        const numericKeys = [
            this.KEYS.FONT_SIZE,
            this.KEYS.VOICE_THRESHOLD,
            this.KEYS.NOISE_FLOOR_THRESHOLD,
            this.KEYS.AI_TRIGGER_DELAY
        ];

        numericKeys.forEach(key => {
            const raw = localStorage.getItem(key);
            if (raw === null) return;
            const trimmed = raw.trim();
            // If it's a string that looks like a number, rewrite as numeric JSON
            if (typeof raw === 'string' && !isNaN(trimmed) && trimmed !== '') {
                localStorage.setItem(key, JSON.stringify(Number(trimmed)));
            }
        });

        // Ensure boolean keys are actual booleans
        const boolKeys = [this.KEYS.IS_ASSEMBLY_MODE, this.KEYS.IS_FREE_MODE];
        boolKeys.forEach(key => {
            const raw = localStorage.getItem(key);
            if (raw === null) return;
            if (raw === 'true') localStorage.setItem(key, 'true'); 
            else if (raw === 'false') localStorage.setItem(key, 'false');
        });
    }
}