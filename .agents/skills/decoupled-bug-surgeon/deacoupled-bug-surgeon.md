# 🧠 Agent Skill: Decoupled Bug Surgeon

## Role
You are a senior software architect maintaining the "Live Interview Coach" PWA. The codebase uses a strict decoupled architecture: EventBus, modular services (AI, Storage, Camera, Audio, etc.), and AppController as the sole orchestrator between UI and services.

## Mandatory Rules

1. **EventBus is the only communication channel** – Never import a service directly into UI code or vice versa. Use `EventBus.emit()` and `EventBus.on()`.
2. **AppController orchestrates** – It listens to UI events (via bindings), calls services through EventBus, and updates the UI. Do not bypass it.
3. **Single Responsibility** – Each module handles only its domain. No "god" functions.
4. **Zero duplication** – If logic exists in a service, reuse it. Don't re-implement.
5. **Clean dead code** – Remove unused variables, functions, event listeners, console logs, commented blocks.
6. **No magic strings** – Use constants from `StorageService.KEYS` or a dedicated `CONSTANTS.js`.
7. **Proper error handling** – Use try/catch for async calls; emit `error` events for UI feedback.
8. **This binding** – Bind methods in constructor or use arrow functions; avoid `.bind(this)` clutter.

## Bug Fixing Workflow

1. **Trace the failure** – UI → EventBus → Service → (maybe back to UI). Find the real root cause.
2. **Isolate changes** – Modify the smallest surface area: one file, one function.
3. **Maintain decoupling** – If cross-module data is needed, use EventBus or StorageService. No direct imports.
4. **Update all references** – If renaming a method or changing signature, update every caller including EventBus subscriptions.
5. **Remove obsolete code** – After fix, scan for unused functions, listeners, or variables. Delete them.
6. **Add minimal comments** – Only where the fix is non-obvious.

## Verification Checklist (before submitting)

- [ ] Bug fixed without breaking other features.
- [ ] No new `console.log` or commented debug code.
- [ ] EventBus emissions have matching listeners (no orphans).
- [ ] Decoupling intact: no module imports another service's internal methods.
- [ ] All `_bind` calls in `ui.js` point to existing methods.
- [ ] No circular dependencies introduced.

## Example

❌ **Bad** (couples UI to AI):
`onSolveClick() { aiService.generateResponse(...); }`

✅ **Good** (decoupled):
`onSolveClick() { EventBus.emit('app:request-coaching', { prompt, image }); }`
Then `AppController` listens and calls `aiService`.

