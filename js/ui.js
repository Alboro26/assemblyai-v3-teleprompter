/**
 * js/ui.js - Main UI Controller & State Management
 */

import { AudioEngine } from './audio.js';
import { STTManager } from './stt.js';
import { AIManager } from './ai.js';
import { CameraManager } from './camera.js';

class AppController {
  constructor() {
    this.state = {
      isPaused: false,
      isAssemblyMode: true,
      isFreeMode: true,
      isHolding: false,
      isCalibrating: false,
      voiceThreshold: 0.60,
      noiseFloorThreshold: 12,
      conversationHistory: [],
      capturedTexts: [],
      userVoiceSignature: JSON.parse(localStorage.getItem('userVoiceSignature') || 'null'),
      matchConfidence: 0,
      selectedFreeModel: localStorage.getItem('selectedFreeModel') || 'google/gemini-2.0-flash-lite-preview-02-05:free',
      selectedPaidModel: localStorage.getItem('selectedPaidModel') || 'google/gemini-2.0-flash-001',
      lastAiTriggerTime: 0,
      speakerMapping: { candidate: null, interviewer: null },
      calibrationComplete: localStorage.getItem('userVoiceSignature') !== null,
      fontSize: parseInt(localStorage.getItem('fontSize')) || 24
    };

    this.aiTimer = null; // For debouncing suggestions
    this.audio = new AudioEngine();
    this.stt = new STTManager({
      onStatus: (text, type) => this.updateStatus(text, type),
      onInterim: (text) => this.handleInterim(text),
      onFinal: (text, rawLabel) => this.handleFinal(text, rawLabel)
    });
    this.ai = new AIManager({
      onStart: () => this.handleAIStart(),
      onResponse: (text) => this.handleAIResponse(text),
      onError: (err) => this.handleAIError(err)
    });
    this.camera = new CameraManager();

    this.stt.setAudioEngine(this.audio);
    this.initEventListeners();
    this.loadConfig();
  }

  initEventListeners() {
    try {
      // Nav & Controls
      this._bind('pauseBtn', 'onclick', () => this.togglePause());
      this._bind('btnSelectAssembly', 'onclick', () => this.setEngine('assembly'));
      this._bind('btnSelectLocal', 'onclick', () => this.setEngine('local'));
      this._bind('modelToggle', 'onchange', () => this.toggleModelMode());

      // Sidebar
      this._bind('btnHideSidebar', 'onclick', () => this.toggleSidebar());

      // Actions
      this._bind('btnSettings', 'onclick', () => this.toggleSettings());

      // Click outside to close settings
      const settingsOverlay = document.getElementById('settingsModal');
      if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
          if (e.target === settingsOverlay) this.toggleSettings(false);
        });
      }

      this._bind('btnClear', 'onclick', () => this.clearHistory());
      this._bind('btnCalibrate', 'onclick', () => this.startCalibration());
      this._bind('btnStartSession', 'onclick', () => this.startSession());
      this._bind('btnInspectContext', 'onclick', () => this.showInspector());
      this._bind('btnSaveSettings', 'onclick', () => this.saveSettings());
      this._bind('btnCancelCalibration', 'onclick', () => this.stopCalibration());

      // Dashboard Grid Controls
      this._bind('btnFontInc', 'onclick', () => this.updateFontSize(1));
      this._bind('btnFontDec', 'onclick', () => this.updateFontSize(-1));

      this._bind('btnVoiceMode', 'onclick', () => this.switchMode('voice'));
      this._bind('btnCodingMode', 'onclick', () => this.switchMode('coding'));
      this._bind('btnCaptureCode', 'onclick', () => this.handleCaptureCode());
      this._bind('btnSolveCode', 'onclick', () => this.handleSolveCode());
      this._bind('btnInspectContext', 'onclick', () => this.showInspector());

      // Hold Button
      const holdBtn = document.getElementById('holdBtn');
      if (holdBtn) {
        holdBtn.addEventListener('mousedown', () => this.setHolding(true));
        holdBtn.addEventListener('mouseup', () => this.setHolding(false));
        holdBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.setHolding(true); });
        holdBtn.addEventListener('touchend', () => this.setHolding(false));
      }

      // Sliders
      this._bind('aiDelay', 'oninput', (e) => {
        const d = document.getElementById('delayDisplay');
        if (d) d.textContent = parseFloat(e.target.value).toFixed(1);
      });
      this._bind('voiceThreshold', 'oninput', (e) => {
        const d = document.getElementById('thresholdDisplay');
        if (d) d.textContent = parseFloat(e.target.value).toFixed(2);
      });
      this._bind('noiseFloor', 'oninput', (e) => {
        const d = document.getElementById('noiseFloorDisplay');
        if (d) d.textContent = e.target.value;
      });
    } catch (e) {
      console.error("Critical UI binding failure:", e);
    }
  }

  _bind(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el[event] = fn;
    else console.warn(`Missing element for binding: ${id}`);
  }

  toggleSidebar() {
    const grid = document.querySelector('.dashboard-grid');
    const btn = document.getElementById('btnHideSidebar');
    if (!grid) return;
    
    const isHidden = grid.classList.toggle('sidebar-hidden');
    if (btn) btn.textContent = isHidden ? 'Show' : 'Hide';
  }

  switchMode(mode) {
      const btnVoice = document.getElementById('btnVoiceMode');
      const btnCoding = document.getElementById('btnCodingMode');
      const telePanel = document.getElementById('teleprompterPanel');
      const camPanel = document.getElementById('cameraPanel');

      if (mode === 'voice') {
          if (btnVoice) btnVoice.classList.add('active');
          if (btnCoding) btnCoding.classList.remove('active');
          if (telePanel) telePanel.style.display = 'flex';
          if (camPanel) camPanel.style.display = 'none';
          this.state.currentMode = 'voice';
          if (this.camera) this.camera.stop();
          this.updateStatus('READY', '');
      } else if (mode === 'coding') {
          if (btnVoice) btnVoice.classList.remove('active');
          if (btnCoding) btnCoding.classList.add('active');
          if (telePanel) telePanel.style.display = 'none';
          if (camPanel) camPanel.style.display = 'flex';
          this.state.currentMode = 'coding';
          if (this.stt) this.stt.stopAll();
          if (this.camera) {
              this.updateStatus('Starting Camera...', '');
              this.camera.start().then(ok => {
                  if(!ok) this.updateStatus('Camera Error', 'error');
                  else this.updateStatus('Camera Active', '');
              });
          }
      }
  }

  updateFontSize(delta) {
      this.state.fontSize = Math.max(12, Math.min(72, this.state.fontSize + delta));
      localStorage.setItem('fontSize', this.state.fontSize);
      const val = this.state.fontSize + 'px';
      this._text('fontSizeDisplay', val);
      document.documentElement.style.setProperty('--teleprompter-size', val);
  }

  async handleCaptureCode() {
      if (this.state.currentMode !== 'coding' || !this.camera) return;
      const btn = document.getElementById('btnCaptureCode');
      if (btn) btn.disabled = true;
      
      const extractedText = await this.camera.captureAndOCR((msg, type) => this.updateStatus(msg, type));
      
      if (btn) btn.disabled = false;

      if (extractedText && extractedText.trim().length > 5) {
          this.state.capturedTexts.push(extractedText);
          this._text('photoCount', this.state.capturedTexts.length);
          const btnSolve = document.getElementById('btnSolveCode');
          if (btnSolve) btnSolve.style.display = 'inline-block';
      } else {
          this.updateStatus('Could not read code. Try again.', 'error');
      }
  }

  async handleSolveCode() {
      if (this.state.capturedTexts.length === 0) return;
      const payloadText = this.state.capturedTexts.join('\n\n--- NEXT PART ---\n\n');
      
      this.state.capturedTexts = []; // reset buffer
      this._text('photoCount', '0');
      const btnSolve = document.getElementById('btnSolveCode');
      if (btnSolve) btnSolve.style.display = 'none';

      const payload = `[CODING CHALLENGE SUBMISSION]\n${payloadText}`;
      // Inject as interviewer context
      this.addTranscriptEntry(payload, 'interviewer', 'CAMERA-OCR');
      // Switch back to voice mode so we can talk and see the generated code.
      this.switchMode('voice');
      this.triggerDelayedAI();
  }

  loadConfig() {
    try {
      this.state.isAssemblyMode = localStorage.getItem('isAssemblyMode') !== 'false';
      this.state.isFreeMode = localStorage.getItem('isFreeMode') === 'true';
      this.state.voiceThreshold = parseFloat(localStorage.getItem('voiceThreshold')) || 0.60;
      this.state.noiseFloorThreshold = parseInt(localStorage.getItem('noiseFloorThreshold')) || 12;
      this.state.aiTriggerDelay = parseFloat(localStorage.getItem('aiTriggerDelay')) || 2.0;

      // Sync UI
      this._val('jobDescription', localStorage.getItem('jobDescription') || '');
      this._val('resumeText', localStorage.getItem('resumeText') || '');

      const mToggle = document.getElementById('modelToggle');
      if (mToggle) {
        mToggle.checked = this.state.isFreeMode;
        this.updateModelToggleUI();
      }

      this._val('aiDelay', this.state.aiTriggerDelay);
      this._text('delayDisplay', this.state.aiTriggerDelay.toFixed(1));
      this._val('voiceThreshold', this.state.voiceThreshold);
      this._text('thresholdDisplay', this.state.voiceThreshold.toFixed(2));
      this._val('noiseFloor', this.state.noiseFloorThreshold);
      this._text('noiseFloorDisplay', this.state.noiseFloorThreshold);

      this._val('freeModel', this.state.selectedFreeModel);
      this._val('paidModel', this.state.selectedPaidModel);
      
      const savedOverride = localStorage.getItem('candidateLabelOverride') || 'auto';
      this._val('candidateLabelOverride', savedOverride);
      if (savedOverride !== 'auto') {
          this.state.speakerMapping.candidate = savedOverride;
      }

      this.updateFontSize(0);
      this.syncEngineUI();
    } catch (e) {
      console.error("Config load error:", e);
    }
  }

  _val(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
  _text(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

  updateModelToggleUI() {
    const mToggle = document.getElementById('modelToggle');
    if (!mToggle) return;
    const isFree = mToggle.checked;
    const lFree = document.getElementById('labelFree');
    const lPaid = document.getElementById('labelPaid');
    if (lFree) lFree.classList.toggle('active', isFree);
    if (lPaid) lPaid.classList.toggle('active', !isFree);
  }

  syncEngineUI() {
    const ba = document.getElementById('btnSelectAssembly');
    const bl = document.getElementById('btnSelectLocal');
    if (ba) ba.classList.toggle('active', this.state.isAssemblyMode);
    if (bl) bl.classList.toggle('active', !this.state.isAssemblyMode);
  }

  async startSession() {
    console.log("Starting session...");

    // Immediate UI feedback: hide overlay first to prevent hangs from blocking the user
    const overlay = document.getElementById('startOverlay');
    if (overlay) overlay.classList.add('hidden');

    const ok = await this.audio.init();
    if (!ok) {
      if (overlay) overlay.classList.remove('hidden'); // Show again if we really can't get mic
      return alert('Microphone access is required for the teleprompter to work.');
    }

    // Explicitly update engine with the new audio context and resume
    this.stt.setAudioEngine(this.audio);
    if (this.audio.audioCtx) {
      this.audio.audioCtx.resume().then(() => {
        console.log("Audio pipeline active.");
        this.setEngine(this.state.isAssemblyMode ? 'assembly' : 'local');
        this.startAnalysisLoop();
      });
    }
  }

  setEngine(mode) {
    // Stop any active STT before switching
    if (this.stt) {
      this.stt.stopAll();
    }

    this.state.isAssemblyMode = (mode === 'assembly');
    localStorage.setItem('isAssemblyMode', this.state.isAssemblyMode);
    this.syncEngineUI();

    if (this.state.isAssemblyMode) {
      this.updateStatus('Connecting Cloud...', '');
      this.stt.connectAssembly();
    } else {
      this.updateStatus('Local Engine Ready', '');
      this.stt.initLocal();
    }
  }

  togglePause() {
    this.state.isPaused = !this.state.isPaused;
    this.stt.isPaused = this.state.isPaused;

    const pb = document.getElementById('pauseBtn');
    const svgPause = document.getElementById('svgPause');
    const svgPlay = document.getElementById('svgPlay');

    if (pb) {
      pb.classList.toggle('active', this.state.isPaused);
      if (svgPause) svgPause.style.display = this.state.isPaused ? 'none' : 'block';
      if (svgPlay) svgPlay.style.display = this.state.isPaused ? 'block' : 'none';
    }

    if (this.state.isPaused) {
      this.updateStatus('PAUSED', '');
      this.stt.stopStreaming();
    } else {
      this.setEngine(this.state.isAssemblyMode ? 'assembly' : 'local');
    }
  }

  startAnalysisLoop() {
    const loop = () => {
      if (this.state.isPaused || this.state.isCalibrating) {
        requestAnimationFrame(loop);
        return;
      }

      const rms = this.audio.getRMS();
      if (rms > this.state.noiseFloorThreshold) {
        const finger = this.audio.getFingerprint();
        if (finger && this.state.userVoiceSignature) {
          const rawMatch = this.audio.compareFingerprint(finger.fp, finger.pitch, this.state.userVoiceSignature);
          const volumeWeight = Math.min(1.0, (rms - this.state.noiseFloorThreshold) / 20);
          this.state.matchConfidence = rawMatch * volumeWeight;
        } else {
          this.state.matchConfidence = 0;
        }
      } else {
        this.state.matchConfidence = 0;
      }

      this.updateDiarizationUI();
      requestAnimationFrame(loop);
    };
    loop();
  }

  updateDiarizationUI() {
    const isCandidate = this.state.isHolding || this.state.matchConfidence > this.state.voiceThreshold;
    const dot = document.getElementById('statusDot');
    const appStatusText = document.getElementById('appStatusText');

    if (dot) dot.style.background = isCandidate ? '#3b82f6' : '#f59e0b';
    if (appStatusText) {
      appStatusText.textContent = isCandidate ? "CANDIDATE" : "INTERVIEWER";
    }
  }

  handleInterim(text) {
    const el = document.getElementById('interimText');
    if (el) el.textContent = text;
  }

  handleFinal(text, rawLabel) {
    console.log("Final STT detected:", text, rawLabel);
    const it = document.getElementById('interimText');
    if (it) it.textContent = '';
    
    // Help calibration identify the correct label
    if (this.state.isCalibrating && rawLabel) {
        this.state.calibrationLabels.push(rawLabel);
    }

    let isCandidate = this.state.isHolding;
    
    if (!isCandidate) {
      if (this.state.isAssemblyMode) {
        // Use smart identity detection
        isCandidate = this.determineSpeakerIdentity(rawLabel);
      } else {
        // LOCAL MODE: Use voice matching exclusively
        if (this.state.userVoiceSignature && this.state.matchConfidence > 0) {
          isCandidate = this.state.matchConfidence > this.state.voiceThreshold;
        } else {
          isCandidate = false;
        }
      }
    }
    
    const role = isCandidate ? 'candidate' : 'interviewer';
    
    // Auto-learn the mapping for the first time if not yet assigned
    if (this.state.isAssemblyMode && rawLabel) {
        if (!this.state.speakerMapping.candidate && isCandidate) {
            this.state.speakerMapping.candidate = rawLabel;
            console.log(`[UI] Learned candidate label: ${rawLabel}`);
        } else if (!this.state.speakerMapping.interviewer && !isCandidate) {
            this.state.speakerMapping.interviewer = rawLabel;
            console.log(`[UI] Learned interviewer label: ${rawLabel}`);
        }
    }

    this.addTranscriptEntry(text, role, rawLabel);

    if (!isCandidate) {
        this.triggerDelayedAI();
    }
  }

  determineSpeakerIdentity(rawLabel) {
    if (!rawLabel) return false;

    // 1. Check manual override/mapping first
    if (this.state.speakerMapping.candidate) {
      return rawLabel === this.state.speakerMapping.candidate;
    }

    // 2. Use voice signature if available and calibration is done
    if (this.state.userVoiceSignature && this.state.calibrationComplete) {
      const isVoiceMatch = this.state.matchConfidence > this.state.voiceThreshold;
      if (isVoiceMatch) {
          // Opportunistically learn this label as candidate
          this.state.speakerMapping.candidate = rawLabel;
          console.log(`[UI] Auto-assigned candidate label from voice match: ${rawLabel}`);
          return true;
      }
    }

    // 3. Fallback: If we haven't identified the candidate yet, 
    // we assume new speakers are interviewers until proven otherwise.
    // This prioritizes triggering the AI.
    return false;
  }

  addTranscriptEntry(text, role, rawLabel) {
    const now = Date.now();
    const history = this.state.conversationHistory;
    
    let lastHumanEntry = null;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'assistant') {
            lastHumanEntry = history[i];
            break;
        }
    }

    const aiRole = role === 'candidate' ? 'user' : 'interviewer';
    const MERGE_THRESHOLD = 5000; // 5 seconds (increased to handle network/processing delays)

    // 1. Auto-Merge Logic
    if (lastHumanEntry && lastHumanEntry.role === aiRole && (now - (lastHumanEntry.timestamp || 0)) < MERGE_THRESHOLD) {
      console.log(`[UI] Auto-merging segment with last message.`);
      lastHumanEntry.content += ' ' + text;
      lastHumanEntry.timestamp = now; // Refresh timestamp

      // Update the DOM instead of creating new
      const hist = document.getElementById('transcriptHistory');
      if (hist && hist.lastElementChild) {
        const idTag = rawLabel || (this.state.isAssemblyMode ? 'CLOUD_MISSING' : 'LOCAL');
        hist.lastElementChild.textContent = `${lastHumanEntry.content} [ID: ${idTag}]`;
        hist.scrollTop = hist.scrollHeight;
      }
      
      // Wipe trailing assistant messages so the context remains contiguous for the final AI trigger
      while (history.length > 0 && history[history.length - 1].role === 'assistant') {
          history.pop();
      }
      return;
    }

    // 2. Standard Entry Path (New Block)
    const entryIndex = history.length;
    this.state.conversationHistory.push({
      role: aiRole,
      content: text,
      timestamp: now
    });

    const p = document.createElement('p');
    p.className = `transcript-entry ${role}`;
    p.dataset.index = entryIndex; // Store index for toggling
    p.onclick = () => this.toggleEntryRole(entryIndex, p);

    const idTag = rawLabel || (this.state.isAssemblyMode ? 'CLOUD_MISSING' : 'LOCAL');
    p.textContent = `${text} [ID: ${idTag}]`;

    const hist = document.getElementById('transcriptHistory');
    if (hist) {
      hist.appendChild(p);
      hist.scrollTop = hist.scrollHeight;
    }
  }

  toggleEntryRole(index, element) {
    const entry = this.state.conversationHistory[index];
    if (!entry) return;

    // Toggle Role Logic
    const oldRole = entry.role;
    const newRole = oldRole === 'user' ? 'interviewer' : 'user';
    const uiRole = newRole === 'user' ? 'candidate' : 'interviewer';

    entry.role = newRole;
    element.className = `transcript-entry ${uiRole}`;
    console.log(`[UI] Toggled message ${index} identity to ${uiRole}`);

    // Refire AI after correction (debounced)
    this.triggerDelayedAI();
  }

  triggerDelayedAI() {
    clearTimeout(this.aiTimer);
    
    // Check for cooldown before scheduling
    const now = Date.now();
    const cooldown = this.state.isFreeMode ? 10000 : 3000;
    const elapsed = now - this.state.lastAiTriggerTime;

    if (elapsed < cooldown) {
        const remaining = Math.round((cooldown - elapsed) / 1000);
        this.updateStatus(`Cooling Down (${remaining}s)`, 'warn');
        return;
    }

    this.updateStatus('Waiting for input...', '');
    this.aiTimer = setTimeout(() => {
      const history = this.state.conversationHistory;
      const last = history.length > 0 ? history[history.length - 1] : null;

      // Only trigger if the CURRENT last message is an interviewer question
      if (last && last.role === 'interviewer') {
          this.state.lastAiTriggerTime = Date.now();
          this.ai.updateHistory(this.state.conversationHistory);
          this.ai.generateResponse(
            localStorage.getItem('jobDescription'),
            localStorage.getItem('resumeText')
          );
      }
    }, 1000); // 1s debounce
  }

  updateStatus(text, type) {
    const appStatusText = document.getElementById('appStatusText');
    const dot = document.getElementById('statusDot');
    if (appStatusText) appStatusText.textContent = text.toUpperCase();
    if (dot) {
      if (type === 'error') dot.style.background = '#ef4444';
      else if (type === 'ok') dot.style.background = '#10b981';
      else if (type === 'warn') dot.style.background = '#f59e0b';
      else dot.style.background = '#475569';
      
      dot.title = text; // Tooltip for full error
    }
  }

  handleAIStart() {
    const appStatus = document.getElementById('appStatus');
    const loader = document.getElementById('loader');
    if (appStatus) appStatus.classList.add('generating');
    if (loader) loader.style.display = 'block';
  }

  handleAIResponse(text) {
    const el = document.getElementById('teleprompterContent');
    if (el) el.innerHTML = text;
    this.state.conversationHistory.push({ role: 'assistant', content: text });

    const appStatus = document.getElementById('appStatus');
    const loader = document.getElementById('loader');
    if (appStatus) appStatus.classList.remove('generating');
    if (loader) loader.style.display = 'none';
  }

  handleAIError(err) {
    this.updateStatus(err, 'error');
    const appStatus = document.getElementById('appStatus');
    const loader = document.getElementById('loader');
    if (appStatus) appStatus.classList.remove('generating');
    if (loader) loader.style.display = 'none';
  }

  // --- Voice Calibration ---
  async startCalibration() {
    if (this.state.isCalibrating) return;
    const ok = await this.audio.init();
    if (!ok) return;

    this.state.isCalibrating = true;
    const overlay = document.getElementById('calibrationOverlay');
    if (overlay) overlay.classList.add('active');

    const bar = document.getElementById('calibrationProgress');
    const timer = document.getElementById('calibrationTimer');
    const samples = [];
    this.state.calibrationLabels = [];
    const DURATION = 10000;
    const start = Date.now();

    const iv = setInterval(() => {
      if (!this.state.isCalibrating) { clearInterval(iv); return; }

      const elapsed = Date.now() - start;
      const remaining = Math.max(0, (DURATION - elapsed) / 1000);
      if (timer) timer.textContent = remaining.toFixed(1) + 's';
      if (bar) bar.style.width = (elapsed / DURATION * 100) + '%';

      if (this.audio.getRMS() > 20) {
        samples.push(this.audio.getFingerprint());
      }

      if (elapsed >= DURATION) {
        clearInterval(iv);
        this.finalizeCalibration(samples);
      }
    }, 50);
  }

  stopCalibration() {
    this.state.isCalibrating = false;
    const overlay = document.getElementById('calibrationOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  finalizeCalibration(samples) {
    this.stopCalibration();
    if (samples.length < 10) return alert('Not enough voice detected. Please speak louder during calibration.');

    const numBins = samples[0].fp.length;
    const avgSpectral = new Array(numBins).fill(0);
    let avgPitch = 0, pCount = 0;

    samples.forEach(s => {
      s.fp.forEach((v, i) => avgSpectral[i] += v);
      if (s.pitch > 0) { avgPitch += s.pitch; pCount++; }
    });

    this.state.userVoiceSignature = {
      signature: avgSpectral.map(v => v / samples.length),
      pitch: pCount > 0 ? avgPitch / pCount : null
    };

    // Lock in the speaker label seen during calibration
    if (this.state.calibrationLabels.length > 0) {
        // Find most frequent label
        const counts = {};
        this.state.calibrationLabels.forEach(l => counts[l] = (counts[l] || 0) + 1);
        const bestLabel = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);

        this.state.speakerMapping.candidate = bestLabel;
        console.log(`[UI] Calibration locked candidate label: ${bestLabel}`);
    }

    this.state.calibrationComplete = true;
    localStorage.setItem('userVoiceSignature', JSON.stringify(this.state.userVoiceSignature));
    alert('Calibration successful! Diarization is now tuned to your voice.');
  }

  // --- Utility Methods ---
  toggleSettings(force) {
    const sm = document.getElementById('settingsModal');
    if (!sm) return;
    if (typeof force === 'boolean') {
      sm.classList.toggle('active', force);
    } else {
      sm.classList.toggle('active');
    }
  }
  toggleModelMode() {
    const mt = document.getElementById('modelToggle');
    if (!mt) return;
    this.state.isFreeMode = mt.checked;
    localStorage.setItem('isFreeMode', this.state.isFreeMode);
    this.ai.setMode(this.state.isFreeMode);
    this.updateModelToggleUI();
  }
  clearHistory() {
    this.state.conversationHistory = [];
    const h = document.getElementById('transcriptHistory');
    if (h) h.innerHTML = '';
    const tc = document.getElementById('teleprompterContent');
    if (tc) tc.innerHTML = '<span class="placeholder-text">Waiting for interviewer...</span>';
  }
  setHolding(val) { this.state.isHolding = val; }

  saveSettings() {
    console.log("Saving settings...");
    const vals = {
      'jobDescription': 'jobDescription',
      'resumeText': 'resumeText',
      'aiTriggerDelay': 'aiDelay',
      'voiceThreshold': 'voiceThreshold',
      'noiseFloorThreshold': 'noiseFloor',
      'selectedFreeModel': 'freeModel',
      'selectedPaidModel': 'paidModel',
      'candidateLabelOverride': 'candidateLabelOverride'
    };

    for (const [storeKey, elId] of Object.entries(vals)) {
      const el = document.getElementById(elId);
      if (el) localStorage.setItem(storeKey, el.value);
    }

    this.state.aiTriggerDelay = parseFloat(localStorage.getItem('aiTriggerDelay'));
    this.state.voiceThreshold = parseFloat(localStorage.getItem('voiceThreshold'));
    this.state.noiseFloorThreshold = parseInt(localStorage.getItem('noiseFloorThreshold'));
    this.state.selectedFreeModel = localStorage.getItem('selectedFreeModel');
    this.state.selectedPaidModel = localStorage.getItem('selectedPaidModel');
    
    const override = localStorage.getItem('candidateLabelOverride');
    if (override && override !== 'auto') {
        this.state.speakerMapping.candidate = override;
    } else {
        this.state.speakerMapping.candidate = null; // Re-learn if set to auto
    }

    this.toggleSettings();
    this.setEngine(this.state.isAssemblyMode ? 'assembly' : 'local');

    // Show toast
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = "Settings Saved";
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }
  }

  showInspector() {
    const recent = this.state.conversationHistory.slice(-50);
    const ic = document.getElementById('inspectorContent');
    if (ic) ic.textContent = JSON.stringify(recent, null, 2);
    const im = document.getElementById('inspectorModal');
    if (im) im.classList.add('active');
  }
}

// Boot the app
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
        .catch(err => console.error('[PWA] Registration failed:', err));
    });
  }
});
