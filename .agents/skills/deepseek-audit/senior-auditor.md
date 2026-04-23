---
name: deepseek-audit
description: Uses the DeepSeek Web Chat (via Browser) to conduct rigorous code audits by interacting with the web interface. This bypasses API credit limits.
---

# DeepSeek Senior Code Auditor (Browser Edition)

## Purpose
Use this skill when the user requests a "code audit", "security review", or "architectural feedback". It uses the browser subagent to interact with the DeepSeek web chat for free, high-reasoning analysis.

## Instructions
1.  **Gather Context**: Identify the GitHub repository URL and branch (e.g., `https://github.com/Alboro26/assemblyai-v3-teleprompter` branch `refactor/audit-cleanup`).
2.  **Prepare the Prompt**:
    - Ask DeepSeek to act as a Senior Software Architect.
    - Provide the GitHub URL and branch.
    - Explicitly ask it to audit for bugs, security (XSS), and architectural patterns.
3.  **Execute via Browser**:
    - Use the `browser_subagent` tool.
    - Navigate to `https://chat.deepseek.com/`.
    - **Crucial**: Ensure "DeepSeek-V3" or "DeepSeek-Reasoner" is selected in the UI.
    - Paste the prompt and wait for the full response.
    - Copy the response text and return it.

4.  **Handoff Protocol**:
    - Summarize the browser findings into "🔴 Critical Issues", "🟡 Improvements", and "🟢 Best Practices".
    - Convert findings into a `task.md` file in the project root.
    - Ask the user for approval to execute.

## Best Practices
- **Paste Code if Necessary**: If the repo is large or the web chat fails to browse, paste the specific file contents (e.g., `StorageService.js`) into the chat as well.
- **Verification**: Verify that the browser actually loaded the content before extracting the report.
