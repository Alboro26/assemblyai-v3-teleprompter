import { AudioEngine } from './audio.js';
import { STTManager } from './stt.js';
import { AIService } from './ai.js';
import { CameraManager } from './camera.js';
import { StorageService } from './services/StorageService.js';
import { EventBus } from './services/EventBus.js';
import { ModelManager } from './services/ModelManager.js';

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
      calibrationComplete: StorageService.get(StorageService.KEYS.USER_VOICE_SIGNATURE, null) !== null,
      fontSize: StorageService.get(StorageService.KEYS.FONT_SIZE, 24),
      lastStatusType: 'ok',
      currentMode: 'voice', // Default mode
      lastCapturedImage: null // Buffer for multimodal AI
    };

    // 3. Services
    this.ai = new AIService();
    this.audio = new AudioEngine();
    this.stt = new STTManager(this.eventBus);
    this.camera = new CameraManager(document.getElementById('cameraFeed'));

    // 4. Wire up Event Bus
    this._unsubscribers = [];
    this.setupSubscriptions();

    this.init();
  }

  setupSubscriptions() {
    const unsub = [
      this.eventBus.on('stt:interim', (text) => this.handleInterim(text)),
      this.eventBus.on('stt:final', (data) => this.handleFinalTranscript(data)),
      this.eventBus.on('ai:response', (text) => this.handleAIResponse(text)),
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
      this._bind('btnCalibrate', 'onclick', () => this.startCalibration());
      this._bind('btnStartSession', 'onclick', () => this.startSession());
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
      this.setEngine(mode ? 'assembly' : 'local', false);

      const freeMode = StorageService.get(StorageService.KEYS.IS_FREE_MODE, true);
      const toggle = document.getElementById('modelToggle');
      if (toggle) toggle.checked = !freeMode;
      this.toggleModelMode(false);

      document.getElementById('jobDescription').value = StorageService.get(StorageService.KEYS.JOB_DESCRIPTION, '');
      document.getElementById('resumeText').value = StorageService.get(StorageService.KEYS.RESUME_TEXT, '');
      document.getElementById('aiDelay').value = this.state.aiTriggerDelay || 2.0;
      document.getElementById('voiceThreshold').value = this.state.voiceThreshold;
      document.getElementById('noiseFloor').value = this.state.noiseFloorThreshold;

      this.updateFontSize(0);
      this.updateCalibrationUI();
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
    StorageService.set(StorageService.KEYS.AI_TRIGGER_DELAY, this.state.aiTriggerDelay);
    StorageService.set(StorageService.KEYS.VOICE_THRESHOLD, this.state.voiceThreshold);
    StorageService.set(StorageService.KEYS.NOISE_FLOOR_THRESHOLD, this.state.noiseFloorThreshold);

    this.toggleSettings(false);
    this.updateStatus('ok', 'Settings saved');
  }

  updateStatus(type, text) {
    this.state.lastStatusType = type;
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    if (dot) dot.className = `status-dot ${type}`;
    if (label) label.textContent = text.toUpperCase();
  }

  togglePause() {
    this.state.isPaused = !this.state.isPaused;
    const btn = document.getElementById('pauseBtn');
    if (btn) btn.textContent = this.state.isPaused ? 'RESUME' : 'PAUSE';
    this.stt.setPaused(this.state.isPaused);
  }

  setEngine(mode, notify = true) {
    this.state.isAssemblyMode = (mode === 'assembly');
    StorageService.set(StorageService.KEYS.IS_ASSEMBLY_MODE, this.state.isAssemblyMode);

    const btnA = document.getElementById('btnSelectAssembly');
    const btnL = document.getElementById('btnSelectLocal');
    if (btnA) btnA.classList.toggle('active', this.state.isAssemblyMode);
    if (btnL) btnL.classList.toggle('active', !this.state.isAssemblyMode);

    this.stt.setEngine(mode);
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

    this.ai.setMode(this.state.isFreeMode);
    if (notify) this.updateStatus('ok', this.state.isFreeMode ? 'Free Mode' : 'Paid Mode');
  }

  toggleSettings(show) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    const isVisible = (show !== undefined) ? show : modal.style.display === 'none';
    modal.style.display = isVisible ? 'flex' : 'none';
  }

  toggleSidebar() {
    const sidebar = document.querySelector('.sidebar-panel');
    const btn = document.getElementById('btnHideSidebar');
    if (sidebar) {
      const isHidden = sidebar.classList.toggle('hidden');
      if (btn) btn.textContent = isHidden ? 'SHOW TRANSCRIPT' : 'HIDE TRANSCRIPT';
    }
  }

  updateFontSize(delta) {
    this.state.fontSize = Math.max(12, Math.min(48, this.state.fontSize + delta));
    StorageService.set(StorageService.KEYS.FONT_SIZE, this.state.fontSize);
    const hist = document.getElementById('transcriptHistory');
    if (hist) hist.style.fontSize = `${this.state.fontSize}px`;
  }

  clearHistory() {
    if (confirm('Clear all conversation history?')) {
      this.state.conversationHistory = [];
      StorageService.remove(StorageService.KEYS.CONVERSATION_HISTORY);
      this.renderTranscript();
      this.updateStatus('ok', 'History cleared');
    }
  }

  startCalibration() {
    this.state.isCalibrating = true;
    const modal = document.getElementById('calibrationModal');
    if (modal) modal.style.display = 'flex';
    this.stt.startCalibration();
  }

  stopCalibration(signature = null) {
    this.state.isCalibrating = false;
    const modal = document.getElementById('calibrationModal');
    if (modal) modal.style.display = 'none';

    if (signature) {
      this.state.userVoiceSignature = signature;
      this.state.calibrationComplete = true;
      StorageService.set(StorageService.KEYS.USER_VOICE_SIGNATURE, signature);
      this.updateCalibrationUI();
      this.updateStatus('ok', 'Calibration Complete');
    } else {
      this.stt.stopCalibration();
    }
  }

  updateCalibrationUI() {
    const btn = document.getElementById('btnCalibrate');
    if (btn) {
      btn.textContent = this.state.calibrationComplete ? 'RE-CALIBRATE' : 'CALIBRATE VOICE';
      btn.classList.toggle('complete', this.state.calibrationComplete);
    }
  }

  startSession() {
    this.stt.start();
    this.updateStatus('ok', 'Session Started');
  }

  handleInterim(text) {
    const el = document.getElementById('interimText');
    if (el) el.textContent = text;
  }

  handleFinalTranscript(data) {
    const { text, rawLabel } = data;
    const el = document.getElementById('interimText');
    if (el) el.textContent = '';

    const now = Date.now();
    const role = (rawLabel === this.state.userVoiceSignature) ? 'user' : 'interviewer';
    const aiRole = role === 'user' ? 'user' : 'interviewer';

    this.state.conversationHistory.push({
      role: aiRole,
      content: text,
      timestamp: now,
      rawLabel: rawLabel
    });

    // PRUNING: Keep history manageable (limit 50)
    if (this.state.conversationHistory.length > 50) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-50);
    }

    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
    this.ai.updateHistory(this.state.conversationHistory);
    
    // Trigger AI if it's the interviewer speaking
    if (aiRole === 'interviewer') {
      const job = document.getElementById('jobDescription').value;
      const resume = document.getElementById('resumeText').value;
      this.ai.generateResponse(job, resume);
    }
  }

  handleAIResponse(text) {
    const el = document.getElementById('aiSuggestionContent');
    if (el) {
      el.innerHTML = renderMarkdownSafely(text, text);
    }
    
    this.state.conversationHistory.push({ role: 'assistant', content: text });
    if (this.state.conversationHistory.length > 50) {
      this.state.conversationHistory = this.state.conversationHistory.slice(-50);
    }
    StorageService.set(StorageService.KEYS.CONVERSATION_HISTORY, this.state.conversationHistory);
    this.renderTranscript();
  }

  renderTranscript() {
    const hist = document.getElementById('transcriptHistory');
    if (!hist) return;
    hist.innerHTML = '';
    this.state.conversationHistory.forEach((entry, idx) => {
      if (entry.role === 'assistant') return;
      const p = document.createElement('p');
      const uiRole = entry.role === 'user' ? 'candidate' : 'interviewer';
      p.className = `transcript-entry ${uiRole}`;
      p.textContent = entry.content;
      hist.appendChild(p);
    });
    hist.scrollTop = hist.scrollHeight;
  }

  // --- HUD / Coding Mode Methods ---
  handleCaptureCode() {
    this.updateStatus('loading', 'Capturing...');
    const base64 = this.camera.captureBase64();
    
    if (base64) {
      this.state.lastCapturedImage = base64;
      this.updateStatus('ok', 'Image Captured');
      // Visual feedback: show a preview or just update status
      console.log('[UI] Image buffered for next AI request');
    } else {
      this.updateStatus('error', 'Capture Failed');
    }
  }

  handleSolveCode() {
    const code = document.getElementById('hudSolutionContent').textContent || '';
    this.updateStatus('loading', 'Solving...');
    
    // Pass the buffered image to the AI service
    this.ai.generateResponse("Please analyze this code/image and suggest a solution.", code, this.state.lastCapturedImage);
    
    // Clear buffer after sending
    this.state.lastCapturedImage = null;
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
