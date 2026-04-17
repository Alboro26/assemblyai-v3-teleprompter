/**
 * js/stt.js - Unified Speech-to-Text Controller
 */

export class STTManager {
  constructor(callbacks = {}) {
    this.assemblyWS = null;
    this.recognition = null;
    this.isPaused = false;
    this.callbacks = callbacks; // onFinal, onInterim, onStatus, onDiarization
    this.audioEngine = null;
    this.scriptProcessor = null;
    this.recogActive = false;
  }

  setAudioEngine(engine) {
    this.audioEngine = engine;
  }

  // --- AssemblyAI (Cloud) ---
  async connectAssembly(apiKey) {
    if (this.assemblyWS) {
        this.assemblyWS.onopen = null;
        this.assemblyWS.onmessage = null;
        this.assemblyWS.onerror = null;
        this.assemblyWS.onclose = null;
        this.assemblyWS.close();
        this.assemblyWS = null;
    }
    this.stopStreaming();
    
    const params = new URLSearchParams({
      token: apiKey,
      speech_model: 'u3-rt-pro',
      sample_rate: '16000',
      speaker_labels: 'true',
      punctuate: 'true',
      format_text: 'true'
    });
    
    this.assemblyWS = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params.toString()}`);
    this.assemblyWS.binaryType = 'arraybuffer';
    
    this.assemblyWS.onopen = () => {
      this.callbacks.onStatus?.('Listening (Cloud)', 'ok');
      this.startStreaming();
    };

    this.assemblyWS.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.error) {
          console.error('[STT] AssemblyAI Error:', msg.error);
          this.callbacks.onStatus?.('Cloud API Error', 'error');
      }
      this.handleAssemblyMessage(msg);
    };

    this.assemblyWS.onclose = (event) => {
      console.log('[STT] WebSocket Closed:', event.code, event.reason);
      this.stopStreaming();
      if (!event.wasClean) {
          this.callbacks.onStatus?.('Cloud Failed (Check Key)', 'error');
      } else {
          this.callbacks.onStatus?.('Cloud Offline', 'warn');
      }
    };

    this.assemblyWS.onerror = (err) => {
      console.error('[STT] WebSocket Connectivity Error:', err);
      this.callbacks.onStatus?.('Cloud Connection Refused', 'error');
    };
  }

  handleAssemblyMessage(msg) {
    if (this.isPaused) return;
    const type = msg.type || msg.message_type;
    
    if (type === 'PartialTranscript' || type === 'Partial') {
      if (msg.text) this.callbacks.onInterim?.(msg.text);
    }
    
    if (type === 'FinalTranscript' || type === 'Final') {
      const text = (msg.text || "").trim();
      if (!text) return;
      const rawLabel = msg.speaker || msg.speaker_label;
      this.callbacks.onFinal?.(text, rawLabel);
    }
  }

  startStreaming() {
    if (!this.audioEngine || !this.assemblyWS) return;
    const { audioCtx, mediaStream } = this.audioEngine;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const src = audioCtx.createMediaStreamSource(mediaStream);
    this.scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (e) => {
      if (this.isPaused || this.assemblyWS.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      this.assemblyWS.send(i16.buffer);
    };
    
    src.connect(this.scriptProcessor);
    this.scriptProcessor.connect(audioCtx.destination);
  }

  stopStreaming() {
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch (_) {}
      this.scriptProcessor = null;
    }
  }

  // --- Browser (Local) ---
  initLocal() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return false;
    
    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    
    this.recognition.onstart = () => { 
      this.recogActive = true; 
      this.callbacks.onStatus?.('Listening (Local)', 'ok');
    };
    this.recognition.onend = () => { 
      this.recogActive = false; 
      if (!this.isPaused) this.safeRestartLocal(); 
    };
    
    this.recognition.onresult = (e) => {
      if (this.isPaused) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          this.callbacks.onFinal?.(res[0].transcript.trim(), 'LOCAL');
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) this.callbacks.onInterim?.(interim);
    };
    
    this.safeRestartLocal();
    return true;
  }

  safeRestartLocal() {
    if (this.recognition && !this.recogActive && !this.isPaused) {
      try { this.recognition.start(); } catch(_) {}
    }
  }

  stopAll() {
    this.isPaused = true;
    if (this.assemblyWS) this.assemblyWS.close();
    if (this.recognition) {
       this.recogActive = false;
       try { this.recognition.stop(); } catch(_) {}
    }
    this.stopStreaming();
  }
}
