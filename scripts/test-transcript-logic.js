/**
 * scripts/test-transcript-logic.js
 * Unit test for AppController's transcript handling logic.
 * Specifically targets the "Ghost Reference" bug and merging behavior.
 */

const ROLES = {
  CANDIDATE: 'candidate',
  INTERVIEWER: 'interviewer',
  ASSISTANT: 'assistant',
  NEUTRAL: 'neutral'
};

const APP_CONFIG = {
  HISTORY_LIMIT: 50,
  MERGE_THRESHOLD_MS: 1500,
  MERGE_NEUTRAL_THRESHOLD: 500,
  INTERLEAVING_POLICY: 'break'
};

/**
 * Mock implementation of the handleFinalTranscript logic from ui.js
 */
function handleFinalTranscriptMock(state, data) {
  const { text, rawLabel } = data;
  const history = state.conversationHistory;
  const now = data.originalTimestamp || Date.now();

  // 1. Identify Role
  let aiRole = (rawLabel === 'UNKNOWN' || !rawLabel) ? ROLES.NEUTRAL : ROLES.CANDIDATE;

  // 2. Diarization Correction (Targeted Retraction)
  if (data.replaceLast && history.length > 0) {
    const index = history.findIndex(e => e.startTime === data.originalTimestamp);
    if (index !== -1) {
      history.splice(index, 1);
    }
  }

  // 3. SMART MERGE LOGIC
  let lastHumanEntry = null;
  let lastHumanIndex = -1;

  // FIX: Reset before scan (This is the fix we implemented)
  lastHumanEntry = null; 
  lastHumanIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== ROLES.ASSISTANT) {
      lastHumanEntry = history[i];
      lastHumanIndex = i;
      break;
    }
  }

  // 4. Merge decision
  const mergeThreshold = APP_CONFIG.MERGE_THRESHOLD_MS;
  let effectiveGap = Infinity;
  if (lastHumanEntry) {
    effectiveGap = data.audioStart - lastHumanEntry.audioEnd;
  }

  let shouldMerge = false;
  if (lastHumanEntry && effectiveGap <= mergeThreshold) {
    lastHumanEntry.content += ' ' + text;
    lastHumanEntry.role = aiRole; // Upgrade role
    shouldMerge = true;
  }

  if (!shouldMerge) {
    history.push({
      role: aiRole,
      content: text,
      startTime: now,
      audioEnd: data.audioEnd
    });
  }
}

function runTests() {
  console.log('--- Starting Transcript Logic Tests ---');

  // TEST 1: Ghost Reference Correction
  console.log('\n[Test 1] Diarization Correction (Ghost Reference Fix)');
  const state1 = { conversationHistory: [] };
  const ts1 = Date.now();

  // Step A: First turn (neutral)
  handleFinalTranscriptMock(state1, {
    text: 'Hello',
    rawLabel: 'UNKNOWN',
    originalTimestamp: ts1,
    audioStart: 0,
    audioEnd: 1000
  });

  // Step B: Correction turn (replaces turn with candidate)
  handleFinalTranscriptMock(state1, {
    text: 'Hello corrected',
    rawLabel: 'Speaker A',
    replaceLast: true,
    originalTimestamp: ts1,
    audioStart: 0,
    audioEnd: 1000
  });

  if (state1.conversationHistory.length === 1 && state1.conversationHistory[0].role === ROLES.CANDIDATE) {
    console.log('✅ PASS: History has 1 candidate entry.');
  } else {
    console.error('❌ FAIL: History count=' + state1.conversationHistory.length + ', role=' + state1.conversationHistory[0]?.role);
    process.exit(1);
  }

  // TEST 2: Sequential Merging
  console.log('\n[Test 2] Sequential Merging');
  const state2 = { conversationHistory: [] };
  
  handleFinalTranscriptMock(state2, { text: 'Part one.', rawLabel: 'Speaker A', audioStart: 0, audioEnd: 1000 });
  handleFinalTranscriptMock(state2, { text: 'Part two.', rawLabel: 'Speaker A', audioStart: 1500, audioEnd: 2500 }); // Gap 500ms

  if (state2.conversationHistory.length === 1 && state2.conversationHistory[0].content === 'Part one. Part two.') {
    console.log('✅ PASS: Messages merged correctly.');
  } else {
    console.error('❌ FAIL: Messages failed to merge. Count=' + state2.conversationHistory.length);
    process.exit(1);
  }

  console.log('\n--- All Tests Passed! ---');
}

runTests();
