import { AudioEngine } from './audio.js';
import { STTManager } from './stt.js';
import { AIService } from './ai.js';
import { ToastService } from './services/ToastService.js';
import { CameraManager } from './camera.js';
import { StorageService } from './services/StorageService.js';
import { EventBus } from './services/EventBus.js';
import { ModelManager } from './services/ModelManager.js';
import { ROLES, APP_CONFIG, EVENTS } from './services/Constants.js';

/**
 * Safely renders Markdown to HTML with XSS protection.
 */
function renderMarkdownSafely(markdown, fallbackText = '') {
  if (!window.marked) return fallbackText;
  const rawHtml = marked.parse(markdown);
  if (window.DOMPurify) {
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'code', 'pre', 'h3', 'h4', 'blockquote', 'span'],
      ALLOWED_ATTR: []
    });
  }
  console.warn('DOMPurify not loaded; using plain text fallback.');
  return fallbackText;
}

class AppController {
  constructor() {
    // 1. Foundation
    StorageService.migrate();
    this.eventBus = new EventBus();
    this.modelManager = new ModelManager();

    // 2. State
    this.state = {
      isPaused: false,
      isAssemblyMode: StorageService.get(StorageService.KEYS.IS_ASSEMBLY_MODE, true),
      isFreeMode: StorageService.get(StorageService.KEYS.IS_FREE_MODE, true),
      isCalibrating: false,
      voiceThreshold: StorageService.get(StorageService.KEYS.VOICE_THRESHOLD, 0.60),
      noiseFloorThreshold: StorageService.get(StorageService.KEYS.NOISE_FLOOR_THRESHOLD, 12),
      conversationHistory: StorageService.get(StorageService.KEYS.CONVERSATION_HISTORY, []),
      capturedImages: [],
      userVoiceSignature: StorageService.get(StorageService.KEYS.USER_VOICE_SIGNATURE, null),
      matchConfidence: 0,
      selectedFreeModel: StorageService.get(StorageService.KEYS.SELECTED_FREE_MODEL, 'google/gemini-2.0-flash-lite-preview-02-05:free'),
      selectedPaidModel: StorageService.get(StorageService.KEYS.SELECTED_PAID_MODEL, 'google/gemini-2.0-flash-001'),
      lastAiTriggerTime: 0,
      speakerMapping: { candidate: null, interviewer: null },
      learnedCandidateLabel: null,
      calibrationComplete: StorageService.get(StorageService.KEYS.USER_VOICE_SIGNATURE, null) !== null,
      fontSize: StorageService.get(StorageService.KEYS.FONT_SIZE, 24),
      mergeThreshold: StorageService.get(StorageService.KEYS.MERGE_THRESHOLD, 2.0),
      lastStatusType: 'ok',
      currentMode: 'voice', // Default mode
      lastCapturedImage: null, // Buffer for multimodal AI
      isCandidateSpeaking: false,
      pendingSuggestion: null
    };

    // 3. Services
    this.ai = new AIService(this.eventBus);
    this.toast = new ToastService(this.eventBus);
    this.audio = new AudioEngine(this.eventBus);
    this.stt = new STTManager(this.eventBus);
    this.camera = new CameraManager(document.getElementById('cameraFeed'), this.eventBus);

    // 4. Wire up Event Bus
    this._unsubscribers = [];
    this.setupSubscriptions();

    this.init();
  }

  setupSubscriptions() {
    const unsub = [
      this.eventBus.on(EVENTS.STT_INTERIM, (text) => this.handleInterim(text)),
      this.eventBus.on(EVENTS.STT_FINAL, data => this.handleFinalTranscript(data)),
      this.eventBus.on('calibration:complete', data => this.stopCalibration(null, data.label)),
      this.eventBus.on('calibration:progress', data => this.updateCalibrationProgress(data)),
      this.eventBus.on(EVENTS.AI_RESPONSE, text => this.handleAIResponse(text)),
      this.eventBus.on(EVENTS.AI_CONTEXT_DATA, data => this.displayInspector(data)),
      this.eventBus.on(EVENTS.STATUS_CHANGE, (status) => this.updateStatus(status.type, status.text))
    ];
    this._unsubscribers.push(...unsub);
  }

  destroy() {
    this.audio?.stop();
    this.stt?.stopAll();
    this.camera?.stop();
    this._unsubscribers.forEach(fn => fn());
    this._unsubscribers = [];
  }

  async init() {
    this.initEventListeners();
    this.loadConfig();
    this.updateStatus('ok', 'Ready');

    // Parallelize: Don't block UI/Audio on model fetch
    this.modelManager.fetchModels().then(() => {
      this.populateModelDropdowns();
    }).catch(err => {
      console.warn('[UI] Model fetch failed during init:', err);
    });

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .then(() => console.log('[PWA] Service Worker registered'))
        .catch(err => console.error('[PWA] SW registration failed:', err));
    }
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
      this._bind('btnCalibrate', 'onclick', (e) => {
        if (e) e.stopPropagation();
        this.startCalibration();
      });
      this._bind('btnStartSession', 'onclick', async () => await this.startSession());
      this._bind('btnInspectContext', 'onclick', () => this.showInspector());
      this._bind('btnSaveSettings', 'onclick', () => this.saveSettings());
      this._bind('btnCancelCalibration', 'onclick', () => this.stopCalibration());

      // Immediate persistence for model selections
      this._bind('freeModel', 'onchange', (e) => {
        this.state.selectedFreeModel = e.target.value;
        StorageService.set(StorageService.KEYS.SELECTED_FREE_MODEL, e.target.value);
      });
      this._bind('paidModel', 'onchange', (e) => {
        this.state.selectedPaidModel = e.target.value;
        StorageService.set(StorageService.KEYS.SELECTED_PAID_MODEL, e.target.value);
      });

      // Dashboard Grid Controls
      this._bind('btnFontInc', 'onclick', () => this.updateFontSize(1));
      this._bind('btnFontDec', 'onclick', () => this.updateFontSize(-1));

      this._bind('btnVoiceMode', 'onclick', () => this.switchMode('voice'));
      this._bind('btnCodingMode', 'onclick', () => this.switchMode('coding'));
      this._bind('btnHudCapture', 'onclick', () => this.handleCaptureCode());
      this._bind('btnHudSolve', 'onclick', () => this.handleSolveCode());
      this._bind('btnHudToggle', 'onclick', () => this.cycleHudLayout());

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
      this._bind('mergeThreshold', 'oninput', (e) => {
        const d = document.getElementById('mergeThresholdDisplay');
        if (d) d.textContent = parseFloat(e.target.value).toFixed(1);
      });
    } catch (e) {
      console.error("Critical UI binding failure:", e);
    }
  }

  _bind(id, event, fn) {
    const el = document.getElementById(id);
    if (el) {
      el[event] = fn;
    } else {
      console.warn(`[UI] Optional binding skipped: ${id} not in DOM`);
    }
  }

  populateModelDropdowns() {
    const freeSel = document.getElementById('freeModel');
    const paidSel = document.getElementById('paidModel');
    if (!freeSel || !paidSel) return;

    // Clear
    freeSel.innerHTML = '';
    paidSel.innerHTML = '';

    const addOptions = (models, selectEl) => {
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        selectEl.appendChild(opt);
      });
    };

    addOptions(this.modelManager.getFreeModels(), freeSel);
    addOptions(this.modelManager.getPaidModels(), paidSel);

    // Restore selections
    freeSel.value = this.state.selectedFreeModel;
    paidSel.value = this.state.selectedPaidModel;
  }

  loadConfig() {
    try {
      const mode = StorageService.get(StorageService.KEYS.IS_ASSEMBLY_MODE, true);
      this.setEngine(mode ? 'assembly' : 'local', false, false);

      const freeMode = StorageService.get(StorageService.KEYS.IS_FREE_MODE, true);
      const toggle = document.getElementById('modelToggle');
      if (toggle) toggle.checked = !freeMode;
      this.toggleModelMode(false);

      const jobDesc = document.getElementById('jobDescription');
      if (jobDesc) jobDesc.value = StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, '');
      
      const resume = document.getElementById('resumeText');
      if (resume) resume.value = StorageService.get(StorageService.KEYS.RESUME_TEXT, '');
      
      const aiDelay = document.getElementById('aiDelay');
      if (aiDelay) aiDelay.value = this.state.aiTriggerDelay || 2.0;
      
      const vThresh = document.getElementById('voiceThreshold');
      if (vThresh) vThresh.value = this.state.voiceThreshold;
      
      const nFloor = document.getElementById('noiseFloor');
      if (nFloor) nFloor.value = this.state.noiseFloorThreshold;

      const mergeEl = document.getElementById('mergeThreshold');
      if (mergeEl) mergeEl.value = this.state.mergeThreshold || 1.5;

      this.updateFontSize(0);
      this.updateCalibrationUI();
      this.updateLearnedLabelUI();

      const candidateLabel = StorageService.get(StorageService.KEYS.CANDIDATE_LABEL_OVERRIDE, 'auto');
      const candSel = document.getElementById('candidateSpeaker');
      if (candSel) candSel.value = candidateLabel;

      this.renderTranscript();
    } catch (e) {
      console.error("Config load error:", e);
    }
  }

  saveSettings() {
    this.state.aiTriggerDelay = parseFloat(document.getElementById('aiDelay').value);
    this.state.voiceThreshold = parseFloat(document.getElementById('voiceThreshold').value);
    this.state.noiseFloorThreshold = parseInt(document.getElementById('noiseFloor').value);

    StorageService.set(StorageService.KEYS.JOB_DESCRIPTION, document.getElementById('jobDescription').value);
    StorageService.set(StorageService.KEYS.RESUME_TEXT, document.getElementById('resumeText').value);
    StorageService.set(StorageService.KEYS.VOICE_THRESHOLD, this.state.voiceThreshold);
    StorageService.set(StorageService.KEYS.NOISE_FLOOR_THRESHOLD, this.state.noiseFloorThreshold);
    this.state.mergeThreshold = parseFloat(document.getElementById('mergeThreshold').value);
    StorageService.set(StorageService.KEYS.MERGE_THRESHOLD, this.state.mergeThreshold);

    const candSel = document.getElementById('candidateSpeaker');
    if (candSel) {
      StorageService.set(StorageService.KEYS.CANDIDATE_LABEL_OVERRIDE, candSel.value);
    }

    this.toggleSettings(false);
    this.eventBus.emit('ui:show-toast', { message: 'Settings Saved' });
  }

  updateStatus(type, text) {
    this.state.lastStatusType = type;
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    if (dot) {
      dot.className = `status-dot ${type}`;
      // Add pulse animation for active states
      if (type === 'loading' || type === 'ok') {
        dot.classList.add('pulse');
      }
    }
    if (label) label.textContent = text.toUpperCase();
  }

  togglePause() {
    this.state.isPaused = !this.state.isPaused;
    const svgPause = document.getElementById('svgPause');
    const svgPlay = document.getElementById('svgPlay');

    if (svgPause) svgPause.style.display = this.state.isPaused ? 'none' : 'block';
    if (svgPlay) svgPlay.style.display = this.state.isPaused ? 'block' : 'none';

    const btn = document.getElementById('pauseBtn');
    if (btn) {
      btn.setAttribute('aria-label', this.state.isPaused ? 'Resume transcript' : 'Pause transcript');
    }

    this.eventBus.emit('stt:set-paused', { paused: this.state.isPaused });
    this.updateStatus('ok', this.state.isPaused ? 'Paused' : 'Resumed');
  }

  setEngine(mode, notify = true, connect = true) {
    this.state.isAssemblyMode = (mode === 'assembly');
    StorageService.set(StorageService.KEYS.IS_ASSEMBLY_MODE, this.state.isAssemblyMode);

    const btnA = document.getElementById('btnSelectAssembly');
    const btnL = document.getElementById('btnSelectLocal');
    if (btnA) btnA.classList.toggle('active', this.state.isAssemblyMode);
    if (btnL) btnL.classList.toggle('active', !this.state.isAssemblyMode);

    this.eventBus.emit('stt:set-engine', { mode, connect });
    if (notify) this.updateStatus('ok', `Engine: ${mode}`);
  }

  toggleModelMode(notify = true) {
    const toggle = document.getElementById('modelToggle');
    this.state.isFreeMode = !toggle.checked;
    StorageService.set(StorageService.KEYS.IS_FREE_MODE, this.state.isFreeMode);

    const labelPaid = document.getElementById('labelPaid');
    const labelFree = document.getElementById('labelFree');
    if (labelPaid) labelPaid.classList.toggle('active', !this.state.isFreeMode);
    if (labelFree) labelFree.classList.toggle('active', this.state.isFreeMode);

    this.eventBus.emit('ai:set-mode', { isFree: this.state.isFreeMode });
    if (notify) this.updateStatus('ok', this.state.isFreeMode ? 'Free Mode' : 'Paid Mode');
  }

  toggleSettings(show) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    const isVisible = (show !== undefined) ? show : !modal.classList.contains('active');
    modal.classList.toggle('active', isVisible);
    console.log(`[UI] Settings panel ${isVisible ? 'opened' : 'closed'}`);
  }

  switchMode(mode) {
    this.state.currentMode = mode;
    const voiceBtn = document.getElementById('btnVoiceMode');
    const codingBtn = document.getElementById('btnCodingMode');
    const telePanel = document.getElementById('teleprompterPanel');
    const cameraPanel = document.getElementById('cameraPanel');

    if (voiceBtn) voiceBtn.classList.toggle('active', mode === 'voice');
    if (codingBtn) codingBtn.classList.toggle('active', mode === 'coding');

    if (mode === 'voice') {
      this.eventBus.emit('camera:stop');
      if (cameraPanel) cameraPanel.style.display = 'none';
      if (telePanel) telePanel.style.display = 'block';
    } else {
      this.eventBus.emit('camera:start');
      if (cameraPanel) cameraPanel.style.display = 'block';
      if (telePanel) telePanel.style.display = 'none';
    }

    this.updateStatus('ok', `Mode: ${mode.toUpperCase()}`);
  }

  showInspector() {
    const jobDesc = document.getElementById('jobDescription')?.value || '';
    const resumeText = document.getElementById('resumeText')?.value || '';
    this.eventBus.emit('ai:get-last-context', { jobDesc, resumeText });
  }

  displayInspector(context) {
    const modal = document.getElementById('inspectorModal');
    const content = document.getElementById('inspectorContent');

    if (modal && content) {
      // Deep clone and filter system prompt for display clarity
      const displayContext = JSON.parse(JSON.stringify(context));
      if (displayContext.messages) {
        displayContext.messages = displayContext.messages.filter(m => m.role !== 'system');
      }

      content.textContent = JSON.stringify(displayContext, null, 2);
      modal.classList.add('active');
    }
  }

  toggleSidebar() {
    const grid = document.querySelector('.dashboard-grid');
    const btn = document.getElementById('btnHideSidebar');
    if (grid) {
      const isHidden = grid.classList.toggle('sidebar-hidden');
      if (btn) {
        btn.classList.toggle('collapsed', isHidden);
        const label = isHidden ? 'Show Sidebar' : 'Hide Sidebar';
        btn.title = label;
        btn.setAttribute('aria-label', label);
      }
      console.log(`[UI] Sidebar ${isHidden ? 'hidden' : 'shown'}`);
    }
  }

  updateFontSize(delta) {
    this.state.fontSize = Math.max(12, Math.min(48, this.state.fontSize + delta));
    StorageService.set(StorageService.KEYS.FONT_SIZE, this.state.fontSize);

    const elements = [
      'transcriptHistory',
      'teleprompterContent',
      'hudSolutionContent',
      'hudChatMessages'
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.fontSize = `${this.state.fontSize}px`;
    });

    const display = document.getElementById('fontSizeDisplay');
    if (display) display.textContent = `${this.state.fontSize}px`;
  }

  clearHistory() {
    if (confirm('Clear all conversation history?')) {
      this.state.conversationHistory = [];
      StorageService.remove(StorageService.KEYS.CONVERSATION_HISTORY);
      this.renderTranscript();
      this.eventBus.emit(EVENTS.AI_UPDATE_HISTORY, { history: [] });
      this.eventBus.emit(EVENTS.UI_SHOW_TOAST, { message: 'History Cleared' });
    }
  }

  startCalibration() {
    this.state.isCalibrating = true;
    this.state.learnedCandidateLabel = null;
    StorageService.remove(StorageService.KEYS.CANDIDATE_LABEL_OVERRIDE);
    this.updateLearnedLabelUI();

    const modal = document.getElementById('calibrationOverlay');
    if (modal) {
      modal.classList.add('active');
      // Reset UI elements
      const bar = document.getElementById('calibrationProgress');
      const timer = document.getElementById('calibrationTimer');
      if (bar) bar.style.width = '0%';
      if (timer) timer.textContent = '10s';
    }

    this.eventBus.emit('stt:start-calibration');
  }

  stopCalibration(signature = null, detectedLabel = null) {
    if (!this.state.isCalibrating) return; // Guard against recursion

    this.state.isCalibrating = false;
    const modal = document.getElementById('calibrationOverlay');
    if (modal) {
      modal.classList.remove('active');
    }

    if (signature || detectedLabel) {
      this.state.userVoiceSignature = signature;
      this.state.calibrationComplete = true;
      if (signature) StorageService.set(StorageService.KEYS.USER_VOICE_SIGNATURE, signature);

      if (detectedLabel) {
        StorageService.set(StorageService.KEYS.CANDIDATE_LABEL_OVERRIDE, String(detectedLabel).trim());
      }

      this.updateCalibrationUI();
      this.updateStatus('ok', 'Calibration Complete');
    } else {
      // Only call service if this stop was triggered by UI/User
      this.eventBus.emit('stt:stop-calibration');
    }
  }

  updateCalibrationProgress(data) {
    const bar = document.getElementById('calibrationProgress');
    const timer = document.getElementById('calibrationTimer');
    if (bar) bar.style.width = `${data.progress}%`;
    if (timer) timer.textContent = `${data.remaining}s`;
  }

  updateCalibrationUI() {
    const btn = document.getElementById('btnCalibrate');
    if (btn) {
      btn.textContent = this.state.calibrationComplete ? 'Recalibrate Voice' : 'Calibrate Voice';
      btn.classList.toggle('complete', this.state.calibrationComplete);
    }
  }

  updateLearnedLabelUI() {
    const container = document.getElementById('learnedLabelContainer');
    const valueEl = document.getElementById('learnedLabelValue');
    if (container && valueEl) {
      if (this.state.learnedCandidateLabel) {
        valueEl.textContent = `Speaker ${this.state.learnedCandidateLabel.toUpperCase()}`;
        container.style.display = 'block';
      } else {
        container.style.display = 'none';
      }
    }
  }

  async startSession() {
    this.updateStatus('loading', 'Initializing Audio...');

    // 1. Initialize the audio pipeline (mic, AudioContext, Worklet)
    const ok = await this.audio.init();
    if (!ok) {
      this.updateStatus('error', 'Microphone access denied');
      return;
    }

    // 2. Bridge: hand the initialized engine to STTManager
    console.log('[UI] Bridging Audio Engine...', { hasWorklet: !!this.audio.workletNode });
    this.stt.setAudioEngine(this.audio);

    // 3. Now start transcription
    this.stt.start();
    this.updateStatus('ok', 'Session Started');

    // 4. Dismiss the start screen
    const overlay = document.getElementById('startOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  handleInterim(text) {
    const el = document.getElementById('interimText');
    if (el) {
      el.textContent = text;
      el.style.display = text.trim() ? 'block' : 'none';
      // Surgical scroll
      const container = document.getElementById('transcriptHistory');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }

  handleFinalTranscript(data) {
    const { text, rawLabel } = data;
    const history = this.state.conversationHistory;
    const el = document.getElementById('interimText');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }

    const now = data.originalTimestamp || Date.now();

    // Improved Role Identification
    const candidateLabel = StorageService.get(StorageService.KEYS.CANDIDATE_LABEL_OVERRIDE, 'auto');
    let role = ROLES.INTERVIEWER;

    if (rawLabel !== undefined && rawLabel !== null && rawLabel !== 'UNKNOWN') {
      const sRaw = String(rawLabel).toLowerCase().replace(/speaker\s*/, '').trim();

      // 1. Check explicit setting
      if (candidateLabel !== 'auto') {
        const sCand = String(candidateLabel).toLowerCase().replace(/speaker\s*/, '').trim();
        if (sRaw === sCand) role = ROLES.CANDIDATE;
      }
      // 2. Check session-learned label
      else if (this.state.learnedCandidateLabel === sRaw) {
        role = ROLES.CANDIDATE;
      }
    } else {
      // 📌 Stage as NEUTRAL – awaiting speaker confirmation
      role = ROLES.NEUTRAL;
    }

    const aiRole = role; 
    console.log(`[UI] Classification: raw=${rawLabel} -> role=${aiRole} (learned=${this.state.learnedCandidateLabel})`);

    // DIARIZATION CORRECTION (Targeted Retraction): 
    // If STT detected an overlap/correction, remove the specific turn being replaced.
    if (data.replaceLast && history.length > 0) {
      // Search for the specific turn matching the immutable startTime
      const index = history.findIndex(e => e.startTime === data.originalTimestamp);
      if (index !== -1) {
        const removed = history.splice(index, 1)[0];
        console.log(`[UI] Correcting diarization: Removed targeted turn "${removed.content.substring(0, 20)}..."`);
      } else {
        console.warn(`[UI] Correction target not found (TS: ${data.originalTimestamp}) – preserving history to prevent duplicates.`);
      }
    }

    // SMART MERGE LOGIC (Deterministic Gap Merging)
    let lastHumanEntry = null;
    let lastHumanIndex = -1;

    // 1. Find the last human entry
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role !== ROLES.ASSISTANT) {
        lastHumanEntry = history[i];
        lastHumanIndex = i;
        break;
      }
    }

    // 2. Check for Interleaving Policy ('break')
    let aiInterleaved = false;
    if (lastHumanIndex !== -1 && APP_CONFIG.INTERLEAVING_POLICY === 'break') {
      for (let i = lastHumanIndex + 1; i < history.length; i++) {
        if (history[i].role === ROLES.ASSISTANT) {
          aiInterleaved = true;
          break;
        }
      }
    }

    // 3. Deterministic Merge Decision (Hybrid Gap Detection)
    const mergeThreshold = this.state.mergeThreshold * 1000 || APP_CONFIG.MERGE_THRESHOLD_MS;
    let effectiveGap = null;
    let shouldMerge = false;

    if (data.audioStart > 0 && lastHumanEntry.audioEnd > 0) {
      effectiveGap = data.audioStart - lastHumanEntry.audioEnd;
    } else {
      // Fallback to system time difference (safe for zeroed STT timestamps)
      effectiveGap = now - lastHumanEntry.lastUpdate;
    }

    if (effectiveGap === null) effectiveGap = Infinity;

    // --- Merge decision ---
    let mergeAllowed = false;
    if (lastHumanEntry && !aiInterleaved && effectiveGap <= mergeThreshold) {
      // Role-specific thresholds: Stricter for unidentified (neutral) turns
      if (aiRole === ROLES.NEUTRAL || lastHumanEntry.role === ROLES.NEUTRAL) {
        mergeAllowed = (effectiveGap <= (APP_CONFIG.MERGE_NEUTRAL_THRESHOLD || 500));
      } else {
        // Identified roles: Merge if they match
        mergeAllowed = (lastHumanEntry.role === aiRole);
      }
    }

    if (mergeAllowed) {
      console.log(`[UI] Deterministic Merge: Gap=${effectiveGap}ms | Role Upgrade: ${lastHumanEntry.role}->${aiRole}`);
      
      const originalStart = lastHumanEntry.startTime; // PRESERVE IMMUTABLE IDENTITY
      lastHumanEntry.content += ' ' + text;
      lastHumanEntry.audioEnd = data.audioEnd;
      lastHumanEntry.lastUpdate = now;
      lastHumanEntry.startTime = originalStart;

      // "Claim" the neutral turn: If we merged an identified role into a neutral turn, 
      // or vice-versa, upgrade the entry to the identified role.
      if (lastHumanEntry.role === ROLES.NEUTRAL && aiRole !== ROLES.NEUTRAL) {
        lastHumanEntry.role = aiRole;
      }
      
      shouldMerge = true;
    } else {
      console.log(`[UI] Finalizing: Creating new entry for ${aiRole} (Gap: ${effectiveGap}ms)`);
      this.state.conversationHistory.push({
        role: aiRole,
        content: text,
        startTime: now,     // Immutable identity (system time for ID)
        audioStart: data.audioStart, // Deterministic identity (audio time)
        audioEnd: data.audioEnd,
        lastUpdate: now,    // Mutable merge window
        rawLabel: rawLabel
      });
    }

    // PRUNING: Keep history manageable (limit 50)
    if (this.state.conversationHistory.length > APP_CONFIG.HISTORY_LIMIT) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-APP_CONFIG.HISTORY_LIMIT);
    }

    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.eventBus.emit(EVENTS.AI_UPDATE_HISTORY, { history: this.state.conversationHistory });

    // 4. SMART AI TRIGGER: Determine if we should ask for a suggestion
    const finalEntry = shouldMerge ? lastHumanEntry : history[history.length - 1];
    
    const shouldTriggerAI = (
      (finalEntry.role === ROLES.INTERVIEWER) ||
      (finalEntry.role === ROLES.NEUTRAL && history.some(e => e.role === ROLES.INTERVIEWER))
    );

    if (shouldTriggerAI) {
      this.requestAISuggestion();
    } else if (finalEntry.role === ROLES.NEUTRAL) {
      console.log('[UI] Standalone neutral turn - inhibiting AI suggestion');
    }

    // 5. SPEAKER TRACKING: Handle DOM Persistence and Credit Protection
    if (finalEntry.role === ROLES.CANDIDATE) {
      this.state.isCandidateSpeaking = true;
      
      // Start credit-protection timer: Abort if candidate talks for a very long time
      if (!this._candidateSpeechAbortTimer) {
        this._candidateSpeechAbortTimer = setTimeout(() => {
          this.eventBus.emit(EVENTS.AI_ABORT);
          console.log('[UI] Aborted AI suggestion due to long candidate speech (Credit protection)');
          this._candidateSpeechAbortTimer = null;
        }, APP_CONFIG.ABORT_AFTER_CANDIDATE_SPEECH_MS || 15000);
      }
    } else {
      this.state.isCandidateSpeaking = false;
      if (this._candidateSpeechAbortTimer) {
        clearTimeout(this._candidateSpeechAbortTimer);
        this._candidateSpeechAbortTimer = null;
      }
      
      // Apply pending suggestion if one arrived while candidate was speaking
      if (this.state.pendingSuggestion) {
        console.log('[UI] Applying pending suggestion (Candidate finished speaking)');
        this.applyAIResponse(this.state.pendingSuggestion);
        this.state.pendingSuggestion = null;
      }
    }

    // Auto-scroll history
    const container = document.getElementById('transcriptHistory');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  requestAISuggestion() {
    // Debounce to prevent rapid-fire requests during merging
    if (this._aiTriggerTimeout) clearTimeout(this._aiTriggerTimeout);

    this._aiTriggerTimeout = setTimeout(() => {
      const jobDesc = document.getElementById('jobDescription').value;
      const resumeText = document.getElementById('resumeText').value;
      this.eventBus.emit(EVENTS.AI_REQUEST_SUGGESTION, { jobDesc, resumeText });
    }, 1000); // 1000ms settling window for diarization stability
  }

  handleAIResponse(text) {
    // Phase 1: Update State & History (Always)
    this.state.conversationHistory.push({ role: ROLES.ASSISTANT, content: text });
    if (this.state.conversationHistory.length > APP_CONFIG.HISTORY_LIMIT) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-APP_CONFIG.HISTORY_LIMIT);
    }
    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.eventBus.emit(EVENTS.AI_UPDATE_HISTORY, { history: this.state.conversationHistory });

    // Phase 2: Update Teleprompter (Deferred if candidate is speaking)
    if (this.state.isCandidateSpeaking) {
      console.log('[UI] Candidate is speaking. Queuing suggestion for later display.');
      this.state.pendingSuggestion = text;
    } else {
      this.applyAIResponse(text);
    }
  }

  applyAIResponse(text) {
    const el = document.getElementById('teleprompterContent');
    if (el) {
      // Transition effect
      el.classList.add('updating');
      setTimeout(() => {
        el.innerHTML = renderMarkdownSafely(text, text);
        el.classList.remove('updating');
      }, 400);
    }
  }

  renderTranscript() {
    const hist = document.getElementById('transcriptMessages');
    if (!hist) return;
    hist.innerHTML = '';
    this.state.conversationHistory.forEach((entry, idx) => {
      if (entry.role === ROLES.ASSISTANT) return;
      const p = document.createElement('p');
      p.className = `transcript-entry ${entry.role}`;
      p.textContent = entry.content;
      p.onclick = () => this.toggleEntryRole(idx);
      hist.appendChild(p);
    });
    hist.scrollTop = hist.scrollHeight;
  }

  toggleEntryRole(index) {
    const entry = this.state.conversationHistory[index];
    if (!entry || entry.role === ROLES.ASSISTANT) return;

    // Toggle: candidate <-> interviewer
    const oldRole = entry.role;
    entry.role = (oldRole === ROLES.CANDIDATE) ? ROLES.INTERVIEWER : ROLES.CANDIDATE;

    // LEARN: If candidate manually identified a speaker label, remember it for this session
    if (entry.role === ROLES.CANDIDATE && entry.rawLabel && entry.rawLabel !== 'UNKNOWN') {
      const sRaw = String(entry.rawLabel).toLowerCase().replace(/speaker\s*/, '').trim();
      this.state.learnedCandidateLabel = sRaw;
      this.updateLearnedLabelUI();
      console.log(`[UI] Learned candidate label for session: ${sRaw}`);
    }

    console.log(`[UI] Toggled role for entry ${index}: ${oldRole} -> ${entry.role}`);

    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.eventBus.emit('ai:update-history', { history: this.state.conversationHistory });

    // If it was changed TO interviewer, trigger a new AI response
    if (entry.role === ROLES.INTERVIEWER) {
      this.requestAISuggestion();
    }
  }

  // --- HUD / Coding Mode Methods ---
  handleCaptureCode() {
    this.updateStatus('loading', 'Capturing...');
    const base64 = this.camera.captureBase64();

    if (base64) {
      this.state.lastCapturedImage = base64;
      this.state.capturedImages.push(base64);

      this.renderThumbnails();

      const countEl = document.getElementById('hudPhotoCount');
      if (countEl) countEl.textContent = this.state.capturedImages.length;

      const solveBtn = document.getElementById('btnHudSolve');
      if (solveBtn) solveBtn.style.display = 'inline-block';

      this.updateStatus('ok', 'Image Captured');
    } else {
      this.updateStatus('error', 'Capture Failed');
    }
  }

  renderThumbnails() {
    const container = document.getElementById('hudCapturedImages');
    if (!container) return;
    container.innerHTML = '';

    this.state.capturedImages.forEach((img, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb-wrapper';

      const el = document.createElement('img');
      el.src = img;
      el.className = 'hud-thumb';
      el.title = `Capture #${index + 1}`;
      el.onclick = () => {
        this.state.lastCapturedImage = img;
        this.updateStatus('ok', `Using capture #${index + 1}`);
        // Visual feedback for selected thumb
        document.querySelectorAll('.hud-thumb').forEach(t => t.style.borderColor = 'transparent');
        el.style.borderColor = 'var(--accent)';
      };

      const del = document.createElement('div');
      del.className = 'thumb-del';
      del.innerHTML = '&times;';
      del.onclick = (e) => {
        e.stopPropagation();
        this.state.capturedImages.splice(index, 1);
        if (this.state.lastCapturedImage === img) this.state.lastCapturedImage = null;
        this.renderThumbnails();
        const countEl = document.getElementById('hudPhotoCount');
        if (countEl) countEl.textContent = this.state.capturedImages.length;
      };

      wrapper.appendChild(el);
      wrapper.appendChild(del);
      container.appendChild(wrapper);
    });
  }

  async handleSolveCode() {
    const code = document.getElementById('hudSolutionContent').textContent || '';
    if (!code && !this.state.lastCapturedImage) {
      this.updateStatus('warn', 'Nothing to solve');
      return;
    }

    this.updateStatus('loading', 'Solving...');

    const jobDesc = StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, 'General Interview');
    const resumeText = StorageService.get(StorageService.KEYS.RESUME_TEXT, '');

    const userPrompt = this.state.lastCapturedImage
      ? `Analyze this code and suggest a solution: ${code}`
      : `Solve this coding problem: ${code}`;

    this.eventBus.emit('ai:request-suggestion', {
      jobDesc,
      resumeText,
      imageData: this.state.lastCapturedImage,
      userPrompt
    });

    // Clear buffer and reset UI count
    this.state.lastCapturedImage = null;
    this.state.capturedImages = [];
    const countEl = document.getElementById('hudPhotoCount');
    if (countEl) countEl.textContent = '0';
  }

  cycleHudLayout() {
    // Basic cycle implementation
    console.log('Cycling HUD layout...');
  }
}

// Boot the app
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
