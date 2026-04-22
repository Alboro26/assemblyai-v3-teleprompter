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
      isCalibrating: false,
      voiceThreshold: 0.60,
      noiseFloorThreshold: 12,
      conversationHistory: [],
      capturedImages: [],
      userVoiceSignature: JSON.parse(localStorage.getItem('userVoiceSignature') || 'null'),
      matchConfidence: 0,
      selectedFreeModel: localStorage.getItem('selectedFreeModel') || 'google/gemini-2.0-flash-lite-preview-02-05:free',
      selectedPaidModel: localStorage.getItem('selectedPaidModel') || 'google/gemini-2.0-flash-001',
      lastAiTriggerTime: 0,
      speakerMapping: { candidate: null, interviewer: null },
      calibrationComplete: localStorage.getItem('userVoiceSignature') !== null,
      fontSize: parseInt(localStorage.getItem('fontSize')) || 24,
      lastStatusType: 'ok'
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

  toggleSidebar() {
    if (this.state.currentMode === 'coding') {
        this.cycleHudLayout();
        return;
    }
    const grid = document.querySelector('.dashboard-grid');
    if (grid) {
      grid.classList.toggle('sidebar-hidden');
    }
  }

  switchMode(mode) {
      const btnVoice = document.getElementById('btnVoiceMode');
      const btnCoding = document.getElementById('btnCodingMode');
      const telePanel = document.getElementById('teleprompterPanel');
      const camPanel = document.getElementById('cameraPanel');
      const hudSidebar = document.getElementById('hudSidebar');
      const sidebarPanel = document.querySelector('.sidebar-panel');
      const grid = document.querySelector('.dashboard-grid');

      if (mode === 'voice') {
          if (btnVoice) btnVoice.classList.add('active');
          if (btnCoding) btnCoding.classList.remove('active');
          if (telePanel) telePanel.style.display = 'flex';
          if (camPanel) camPanel.style.display = 'none';
          if (hudSidebar) hudSidebar.style.display = 'none';
          if (sidebarPanel) sidebarPanel.style.display = 'flex';
          if (grid) grid.classList.remove('coding-monitor', 'coding-focus', 'coding-stealth');
          this.state.currentMode = 'voice';
          if (this.camera) this.camera.stop();
          this.updateStatus('READY', '');
      } else if (mode === 'coding') {
          if (btnVoice) btnVoice.classList.remove('active');
          if (btnCoding) btnCoding.classList.add('active');
          if (telePanel) telePanel.style.display = 'none';
          if (camPanel) camPanel.style.display = 'flex';
          if (sidebarPanel) sidebarPanel.style.display = 'none';
          if (hudSidebar) hudSidebar.style.display = 'flex';
          if (grid) {
              grid.classList.remove('coding-focus', 'coding-stealth');
              grid.classList.add('coding-monitor');
          }
          this.state.hudLayoutState = 0;
          this.state.currentMode = 'coding';
          if (this.camera) {
              this.updateStatus('Starting Camera...', '');
              this.camera.start().then(ok => {
                  if (!ok) this.updateStatus('Camera Error', 'error');
                  else this.updateStatus('Camera Active', '');
              });
          }
      }
  }

  cycleHudLayout() {
      const grid = document.querySelector('.dashboard-grid');
      if (!grid) return;
      const states = ['coding-monitor', 'coding-focus', 'coding-stealth'];
      this.state.hudLayoutState = ((this.state.hudLayoutState || 0) + 1) % 3;
      grid.classList.remove(...states);
      grid.classList.add(states[this.state.hudLayoutState]);
  }

  updateFontSize(delta) {
      this.state.fontSize = Math.max(12, Math.min(72, this.state.fontSize + delta));
      localStorage.setItem('fontSize', this.state.fontSize);
      const val = this.state.fontSize + 'px';
      this._text('fontSizeDisplay', val);
      document.documentElement.style.setProperty('--teleprompter-size', val);
  }

  handleCaptureCode() {
      if (this.state.currentMode !== 'coding' || !this.camera) return;
      const dataUrl = this.camera.captureBase64();
      if (!dataUrl) { this.updateStatus('No camera feed active.', 'error'); return; }
      if (!this.state.capturedImages) this.state.capturedImages = [];
      this.state.capturedImages.push(dataUrl);
      this._updateCaptureUI();
      this.updateStatus(`Frame ${this.state.capturedImages.length} captured`, 'ok');
  }

  removeCapture(index) {
      if (!this.state.capturedImages) return;
      this.state.capturedImages.splice(index, 1);
      this._updateCaptureUI();
  }

  _updateCaptureUI() {
      const images = this.state.capturedImages || [];
      this._text('hudPhotoCount', images.length);
      const btnSolve = document.getElementById('btnHudSolve');
      if (btnSolve) btnSolve.style.display = images.length > 0 ? 'inline-block' : 'none';

      const strip = document.getElementById('cameraThumbnailStrip');
      if (!strip) return;
      strip.innerHTML = '';
      images.forEach((dataUrl, i) => {
          const thumb = document.createElement('div');
          thumb.className = 'camera-thumb';
          const img = document.createElement('img');
          img.src = dataUrl;
          const del = document.createElement('button');
          del.className = 'camera-thumb-delete';
          del.title = 'Remove';
          del.textContent = '✕';
          del.onclick = () => this.removeCapture(i);
          thumb.appendChild(img);
          thumb.appendChild(del);
          strip.appendChild(thumb);
      });
  }

  async handleSolveCode() {
      if (!this.state.capturedImages || this.state.capturedImages.length === 0) return;
      const images = [...this.state.capturedImages];
      this.state.capturedImages = [];
      this._updateCaptureUI();
      this.updateStatus('Analyzing image(s)...', '');
      await this.ai.generateCodingResponse(
          images,
          localStorage.getItem('jobDescription') || '',
          localStorage.getItem('resumeText') || ''
      );
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
      this._val('candidateSpeaker', savedOverride);
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
    // Sync Speaker Label Dropdown
    const sLabel = document.getElementById('candidateSpeaker');
    if (sLabel) {
        sLabel.value = this.state.speakerMapping.candidate || 'auto';
        sLabel.onchange = (e) => {
            const val = e.target.value;
            const mapped = val === 'auto' ? null : val;
            this.state.speakerMapping.candidate = mapped;
            // Persist immediately — don't require Save & Reconnect
            localStorage.setItem('candidateLabelOverride', val);
            console.log(`[UI] Dropdown: Candidate locked to "${val}"`);
            this.updateStatus(`Speaker ${val} = Candidate. Save & Reconnect to apply fully.`, 'ok');
        };
    }

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
    const isCandidate = this.state.matchConfidence > this.state.voiceThreshold;
    const dot = document.getElementById('statusDot');
    const appStatusText = document.getElementById('appStatusText');

    // Only update the dot color if we aren't showing an error/warning
    if (dot && this.state.lastStatusType !== 'error' && this.state.lastStatusType !== 'warn') {
        dot.style.background = isCandidate ? '#3b82f6' : '#f59e0b';
    }
    
    // Only update text if the system is in a normal operating state ('ok')
    if (appStatusText && this.state.lastStatusType === 'ok') {
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

    let isCandidate = false;
    
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
    this.addTranscriptEntry(text, role, rawLabel);

    if (!isCandidate) {
        this.triggerDelayedAI();
    }
  }

  determineSpeakerIdentity(rawLabel) {
    if (rawLabel === null || rawLabel === undefined) return false;

    const labelStr = String(rawLabel).trim().toUpperCase();
    const mappedCandidate = this.state.speakerMapping.candidate
        ? String(this.state.speakerMapping.candidate).toUpperCase()
        : null;

    // Always log so we can debug in browser console
    console.log(`[IDENTITY] rawLabel="${labelStr}" | mappedCandidate="${mappedCandidate}"`);

    // If user explicitly mapped a candidate label, use it as gospel
    if (mappedCandidate !== null) {
      const result = labelStr === mappedCandidate;
      console.log(`[IDENTITY] Explicit match check: "${labelStr}" === "${mappedCandidate}" → ${result}`);
      return result;
    }

    // No mapping — use voice signature as POSITIVE confirmation only
    if (this.state.userVoiceSignature && this.state.calibrationComplete
        && this.state.matchConfidence > this.state.voiceThreshold) {
      this.state.speakerMapping.candidate = labelStr;
      console.log(`[IDENTITY] Voice match: auto-mapping "${labelStr}" as Candidate.`);
      return true;
    }

    console.log(`[IDENTITY] No mapping — defaulting to Interviewer.`);
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
        const idTag = (rawLabel !== null && rawLabel !== undefined) ? rawLabel : (this.state.isAssemblyMode ? 'A' : 'Local');
        hist.lastElementChild.textContent = `${lastHumanEntry.content} [ID: ${idTag}]`;
        hist.scrollTop = hist.scrollHeight;
      }
      // Mirror merged interviewer update to HUD chat
      if (aiRole === 'interviewer') {
        const hudHist = document.getElementById('hudChatMessages');
        if (hudHist && hudHist.lastElementChild) {
          hudHist.lastElementChild.textContent = lastHumanEntry.content;
          hudHist.scrollTop = hudHist.scrollHeight;
        }
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
      timestamp: now,
      rawLabel: rawLabel // Store for self-healing toggle
    });

    const p = document.createElement('p');
    p.className = `transcript-entry ${role}`;
    p.dataset.index = entryIndex; // Store index for toggling
    p.onclick = () => this.toggleEntryRole(entryIndex, p);

    const idTag = (rawLabel !== null && rawLabel !== undefined) ? rawLabel : '?';
    p.textContent = `${text} [ID: ${idTag}]`;

    const hist = document.getElementById('transcriptHistory');
    if (hist) {
      hist.appendChild(p);
      hist.scrollTop = hist.scrollHeight;
    }

    // Mirror interviewer messages to HUD chat (coding mode sidebar)
    if (role === 'interviewer') {
      const hudChat = document.getElementById('hudChatMessages');
      if (hudChat) {
        const hudP = document.createElement('p');
        hudP.className = 'transcript-entry interviewer';
        hudP.textContent = text;
        hudChat.appendChild(hudP);
        hudChat.scrollTop = hudChat.scrollHeight;
      }
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
    
    // --- Self-Healing Identity Logic ---
    // If the user manually corrects a message, update the global mapping
    const rawLabel = entry.rawLabel;
    if (rawLabel !== null && rawLabel !== undefined) {
        if (newRole === 'user') {
            this.state.speakerMapping.candidate = rawLabel;
            if (this.state.speakerMapping.interviewer === rawLabel) this.state.speakerMapping.interviewer = null;
        } else {
            this.state.speakerMapping.interviewer = rawLabel;
            if (this.state.speakerMapping.candidate === rawLabel) this.state.speakerMapping.candidate = null;
        }
        console.log(`[UI] Identity Healed: Speaker ${rawLabel} is now ${uiRole}`);
        this.updateStatus(`Learned Speaker ${rawLabel} as ${uiRole}`, 'ok');

        // Sync back to the settings dropdown if available
        const sLabel = document.getElementById('candidateSpeaker');
        if (sLabel && newRole === 'user') {
            sLabel.value = String(rawLabel).toUpperCase();
        }
    }

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
    this.state.lastStatusType = type || 'info';
    const appStatusText = document.getElementById('appStatusText');
    const dot = document.getElementById('statusDot');
    let displayText = text;
    if (type === 'error' && text.length > 30) {
        const match = text.match(/\d{3}/);
        displayText = match ? `ERROR ${match[0]}` : text.substring(0, 30) + '...';
    }

    if (appStatusText) appStatusText.textContent = displayText.toUpperCase();
    
    // Apply full error tooltip to the entire container for easier access
    const statusContainer = document.querySelector('.status-indicator');
    if (statusContainer) statusContainer.title = text;

    if (dot) {
      if (type === 'error') dot.style.background = '#ef4444';
      else if (type === 'ok') dot.style.background = '#10b981';
      else if (type === 'warn') dot.style.background = '#f59e0b';
      else dot.style.background = '#475569';
    }
  }

  handleAIStart() {
    const dot = document.getElementById('statusDot');
    const loader = document.getElementById('loader');
    if (dot) dot.classList.add('pulse-generating');
    if (loader) loader.style.display = 'block';
    this.updateStatus('AI ANALYZING...', 'ok');
  }

  handleAIResponse(text) {
    if (this.state.currentMode === 'coding') {
        const { codeOnly, explanation } = this._splitCodeExplanation(text);

        // Code blocks → Solution panel (editor-style)
        const hudEl = document.getElementById('hudSolutionContent');
        if (hudEl) {
            if (codeOnly) {
                hudEl.innerHTML = window.marked ? marked.parse(codeOnly) : `<pre><code>${codeOnly}</code></pre>`;
            } else {
                hudEl.innerHTML = `<span style="color:var(--text-muted);opacity:0.5;font-style:italic;font-size:0.75em;">No code block returned. See chat for explanation.</span>`;
            }
            hudEl.scrollTop = 0;
        }

        // Prose explanation → HUD Chat as an AI bubble
        if (explanation) {
            const hudChat = document.getElementById('hudChatMessages');
            if (hudChat) {
                const aiEntry = document.createElement('p');
                aiEntry.className = 'transcript-entry hud-ai-note';
                aiEntry.innerHTML = explanation; // Injected as HTML (already parsed)
                hudChat.appendChild(aiEntry);
                hudChat.scrollTop = hudChat.scrollHeight;
            }
        }
    } else {
        // Voice mode: render into the teleprompter as before
        const el = document.getElementById('teleprompterContent');
        if (el) {
            el.innerHTML = window.marked ? marked.parse(text) : text;
        }
        this.state.conversationHistory.push({ role: 'assistant', content: text });
    }

    const dot = document.getElementById('statusDot');
    const loader = document.getElementById('loader');
    if (dot) dot.classList.remove('pulse-generating');
    if (loader) loader.style.display = 'none';
    this.updateStatus('READY', 'ok');
  }

  handleAIError(err) {
    this.updateStatus(err, 'error');
    const dot = document.getElementById('statusDot');
    const loader = document.getElementById('loader');
    if (dot) dot.classList.remove('pulse-generating');
    if (loader) loader.style.display = 'none';
  }

  /**
   * Splits an AI response into code blocks and prose explanation.
   * Code blocks (``` ... ```) go to the solution panel; prose goes to the chat.
   */
  _splitCodeExplanation(text) {
    const codeBlockRegex = /```(?:[a-z]*\n)?([\s\S]*?)```/g;
    const blocks = [];
    let match;
    
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }

    // If no backticks were found, assume the AI just dumped code (safety fallback)
    if (blocks.length === 0) {
        return {
            codeOnly: text.trim(),
            explanation: "*(AI provided code without markdown wrappers)*"
        };
    }

    const codeOnly = blocks.join('\n\n/* --- Next Block --- */\n\n');
    const explanation = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      codeOnly,
      explanation: window.marked ? marked.parse(explanation) : explanation
    };
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
    
    // Ensure STT is active so we can capture labels
    if (this.stt && this.stt.isPaused) {
        this.togglePause();
    }

    const iv = setInterval(() => {
      if (!this.state.isCalibrating) { clearInterval(iv); return; }

      const elapsed = Date.now() - start;
      const remaining = Math.max(0, (DURATION - elapsed) / 1000);
      if (timer) timer.textContent = remaining.toFixed(1) + 's';
      if (bar) bar.style.width = (elapsed / DURATION * 100) + '%';
      const rms = this.audio.getRMS();
      const vMeter = document.getElementById('volumeMeter');
      if (vMeter) {
          const volPct = Math.min(100, (rms / 40) * 100);
          vMeter.style.width = volPct + '%';
          vMeter.style.background = rms > 12 ? '#10b981' : '#475569';
      }

      if (rms > 12) {
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
    // Also reset HUD coding panels
    const hc = document.getElementById('hudChatMessages');
    if (hc) hc.innerHTML = '';
    const hs = document.getElementById('hudSolutionContent');
    if (hs) hs.innerHTML = '<span style="color:var(--text-muted);opacity:0.4;font-style:italic;font-size:0.75em;">Capture a screenshot to solve...</span>';
  }

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
      'candidateLabelOverride': 'candidateSpeaker'
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
