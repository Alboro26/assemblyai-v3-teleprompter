/**
 * js/stt.js - Unified Speech-to-Text Controller (PWA + AudioWorklet Edition)
 */

export class STTManager {
  constructor(callbacks = {}) {
    this.assemblyWS = null;
    this.recognition = null;
    this.isPaused = false;
    this.callbacks = callbacks; // onFinal, onInterim, onStatus
    this.audioEngine = null;
    this.recogActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  setAudioEngine(engine) {
    this.audioEngine = engine;
  }

  // --- AssemblyAI (Cloud v3) ---
  async connectAssembly(apiKey) {
    if (this.assemblyWS) {
      this.closeAssembly();
    }
    
    // Build v3 URL with parameters
    const params = new URLSearchParams({
      token: apiKey,
      speech_model: 'u3-rt-pro',
      sample_rate: '16000',
      speaker_labels: 'true',
      punctuate: 'true',
      format_text: 'true',
      encoding: 'pcm_s16le'
    });
    
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
    this.assemblyWS = new WebSocket(wsUrl);
    this.assemblyWS.binaryType = 'arraybuffer';
    
    this.assemblyWS.onopen = () => {
      console.log('[STT] Cloud v3 Connected');
      this.reconnectAttempts = 0;
      this.callbacks.onStatus?.('Listening (Cloud)', 'ok');
      this.startWorkletStreaming();
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
      console.log('[STT] WebSocket Closed:', event.code);
      if (!event.wasClean && !this.isPaused) {
        this.handleReconnection(apiKey);
      } else {
        this.callbacks.onStatus?.('Cloud Offline', 'warn');
      }
    };

    this.assemblyWS.onerror = (err) => {
      console.error('[STT] WebSocket Error:', err);
      this.callbacks.onStatus?.('Connection Error', 'error');
    };
  }

  handleAssemblyMessage(msg) {
    // Reject if paused or if the message is not a 'Turn' event
    if (this.isPaused) return;
    if (msg.type !== 'Turn') return;

    // Extract the new v3 payload structure
    const transcript = msg.transcript || "";
    const isFinal = msg.end_of_turn === true;
    const rawLabel = msg.speaker_label;

    // Log to verify data flow (check browser console after deployment)
    console.log(`[STT] v3 Turn received: end_of_turn=${isFinal}, text="${transcript}", speaker=${rawLabel}`);

    if (!transcript.trim()) return;

    if (!isFinal) {
      // Partial (interim) transcription
      this.callbacks.onInterim?.(transcript);
    } else {
      // Final, formatted transcription for this turn
      this.callbacks.onFinal?.(transcript, rawLabel);
    }
  }

  startWorkletStreaming() {
    if (!this.audioEngine || !this.audioEngine.workletNode) {
      console.warn('[STT] No AudioWorklet found. Falling back to simple init.');
      return;
    }

    // Handle incoming binary PCM from the Worklet
    this.audioEngine.workletNode.port.onmessage = (event) => {
      if (this.isPaused || !this.assemblyWS || this.assemblyWS.readyState !== WebSocket.OPEN) return;
      
      // The event.data is the raw Int16 ArrayBuffer from the worklet
      this.assemblyWS.send(event.data);
    };
  }

  handleReconnection(apiKey) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[STT] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.connectAssembly(apiKey), 2000);
    }
  }

  closeAssembly() {
    if (this.assemblyWS) {
      this.assemblyWS.onclose = null;
      this.assemblyWS.close();
      this.assemblyWS = null;
    }
  }

  // --- Browser (Local) ---
  initLocal() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this.callbacks.onStatus?.('Local STT Not Supported', 'error');
      return false;
    }
    
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
    this.closeAssembly();
    if (this.recognition) {
       this.recogActive = false;
       try { this.recognition.stop(); } catch(_) {}
    }
  }
}
