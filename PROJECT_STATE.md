# Project State Summary: Interview Teleprompter Modernization

**Last Updated**: 2026-04-24
**Current Status**: Production Stabilization & Diarization Polish (In Progress)

## ✅ Accomplishments
- **Defensive UI Hardening**: Resolved the "Single Point of Failure" in the settings system. Both `saveSettings` and `loadConfig` are now fully null-safe, preventing DOM-mismatch crashes.
- **Infrastructure Ready**: `Constants.js` updated to support `LEARNED_CANDIDATE_LABEL` and `INTERVIEWER_LABEL_OVERRIDE` for session-level identity persistence.
- **The Global Flip**: Implemented retroactive role synchronization and surgical, flicker-free UI updates in `ui.js`.
- **AI Kill Switch**: Finalized `AIService.abort()` for robust credit protection during role corrections.
- **UI Persistence Badge**: Added a high-visibility badge to the footer to show the current "Locked" speaker label.
- **Live Context Inspector**: Refactored the "Raw AI Context" viewer into a live-updating monitor that polls state and history in real-time.

## 🛠️ Architectural Decisions
- **Session-Level Orchestration**: Moving away from "reactive" bubble-by-bubble correction to "proactive" identity locking. Once a speaker is identified, the system retroactively corrects the entire session history.
- **Inclusive Interviewer Mapping**: Standardized on a "Candidate-First" model where anyone not the candidate is treated as an interviewer, with an optional "Neutral Filter" for noise.

## 🚀 Next Steps / Pending
- **Temporal Merging**: Fine-tune consecutive turn merging to handle rapid speaker transitions.
- **Calibration Retry**: Add a way to reset calibration if the environment is too noisy.

## Known Issues & Technical Debt
- **PWA Cache Ghosting**: Service Worker may serve stale `index.html` versions. (Mitigation: Added defensive null-checks in JS to prevent crashes).
- **Inspection Lag**: The "Raw AI Context" viewer displays a snapshot of the last *triggered* request.
