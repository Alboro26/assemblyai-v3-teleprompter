---
name: senior-auditor
description: Formalizes the "Expert-Builder" protocol. The user provides high-reasoning audit text (from DeepSeek Expert), and the agent executes it with 100% precision.
---

# Senior Auditor Protocol (Expert-Builder Edition)

## Purpose
Use this protocol when performing complex architectural changes, security hardening, or refactoring. This method leverages DeepSeek for "Thinking" and Gemini Flash for "Executing," ensuring high reliability with low token cost.

## The Handoff Workflow
1.  **Expert Input**: The user provides the architectural "Master Plan" (usually extracted from DeepSeek Reasoner via API or Web Chat).
2.  **The Builder's Oath**: The agent (Builder) must strictly follow the Expert's recommendations. **Do not over-engineer or deviate** unless a technical blocker is found.
3.  **Task Creation**: The agent must immediately convert the Expert's plan into a `task.md` file in the project root.
4.  **Atomic Execution**:
    - Implement changes one file at a time.
    - Check for syntax/integrity after each major step.
    - Commit and Push frequently to keep the branch stable.

## Best Practices
- **No Browser Loops**: Avoid using the browser subagent for DeepSeek unless explicitly asked; manual copy-paste of the expert text is 100x faster and avoids CAPTCHAs.
- **Precision**: If the Expert provides code snippets, use them exactly.
- **Verification**: Always run `node --check` or equivalent syntax validation before reporting "Done".

## Naming Conventions
- **Events**: Namespace all EventBus events (e.g., `stt:final`, `ai:response`).
- **Services**: Group logical units in `js/services/`.
