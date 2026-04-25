# BUG REPORT: Role Toggle Visual Desynchronization

## 🚩 Basic Info
- **Priority**: High
- **Type**: Visual Desynchronization / State vs. DOM Mismatch
- **Status**: Consistently reproducible in both standard and clean Incognito sessions.

## 🔬 Reproduction Steps
1. Start the Interview Teleprompter application in a standard browser window.
2. Inject or trigger STT to create Interviewer messages (orange styling).
   Example DOM state: `<p class="transcript-entry interviewer" data-index="2" data-speaker="Speaker A">Is this working or not?</p>`
3. Click one of the orange messages to toggle its role to Candidate.
4. Observe the console logs and the UI state.

## 📝 Observable Symptoms
1. **Console Logs Confirm Execution**: 
   The application logs `[UI] Toggled role for entry X: interviewer -> candidate`.
2. **State Updates Successfully**: 
   The UI correctly shows the "LOCKED:A" (or corresponding speaker) badge in the footer. This confirms the internal `toggleEntryRole` logic completes its `updateLearnedLabelUI()` block and assigns the `CANDIDATE` role in state.
3. **DOM Visuals Fail to Update**: 
   Despite the internal state changing and the "LOCKED" badge appearing, the messages belonging to the toggled speaker remain visually styled as Interviewer.
   - The border remains orange (`#f59e0b`).
   - The background maintains the interviewer opacity/color.
   - The text color remains muted.
4. **Persistence Behavior**:
   - A standard hard refresh (`Ctrl + F5` or `Ctrl + Shift + R`) preserves the messages (due to `localStorage` recovery) but the bug persists upon further clicks.
   - The visual failure is consistent and reproducible even in a completely clean Incognito session, proving it is not a stale Service Worker cache issue.

## 🔗 Repository Context
- **Involved Files**:
  - `js/ui.js` (`toggleEntryRole`, `surgicalUpdateEntryRole`, `renderTranscript`)
  - `css/app.css` (`.transcript-entry.interviewer`, `.transcript-entry.candidate`)
  - `service-worker.js` (Caching logic)

## 🪵 Diagnostic State (After Click)
- **Expected DOM**: `<p class="transcript-entry candidate" data-role="candidate" ...>`
- **Observed DOM**: Element retains visual styling of `.transcript-entry.interviewer`.
- **UI Indicators**: "LOCKED:A" is present (indicating `newRole === ROLES.CANDIDATE`).

## 🎯 Audit Goal
Identify why the visual DOM update fails to reflect the internal state change (despite successful execution of the state logic), given that the code explicitly executes class modifications and the issue persists even in clean, cache-free Incognito sessions.
