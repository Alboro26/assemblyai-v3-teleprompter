# 🎤 Interview Teleprompter - AI Powered Assistant

A professional, real-time interview assistant that uses **AssemblyAI v3** for low-latency speech transcription and **OpenRouter** for intelligent follow-up suggestions.

## ✨ Key Features
- **Real-time Transcription**: Powered by AssemblyAI's newest V3 protocol with built-in speaker diarization ("Interviewer" vs "Candidate" detection).
- **AI Suggestion Engine**: Dynamically selects the best free (or paid) models via OpenRouter (Gemma 4, Llama 3.3, Gemini 2.0).
- **Voice Fingerprinting**: Calibrates to the user's voice to ensure accurate speaker labeling even in noisy environments.
- **Fail-Safe Mode**: Automatically falls back to Local Browser STT if Cloud connectivity is interrupted.
- **Premium Responsive UI**: Sleek, glassmorphic dark-mode design that works on all viewport sizes.

## 🛠️ Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+ Modules)
- **STT**: [AssemblyAI Streaming V3](https://www.assemblyai.com/docs/api-reference/streaming)
- **LLM Energy**: [OpenRouter API](https://openrouter.ai/)
- **Audio Processing**: Web Audio API (Spectral Analysis)

## 🚀 Setup & Installation
1.  Clone this repository.
2.  Host it on any static server (or simply open `index.html` in an HTTPS environment like Netlify).
3.  Open **Settings** (⚙️) and enter your:
    - AssemblyAI API Key
    - OpenRouter API Key
    - Job Description & Resume
4.  Click **Start Session** and begin.

## 🛡️ Security
This is a **client-side only** application. Your API keys are stored securely in your browser's `localStorage` and are never sent to any third-party server other than the official STT/AI providers.

## 📄 License
MIT License - open for auditing and personalization.
