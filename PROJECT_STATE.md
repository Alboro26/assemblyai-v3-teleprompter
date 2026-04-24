# Project State Summary: Interview Teleprompter Modernization

**Last Updated**: 2026-04-24
**Current Status**: Stable / Modernized (Logic & Connectivity)

- **Role-Flexible Merging**: Resolved the "staircase effect" by allowing `neutral` turns to be absorbed into identified speaker turns. Implemented "Role Upgrading" where a neutral entry is claimed by the first identified speaker that merges with it.
- **Defensive UI Initialization**: Patched a critical render-blocking crash in `loadConfig`. The app now gracefully handles missing DOM elements, ensuring the transcript history renders even if the PWA cache is stale.
- **Deterministic Smart Wrapping**: Standardized on audio-timestamp-based merging, eliminating arrival-time jitter.

## Known Issues & Technical Debt
- **Inspection Lag**: The "Raw AI Context" viewer displays a snapshot of the last *triggered* request. If an AI request is cancelled, the viewer displays stale data.
- **Assistant-Aware Merging**: Currently, AI turns always break a human merge chain. We may want to explore allowing merges "through" an AI turn if the gap is small.

## 🛠️ Key Architectural Decisions
- **Audio-Offset Identity**: Using `audioStart` as the deterministic identity for a turn, while keeping `startTime` (system time) for UI sorting and PWA state.
- **Surgical Scroll**: The UI now strictly targets the outer scrollable container (`#transcriptHistory`) for all positioning logic.

## 🚀 Next Steps / Pending
- **Inspector Refactor**: Move the AI Context modal to a "Live Preview" pattern that polls the current history rather than a static snapshot.
- **Diarization Engine Audit**: Perform a stress test on high-frequency speaker switches to verify atomic state transitions.
- **Deployment**: Push `dev-merged` to main and verify PWA caching for the new metadata fields.
