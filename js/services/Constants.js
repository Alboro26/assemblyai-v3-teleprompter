/**
 * js/services/Constants.js
 * Central source of truth for string identifiers to prevent magic-string errors.
 */
export const ROLES = {
  CANDIDATE: 'candidate',
  INTERVIEWER: 'interviewer',
  ASSISTANT: 'assistant',
  USER: 'user' // For internal OpenAI mapping fallback
};

export const STORAGE_KEYS = {
  CONVERSATION_HISTORY: 'conversationHistory',
  CANDIDATE_LABEL_OVERRIDE: 'candidateLabelOverride',
  LEARNED_CANDIDATE_LABEL: 'learnedCandidateLabel',
  MERGE_THRESHOLD: 'mergeThreshold'
};
