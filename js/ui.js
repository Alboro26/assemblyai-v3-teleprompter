import { AudioEngine } from './audio.js';
import { STTManager } from './stt.js';
import { AIService } from './ai.js';
import { ToastService } from './services/ToastService.js';
import { CameraManager } from './camera.js';
import { StorageService } from './services/StorageService.js';
import { EventBus } from './services/EventBus.js';
import { ModelManager } from './services/ModelManager.js';
import { ROLES } from './services/Constants.js';

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
      lastCapturedImage: null // Buffer for multimodal AI
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
      this.eventBus.on('stt:interim', (text) => this.handleInterim(text)),
      this.eventBus.on('stt:final', data => this.handleFinalTranscript(data)),
      this.eventBus.on('calibration:complete', data => this.stopCalibration(null, data.label)),
      this.eventBus.on('calibration:progress', data => this.updateCalibrationProgress(data)),
      this.eventBus.on('ai:response', text => this.handleAIResponse(text)),
      this.eventBus.on('ai:context-data', data => this.displayInspector(data)),
      this.eventBus.on('status:change', (status) => this.updateStatus(status.type, status.text))
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
    if (el) el[event] = fn;
    else console.warn(`Missing element for binding: ${id}`);
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

      document.getElementById('jobDescription').value = StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, '');
      document.getElementById('resumeText').value = StorageService.get(StorageService.KEYS.RESUME_TEXT, '');
      document.getElementById('aiDelay').value = this.state.aiTriggerDelay || 2.0;
      document.getElementById('voiceThreshold').value = this.state.voiceThreshold;
      document.getElementById('noiseFloor').value = this.state.noiseFloorThreshold;
      document.getElementById('mergeThreshold').value = this.state.mergeThreshold;

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
      this.eventBus.emit('ui:show-toast', { message: 'History Cleared' });
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
      btn.textContent = this.state.calibrationComplete ? 'RE-CALIBRATE' : 'CALIBRATE VOICE';
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
    }

    const aiRole = role; 
    console.log(`[UI] Classification: raw=${rawLabel} -> role=${aiRole} (learned=${this.state.learnedCandidateLabel})`);

    // DIARIZATION CORRECTION (Targeted Retraction): 
    // If STT detected an overlap/correction, remove the specific turn being replaced.
    if (data.replaceLast && this.state.conversationHistory.length > 0) {
      const history = this.state.conversationHistory;
      let found = false;
      // Search for the specific turn matching the original timestamp
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].timestamp === data.originalTimestamp) {
          const removed = history.splice(i, 1)[0];
          console.log(`[UI] Correcting diarization: Removed targeted turn "${removed.content.substring(0, 20)}..."`);
          found = true;
          break;
        }
      }
      // Fallback: If no exact timestamp match, remove the last speaker turn
      if (!found) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role !== 'assistant') {
            const removed = history.splice(i, 1)[0];
            console.log(`[UI] Correcting diarization: Removed last speaker turn (fallback) "${removed.content.substring(0, 20)}..."`);
            break;
          }
        }
      }
    }

    // SMART MERGE LOGIC (Finalization)
    const lastEntry = this.state.conversationHistory[this.state.conversationHistory.length - 1];
    const thresholdMs = this.state.mergeThreshold * 1000;

    if (lastEntry && lastEntry.role === aiRole && Math.abs(now - lastEntry.timestamp) < thresholdMs) {
      console.log(`[UI] Finalizing: Merging into previous ${aiRole} entry (${Math.abs(now - lastEntry.timestamp)}ms diff)`);
      lastEntry.content += ' ' + text;
      lastEntry.timestamp = now;
    } else {
      console.log(`[UI] Finalizing: Creating new entry for ${aiRole} (Diff: ${lastEntry ? now - lastEntry.timestamp : 'N/A'}ms)`);
      this.state.conversationHistory.push({
        role: aiRole,
        content: text,
        timestamp: now,
        rawLabel: rawLabel
      });
    }

    // PRUNING: Keep history manageable (limit 50)
    if (this.state.conversationHistory.length > 50) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-50);
    }

    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.eventBus.emit('ai:update-history', { history: this.state.conversationHistory });

    // Trigger AI if it's the interviewer speaking
    if (aiRole === ROLES.INTERVIEWER) {
      this.requestAISuggestion();
    } else {
      // If it's a candidate turn, cancel any pending suggestions triggered by a previously misidentified interviewer turn
      if (this._aiTriggerTimeout) {
        clearTimeout(this._aiTriggerTimeout);
        this._aiTriggerTimeout = null;
        console.log('[UI] Cancelled pending AI suggestion (Speaker flipped to Candidate)');
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
      this.eventBus.emit('ai:request-suggestion', { jobDesc, resumeText });
    }, 1000); // 1000ms settling window for diarization stability
  }

  handleAIResponse(text) {
    const el = document.getElementById('teleprompterContent');
    if (el) {
      // Transition effect
      el.classList.add('updating');
      setTimeout(() => {
        el.innerHTML = renderMarkdownSafely(text, text);
        el.classList.remove('updating');
      }, 400);
    }

    this.state.conversationHistory.push({ role: ROLES.ASSISTANT, content: text });
    if (this.state.conversationHistory.length > 50) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-50);
    }
    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.eventBus.emit('ai:update-history', { history: this.state.conversationHistory });
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
    if (entry.role === 'interviewer') {
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
