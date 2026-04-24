/**
 * js/services/Constants.js
 * Central source of truth for string identifiers to prevent magic-string errors.
 */
export const ROLES = {
  CANDIDATE: 'candidate',
  INTERVIEWER: 'interviewer',
  ASSISTANT: 'assistant',
  USER: 'user', // For internal OpenAI mapping fallback
  NEUTRAL: 'neutral' // ✅ Stage UNKNOWN speakers here
};

export const STORAGE_KEYS = {
  CONVERSATION_HISTORY: 'conversationHistory',
  CANDIDATE_LABEL_OVERRIDE: 'candidateLabelOverride',
  LEARNED_CANDIDATE_LABEL: 'learnedCandidateLabel',
  MERGE_THRESHOLD: 'mergeThreshold'
};

export const EVENTS = {
  STT_INTERIM: 'stt:interim',
  STT_FINAL: 'stt:final',
  AI_REQUEST_SUGGESTION: 'ai:request-suggestion',
  AI_RESPONSE: 'ai:response',
  AI_UPDATE_HISTORY: 'ai:update-history',
  AI_GET_LAST_CONTEXT: 'ai:get-last-context',
  AI_CONTEXT_DATA: 'ai:context-data',
  AI_ABORT: 'ai:abort',
  STATUS_CHANGE: 'status:change',
  UI_SHOW_TOAST: 'ui:show-toast'
};

export const APP_CONFIG = {
  AI_CONTEXT_LIMIT: 20,
  HISTORY_LIMIT: 50
};
