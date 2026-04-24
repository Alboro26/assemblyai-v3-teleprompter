# Senior Auditor Handoff: Interview Teleprompter Stability

## Current Situation
The application is transitioning to the **AssemblyAI v3 (`u3-rt-pro`)** protocol to support low-latency real-time diarization and an "Interim Grey Bubble" feature. While the UI and STT engine are largely stable, we are fighting a **State Synchronization Regression** where corrections in the STT layer are not always perfectly reflected in the AI Suggestion Service.

## Key Regressions (Post-"Grey Bubble" Implementation)

### 1. The Diarization Echo (Speaker-ID Flip)
- **Problem**: AssemblyAI often emits a turn fragment with a default Speaker Label (e.g., Speaker 1 / Orange), then corrects it 100-300ms later to the correct Speaker (e.g., Speaker 0 / Purple).
- **Impact**: This caused "Orange-to-Purple flicker" and, in earlier versions, duplicate bubbles.
- **Current Fix**: Implemented **Turn Staging** (250ms delay) in `stt.js`. If a correction arrives during this window, the initial incorrect turn is never shown.

### 2. Targeted Retraction Failure
- **Problem**: When a correction replaces an old turn, simply `pop()`ing the last message from the history is insufficient because the AI might have already responded, or multiple turns might have occurred.
- **Current Fix**: Implemented **Targeted Retraction** based on unique timestamps. `stt.js` now preserves the original timestamp of a turn throughout its correction lifecycle, and `ui.js` searches the history array for that exact timestamp to perform a surgical `splice`.

### 3. AI Context Drift (Inspection Bug)
- **Problem**: The "Raw AI Context" (Inspection JSON) often shows stale data or incorrect roles (e.g., `role: "user"` instead of mapping to `[Candidate]`).
- **Root Cause**:
    - **Reference Lag**: `ai.js` was lagging behind `ui.js` regarding role naming conventions (magic strings like `'user'` vs `'candidate'`).
    - **Snapshot Stalling**: The `lastRequestContext` in `ai.js` only updates on successful AI triggers. If an Interviewer turn is corrected to a Candidate turn, the AI trigger is cancelled, leaving the Inspection modal showing the "dead" Interviewer turn.

## Architectural Constraints (Decoupled-Bug-Surgeon)
- **EventBus**: All communication between `STTManager`, `AIService`, and `AppController` must remain strictly event-driven.
- **No Magic Strings**: All roles and keys must be sourced from `js/services/Constants.js`.
- **Atomic Operations**: History updates (retract + add) should be treated as a single state transition to avoid race conditions with the AI trigger.

## Open Challenges for the Expert
1.  **Diarization Confidence**: How can we further reduce the 250ms "Staging Window" while still guaranteeing label accuracy?
2.  **Context Synchronization**: How can we ensure the `lastRequestContext` in `ai.js` remains a "Live Preview" of what the AI *would* see, even if a request was cancelled?
3.  **Smart Merging**: Consecutive turns from the same speaker should merge. Currently, AI assistant responses often "break" the merge chain. Should we implement "Role-Skip Merging"?

## Project Resources
- **Repository**: `https://github.com/Alboro26/assemblyai-v3-teleprompter.git`
- **Active Branch**: `dev-merged`

## 4. The Jitter-Proof Merge (Audio-Offset Logic)
- **Problem**: Relying on the *arrival time* of transcript fragments in the UI led to incorrect wrapping if network jitter caused fragments to arrive out of order or with varying delays.
- **Impact**: Breaking human turns into multiple bubbles unnecessarily.
- **Current Fix**: Migrated to **Deterministic Gap Merging**.
  - We now use `audioStart` and `audioEnd` timestamps from the AssemblyAI payload.
  - Merge Condition: `incoming.audioStart - lastHuman.audioEnd < MERGE_THRESHOLD_MS`.
  - This is mathematically stable and immune to arrival jitter.
- **Interleaving Policy**: Added an explicit guard. If an AI `ASSISTANT` turn is present in the history after the last human turn, the merge chain is terminated to ensure conversational clarity.

## 5. The "Frozen Scroll" Regression
- **Problem**: The transcript panel appeared "stuck" at the top of the conversation.
- **Root Cause**: `renderTranscript()` was targeting `#transcriptMessages` (the inner list) for its `scrollTop` assignment, but the actual scrollable container was `#transcriptHistory`.
- **Current Fix**: Surgical correction in `ui.js` to target the outer container and ensuring `handleAIResponse` triggers a scroll-to-bottom upon receiving suggestions.

## Relevant Files & Line Numbers

### 1. [js/stt.js](file:///c:/Users/alber/Desktop/copilot/interview-teleprompter/js/stt.js)
- **Audio Metadata Extraction**: Lines `196-200`, `280-294`
- **Normalization (v3 compatibility)**: Lines `163-172`

### 2. [js/ui.js](file:///c:/Users/alber/Desktop/copilot/interview-teleprompter/js/ui.js)
- **Deterministic Merge (Audio Gap)**: Lines `594-617`
- **Surgical Scroll Fix**: Lines `724-734`
- **AI Response Handling**: Lines `693-710`

### 3. [js/services/Constants.js](file:///c:/Users/alber/Desktop/copilot/interview-teleprompter/js/services/Constants.js)
- **Merge Threshold (1500ms)**: Line `32`
- **Interleaving Policy ('break')**: Line `33`
