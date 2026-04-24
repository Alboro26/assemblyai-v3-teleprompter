# Project State Summary: Interview Teleprompter Modernization

**Last Updated**: 2026-04-24
**Current Status**: Stable / Modernized (Logic & Connectivity)

## ✅ Recently Completed
- **Architectural Cleanup**: Eliminated magic strings by standardizing on `js/services/Constants.js`. All roles (`candidate`, `interviewer`, `assistant`) are now synchronized across STT, UI, and AI layers.
- **Diarization Echo Resolution**: Implemented **Turn Staging** (250ms window) in `stt.js` to suppress the "Orange-to-Purple" flicker common in AssemblyAI v3 corrections.
- **Targeted Retraction**: Refactored the UI history update logic to use **Timestamp Matching**. The system now surgically removes specific turns being corrected rather than relying on `pop()`, preventing orphaned duplicates.
- **AI Context Alignment**: Synchronized `ai.js` to recognize the `candidate` role, ensuring the inspection JSON and prompt history are consistent with the live UI.
- **Git Maintenance**: Cleaned up obsolete branches; current state finalized on `dev-merged`.

## Known Issues & Technical Debt
- **Inspection Lag**: The "Raw AI Context" viewer displays a snapshot of the last *triggered* request. If an AI request is cancelled (e.g., due to a speaker flip to candidate), the viewer displays stale data from the cancelled turn.
- **Merge Interruption**: Consecutive turns from the same speaker do not merge if an AI "Assistant" response is injected between them.

## 🛠️ Key Architectural Decisions
- **Targeted Correction**: Every `stt:final` event carries an `originalTimestamp` to ensure the UI can locate and replace the correct history entry regardless of order.
- **Turn Staging**: Sacrificing 250ms of latency for brand new turns to guarantee diarization accuracy and prevent UI "jitter".
- **Role Standardization**: All internal logic uses `ROLES.CANDIDATE` and `ROLES.INTERVIEWER`, mapped to `user` only at the API egress point in `ai.js`.

## 🚀 Next Steps / Pending
- **DeepSeek Stability Audit**: Review the state transition logic in `handleFinalTranscript` for atomicity and potential race conditions.
- **Inspector Refactor**: Move the AI Context modal to a "Live Preview" pattern that polls the current history rather than a static snapshot.
- **Smart Merge Enhancement**: Implement "Assistant-Aware Merging" to allow speaker bubbles to merge even if an AI suggestion was generated between them.
- **Context Sync Audit**: Verify full session state synchronization between the event-bus and AI-prompt buffer under high-load speaker-switching scenarios.
