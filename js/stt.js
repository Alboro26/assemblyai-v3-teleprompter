import { StorageService } from './services/StorageService.js';
import { EVENTS } from './services/Constants.js';

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

    // Calibration State
    this.isCalibrating = false;
    this.calibrationLabels = [];
    this.calibrationInterval = null;

    // Turn State (AssemblyAI v3)
    this.turnBuffer = '';
    this.recentTurns = []; // History for reconciliation (v3)
    this._stagedTurnTimeout = null;
    this._turnCount = 0;
    this._dominantSpeaker = null;

    // Decoupled Control Listeners
    this.eventBus.on('stt:start-calibration', () => this.startCalibration());
    this.eventBus.on('stt:stop-calibration', () => this.stopCalibration());
    this.eventBus.on('stt:connect', () => this.connect());
    this.eventBus.on('stt:disconnect', () => this.disconnect());
    this.eventBus.on('stt:set-paused', (data) => this.setPaused(data.paused));
    this.eventBus.on('stt:set-engine', (data) => this.setEngine(data.mode, data.connect));
  }

  startCalibration() {
    console.log('[STT] Calibration started...');
    this.calibrationLabels = [];
    this.isCalibrating = true;

    let duration = 10000;
    let elapsed = 0;
    let step = 100;

    if (this.calibrationInterval) clearInterval(this.calibrationInterval);
    this.calibrationInterval = setInterval(() => {
      elapsed += step;
      const remaining = Math.max(0, Math.ceil((duration - elapsed) / 1000));
      const progress = (elapsed / duration) * 100;

      this.eventBus.emit('calibration:progress', {
        remaining,
        progress
      });

      if (elapsed >= duration) {
        this.stopCalibration();
      }
    }, step);
  }

  stopCalibration() {
    if (!this.isCalibrating) return; // Already stopped
    this.isCalibrating = false;
    clearInterval(this.calibrationInterval);

    if (this.calibrationLabels.length === 0) {
      console.warn('[STT] Calibration failed: No speakers detected.');
      this.eventBus.emit('calibration:complete', { label: null });
      return;
    }

    // Identify the most frequent speaker label
    const counts = {};
    this.calibrationLabels.forEach(l => counts[l] = (counts[l] || 0) + 1);
    const winningLabel = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);

    console.log(`[STT] Calibration complete. User Label: ${winningLabel}`, counts);
    this.eventBus.emit('calibration:complete', { label: winningLabel });
    this.calibrationLabels = [];
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
        max_speakers: '2',
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

    const msgType = msg.type || msg.message_type;
    const isTranscript = msgType === 'Turn' || msgType === 'PartialTranscript' || msgType === 'FinalTranscript' || msgType === 'SessionBegins';

    if (!isTranscript) return;

    // Normalize: v3 (u3-rt-pro) often uses 'text' instead of 'transcript'
    const transcript = msg.text || msg.transcript || "";
    const rawLabel = msg.speaker_label || msg.speaker || 'UNKNOWN';

    // If calibrating, capture the label
    if (this.isCalibrating && rawLabel !== undefined && rawLabel !== null) {
      this.calibrationLabels.push(rawLabel);
    }

    if (!transcript.trim()) return;

    // ASSEMBLYAI V3 PROTOCOL HANDLING:
    // PartialTranscript: Interim results for the current fragment.
    // FinalTranscript: Stabilized text for the current fragment (lock into buffer).
    // Turn: The full speaker turn has finished (promote buffer to final).

    if (msgType === 'PartialTranscript') {
      // Show everything stabilized so far + the current moving fragment
      const fullInterim = (this.turnBuffer + " " + transcript).trim();
      this.eventBus.emit(EVENTS.STT_INTERIM, fullInterim);
    }
    else if (msgType === 'FinalTranscript') {
      // Accumulate this fragment into the turn buffer
      this.turnBuffer += (this.turnBuffer ? " " : "") + transcript;
      this.eventBus.emit(EVENTS.STT_INTERIM, this.turnBuffer.trim());
    }
    else if (msgType === 'Turn') {
      const fullTurnText = (msg.transcript || this.turnBuffer || transcript).trim();
      const now = Date.now();
      
      // Extract Audio Timestamps (v3) - Convert seconds to ms
      const audioStart = Math.round((msg.audio_start || 0) * 1000);
      const audioEnd = Math.round((msg.audio_end || 0) * 1000);

      // ADVANCED TURN RECONCILIATION (v2):
      // Check if this turn is a correction/extension of any recent turn.
      let replaceLast = false;
      let matchedTurn = null;

      const cleanNew = fullTurnText.toLowerCase().replace(/[^\w\s]/g, '').trim();

      // Look back through the last 3 turns within a 5-second window
      for (let i = this.recentTurns.length - 1; i >= 0; i--) {
        const prev = this.recentTurns[i];
        if (now - prev.timestamp > 5000) continue;

        const cleanPrev = prev.text.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const similarity = this._getSimilarity(cleanNew, cleanPrev);
        
        // AGGRESSIVE MATCHING (v3):
        // 1. High similarity (>50% word overlap)
        // 2. Inclusion (One contains the other)
        // 3. Shared Prefix (Start with same 2 words) within a short window
        const wordsNew = cleanNew.split(/\s+/);
        const wordsPrev = cleanPrev.split(/\s+/);
        const sharedPrefix = wordsNew.length >= 2 && wordsPrev.length >= 2 && 
                            wordsNew[0] === wordsPrev[0] && wordsNew[1] === wordsPrev[1];

        const isOverlap = similarity > 0.5 || 
                         cleanNew.includes(cleanPrev) || 
                         cleanPrev.includes(cleanNew) ||
                         (sharedPrefix && (now - prev.timestamp < 3000));

        if (isOverlap && cleanPrev.length > 0) {
          console.log(`[STT] Reconciled (v3): "${cleanNew}" vs "${cleanPrev}" (Sim: ${similarity.toFixed(2)}, Prefix: ${sharedPrefix})`);
          replaceLast = true;
          matchedTurn = prev;
          break;
        }
      }

      const finalData = { 
        text: fullTurnText, 
        rawLabel,
        replaceLast,
        originalTimestamp: replaceLast ? matchedTurn.startTime : now,
        audioStart,
        audioEnd
      };

      // TURN STAGING (Anti-Flicker):
      // If this is a brand new turn, wait 200ms to see if a correction/replacement arrives.
      // This prevents the "Yellow then Purple" flicker common in v3.
      // TURN STAGING (Adaptive window based on session maturity)
      if (!replaceLast) {
        this._turnCount++;
        const sessionMaturity = Math.min(this._turnCount / 6, 1.0); // 0→1 over 6 turns
        const baseWindow = 350; 
        const minWindow = 100;
        let windowMs = baseWindow - (baseWindow - minWindow) * sessionMaturity;

        // UNKNOWN label -> Increase window to allow diarization to resolve
        if (rawLabel === 'UNKNOWN' || rawLabel === null) {
          windowMs = Math.max(windowMs * 1.5, 400);
        }

        // UNKNOWN label or same as dominant -> fast-track
        if (rawLabel === 'UNKNOWN' || rawLabel === null || (this._dominantSpeaker && rawLabel === this._dominantSpeaker)) {
          const fastWindow = Math.max(50, windowMs * 0.3);
          if (this._stagedTurnTimeout) clearTimeout(this._stagedTurnTimeout);
          this._stagedTurnTimeout = setTimeout(() => {
            this.eventBus.emit(EVENTS.STT_FINAL, finalData);
            this._stagedTurnTimeout = null;
          }, fastWindow);
        } else {
          // New speaker or unstable session -> full window
          this._dominantSpeaker = rawLabel;
          if (this._stagedTurnTimeout) clearTimeout(this._stagedTurnTimeout);
          this._stagedTurnTimeout = setTimeout(() => {
            this.eventBus.emit(EVENTS.STT_FINAL, finalData);
            this._stagedTurnTimeout = null;
          }, windowMs);
        }
      } else {
        // Replacement turns are emitted immediately to overwrite
        if (this._stagedTurnTimeout) clearTimeout(this._stagedTurnTimeout);
        this.eventBus.emit(EVENTS.STT_FINAL, finalData);
      }

      // Update Reconciliation History
      if (replaceLast && matchedTurn) {
        matchedTurn.label = rawLabel;
        matchedTurn.audioStart = audioStart;
        matchedTurn.audioEnd = audioEnd;
      } else {
        this.recentTurns.push({ 
          text: fullTurnText, 
          startTime: now, 
          timestamp: now, 
          label: rawLabel,
          audioStart,
          audioEnd 
        });
        if (this.recentTurns.length > 5) this.recentTurns.shift();
      }

      this.turnBuffer = ''; 
    }
  }

  /**
   * Jaccard Similarity on word sets
   */
  _getSimilarity(s1, s2) {
    const w1 = s1.split(/\s+/).filter(x => x);
    const w2 = s2.split(/\s+/).filter(x => x);
    if (w1.length === 0 || w2.length === 0) return 0;
    
    const set1 = new Set(w1);
    const set2 = new Set(w2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    return intersection.size / Math.max(set1.size, set2.size);
  }

  startWorkletStreaming() {
    console.log('[STT] Starting Worklet Streaming check...', {
      hasEngine: !!this.audioEngine,
      hasWorklet: !!(this.audioEngine && this.audioEngine.workletNode)
    });

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
          if (this.isCalibrating) this.calibrationLabels.push('LOCAL');
          this.eventBus.emit('stt:final', { text, rawLabel: 'LOCAL' });
        } else {
          interim += res[0].transcript;
          if (this.isCalibrating) this.calibrationLabels.push('LOCAL');
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

  setEngine(mode, connect = true) {
    this.stopAll();
    if (mode === 'assembly') {
      if (connect) this.connectAssembly();
    } else {
      if (connect) this.initLocal();
    }
  }

  connect() {
    this.start();
  }

  disconnect() {
    this.stopAll();
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
