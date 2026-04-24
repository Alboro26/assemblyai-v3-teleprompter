# Project State Summary: Interview Teleprompter Modernization

**Last Updated**: 2026-04-24
**Current Status**: Stable / Modernized (Logic & Connectivity)

## ✅ Recently Completed
- **STT Protocol Upgrade**: Fully migrated to AssemblyAI v3 / Universal-3 Pro (`u3-rt-pro` model). Fixed the `Turn` event message handling and `end_of_turn` detection.
- **Ghostwriter Protocol**: Refined the AI system prompt to enforce concise, ready-to-read-aloud responses. Removed meta-analysis and conversational "thoughts" from the AI coach.
- **AI 400 Error Resolution**: Implemented role mapping (`interviewer` -> `user`) for OpenRouter compatibility while preserving speaker context via content prefixing (`[Interviewer]:`).
- **Smart Speaker ID**: Implemented a "Session Learning" heuristic. The app now learns speaker roles from manual user corrections in the transcript.
- **UI & Navigation**: 
    - Fixed the sidebar toggle logic and added smooth CSS transitions.
    - Corrected the teleprompter DOM ID mismatch to restore visibility of AI suggestions.
    - [x] **Smart Merging**: Temporal clustering (2s threshold) to reduce transcript noise.
- [x] **Live Streaming**: "Ghost Bubbles" with word-by-word interim population.
- [x] **Diarization Stability**: Implemented Advanced Turn Reconciliation using Jaccard Similarity and temporal history to resolve late speaker-id flips in AssemblyAI v3.
- [x] **Event-Driven Architecture**: Fully decoupled services via `EventBus`.

## Known Issues & Technical Debt
- **Interim Jitter**: The "Neutral Bubble" can be prematurely cleared or skipped if the STT sends a `Turn` message too early in the speech cycle. (Mitigated by settling window).
- **Merge Race Condition**: Corrections arriving with slightly different timestamps are now stabilized via `originalTimestamp` inheritance in the reconciler.

## 🛠️ Key Architectural Decisions
- **Event-Driven UI**: All service-to-UI communication must go through the `EventBus`.
- **Role Mapping**: The `AIService` maps all incoming speech to the `user` role for API compliance but uses internal metadata for UI coloring.
- **Diarization**: `CANDIDATE_LABEL_OVERRIDE` in storage is the primary source, followed by `learnedCandidateLabel` in the session state.

## 🚀 Next Steps / Pending
- **UI Polish**: Further aesthetic refinements to the HUD and teleprompter transitions.
- **Diarization UI**: Add a clear indicator in the settings of which label is currently "learned."
- **Model Tuning**: Monitor response quality with different OpenRouter models.
