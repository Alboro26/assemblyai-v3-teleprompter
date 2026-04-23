import { StorageService } from './services/StorageService.js';

export class STTManager {
  /**
   * @param {EventBus} eventBus - The global event bus for decoupled communication.
   */
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.assemblyWS = null;
    this.recognition = null;
    this.isPaused = false;
    this.audioEngine = null;
    this.recogActive = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  startCalibration() {
    console.log('[STT] Calibration started (Stub)');
    // TODO: Implement actual voice fingerprinting logic
  }

  stopCalibration() {
    console.log('[STT] Calibration stopped (Stub)');
    // TODO: Implement actual voice fingerprinting logic
  }

  setAudioEngine(engine) {
    this.audioEngine = engine;
  }

  /**
   * Helper to emit status changes.
   */
  _status(text, type = 'ok') {
    this.eventBus.emit('status:change', { text, type });
  }

  // --- AssemblyAI (Cloud v3) ---
  async connectAssembly() {
    if (this.assemblyWS && this.assemblyWS.readyState === WebSocket.OPEN) {
      console.warn('[STT] WebSocket already open');
      return;
    }
    this.isPaused = false;
    this.closeAssembly();

    try {
      this._status('Authenticating...');
      const res = await fetch('/.netlify/functions/assemblyai-token', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to fetch AssemblyAI token');
      const data = await res.json();
      const token = data.token;

      const params = new URLSearchParams({
        token: token,
        speech_model: 'u3-rt-pro',
        sample_rate: '16000',
        speaker_labels: 'true',
        language_code: 'en',
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
        this._status('Listening (Cloud)', 'ok');
        this.startWorkletStreaming();
      };

      this.assemblyWS.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.error) {
          console.error('[STT] AssemblyAI Error:', msg.error);
          this._status('Cloud API Error', 'error');
        }
        this.handleAssemblyMessage(msg);
      };

      this.assemblyWS.onclose = (event) => {
        if (!event.wasClean && !this.isPaused) {
          this.handleReconnection();
        } else {
          this._status('Cloud Offline', 'warn');
        }
      };

      this.assemblyWS.onerror = (err) => {
        console.error('[STT] WebSocket Error:', err);
        this._status('Connection Error', 'error');
      };
    } catch (err) {
      console.error('[STT] Token fetch error:', err);
      this._status('STT Auth Failed', 'error');
    }
  }

  handleAssemblyMessage(msg) {
    if (this.isPaused) return;
    if (msg.type !== 'Turn') return;

    const transcript = msg.transcript || "";
    const isFinal = msg.end_of_turn === true || msg.message_type === 'FinalTranscript';
    const rawLabel = msg.speaker !== undefined ? msg.speaker : msg.speaker_label;

    if (!transcript.trim()) return;

    if (!isFinal) {
      this.eventBus.emit('stt:interim', transcript);
    } else {
      this.eventBus.emit('stt:final', { text: transcript, rawLabel });
    }
  }

  startWorkletStreaming() {
    if (!this.audioEngine || !this.audioEngine.workletNode) {
      console.warn('[STT] No AudioWorklet found.');
      return;
    }

    this.audioEngine.workletNode.port.onmessage = (event) => {
      if (this.isPaused || !this.assemblyWS || this.assemblyWS.readyState !== WebSocket.OPEN) return;
      this.assemblyWS.send(event.data);
    };
  }

  handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[STT] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.connectAssembly(), 2000);
    } else {
      this._status('Reconnection Failed', 'error');
    }
  }

  closeAssembly() {
    if (this.assemblyWS) {
      this.assemblyWS.onclose = null;
      this.assemblyWS.close();
      this.assemblyWS = null;
    }
    if (this.audioEngine && this.audioEngine.workletNode) {
      this.audioEngine.workletNode.port.onmessage = null;
    }
  }

  // --- Browser (Local) ---
  initLocal() {
    this.isPaused = false;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this._status('Local STT Not Supported', 'error');
      return false;
    }

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onstart = () => {
      this.recogActive = true;
      this._status('Listening (Local)', 'ok');
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
          const text = res[0].transcript.trim();
          this.eventBus.emit('stt:final', { text, rawLabel: 'LOCAL' });
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) this.eventBus.emit('stt:interim', interim);
    };

    this.safeRestartLocal();
    return true;
  }

  safeRestartLocal() {
    if (this.recognition && !this.recogActive && !this.isPaused) {
      try { this.recognition.start(); } catch (_) { }
    }
  }

  setPaused(paused) {
    this.isPaused = paused;
    if (paused) this.stopAll();
  }

  setEngine(mode) {
    this.stopAll();
    if (mode === 'assembly') {
      this.connectAssembly();
    } else {
      this.initLocal();
    }
  }

  start() {
    const isAssembly = StorageService.get(StorageService.KEYS.IS_ASSEMBLY_MODE, true);
    this.setEngine(isAssembly ? 'assembly' : 'local');
  }

  stopAll() {
    this.closeAssembly();
    if (this.recognition) {
      this.recogActive = false;
      try { this.recognition.stop(); } catch (_) { }
    }
  }
}
