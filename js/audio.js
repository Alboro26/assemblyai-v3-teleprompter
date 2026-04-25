/**
 * js/audio.js - Unified Audio Engine & Voice Fingerprinting
 */

export class AudioEngine {
  constructor(config = {}) {
    this.audioCtx = null;
    this.analyser = null;
    this.mediaStream = null;
    this.FFT_SIZE = 2048;
    this.config = config;
    this.voiceAnalyzer = new VoiceAnalyzer();
    
    // Phase 1: Pre-allocated buffers to prevent GC pressure
    this._freqData = null;
    this._timeData = null;
    this._lastAnalysis = 0;
    this._throttleMs = 200; // 200ms settle window
  }

  async init() {
    if (this.mediaStream) return true;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: true, 
          noiseSuppression: false, 
          autoGainControl: true, 
          sampleRate: 16000 
        }
      });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: 16000 });
      
      // Load and register the AudioWorklet processor
      try {
        console.log('[Audio] Loading Worklet Module...');
        await this.audioCtx.audioWorklet.addModule('js/audio-worklet-processor.js');
        console.log('[Audio] Worklet Module Loaded. Creating Node...');
        this.workletNode = new AudioWorkletNode(this.audioCtx, 'audio-stream-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1
        });
        console.log('[Audio] Worklet Node Created:', !!this.workletNode);
      } catch (workletErr) {
        console.error('[Audio] Worklet loading failed:', workletErr);
      }

      await this.audioCtx.resume();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.FFT_SIZE;

      // Initialize pre-allocated buffers
      this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this._timeData = new Uint8Array(this.analyser.fftSize);
      
      const src = this.audioCtx.createMediaStreamSource(this.mediaStream);
      src.connect(this.analyser);
      
      if (this.workletNode) {
        src.connect(this.workletNode);
      }
      
      return true;
    } catch (e) {
      console.error('[Audio] Init failed:', e);
      return false;
    }
  }

  async stop() {
    console.log('[Audio] Stopping engine and releasing hardware locks...');
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    
    if (this.workletNode) {
      this.workletNode.port.onmessage = null; // Prevent leak
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        // Deep Cleanup: Close context to release system resources/hardware lock
        await this.audioCtx.close();
        console.log('[Audio] AudioContext closed.');
      } catch (e) {
        console.warn('[Audio] Error closing AudioContext:', e);
      }
      this.audioCtx = null;
    }
  }

  getRMS() {
    if (!this.analyser || !this._freqData) return 0;
    
    // Performance: reuse pre-allocated buffer
    this.analyser.getByteFrequencyData(this._freqData);
    return Math.sqrt(this._freqData.reduce((a, b) => a + b * b, 0) / this._freqData.length);
  }

  getFingerprint() {
    if (!this.analyser || !this._freqData || !this._timeData) return null;

    // Phase 1: Throttling to cut GC pressure and CPU usage
    const now = Date.now();
    if (now - this._lastAnalysis < this._throttleMs) {
      return this._lastCachedFp;
    }
    this._lastAnalysis = now;

    // Reuse buffers
    this.analyser.getByteFrequencyData(this._freqData);
    this.analyser.getByteTimeDomainData(this._timeData);

    this._lastCachedFp = {
      fp: this.voiceAnalyzer.getMelEnergy(this._freqData, this.audioCtx.sampleRate, this.FFT_SIZE),
      pitch: this.voiceAnalyzer.getPitch(this._timeData, this.audioCtx.sampleRate)
    };
    return this._lastCachedFp;
  }

  compareFingerprint(fp, pitch, signature) {
    return this.voiceAnalyzer.compare(fp, pitch, signature);
  }
}

class VoiceAnalyzer {
  constructor() {
    this.melBins = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 2800, 3100, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000];
    // Phase 1: Pre-allocated energy buffer
    this._energiesBuffer = new Float32Array(this.melBins.length);
  }

  getMelEnergy(dataArray, sampleRate, fftSize) {
    const binFreq = sampleRate / fftSize;
    
    // Reuse buffer
    for (let i = 0; i < this.melBins.length; i++) {
      const startBin = Math.floor(this.melBins[i] / binFreq);
      const endBin = Math.floor((this.melBins[i+1] || this.melBins[i]*1.2) / binFreq);
      let sum = 0, count = 0;
      for (let j = startBin; j <= endBin && j < dataArray.length; j++) { sum += dataArray[j]; count++; }
      this._energiesBuffer[i] = count > 0 ? sum / count : 0;
    }
    
    const maxE = Math.max(...this._energiesBuffer) || 1;
    // Note: We still return an Array here for downstream comparison consistency, 
    // but the heavy lifting is done in the pre-allocated buffer.
    return Array.from(this._energiesBuffer).map(v => v / maxE);
  }

  getPitch(timeData, sampleRate) {
    const minLag = Math.floor(sampleRate / 300);
    const maxLag = Math.floor(sampleRate / 80);
    let bestLag = -1, bestCorrelation = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      for (let i = 0; i < timeData.length - lag; i++) { correlation += (timeData[i] - 128) * (timeData[i + lag] - 128); }
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
    }
    return bestLag > 0 ? sampleRate / bestLag : 0;
  }


  compare(fp, pitch, signature) {
    if (!signature || !fp || !signature.signature) return 0;
    const baseSignature = signature.signature;
    const basePitch = signature.pitch;

    if (!Array.isArray(baseSignature) || baseSignature.length === 0) return 0;
    
    let dot = 0, mag1 = 0, mag2 = 0;
    for (let i = 0; i < fp.length; i++) {
      dot += fp[i] * baseSignature[i];
      mag1 += fp[i] * fp[i];
      mag2 += baseSignature[i] * baseSignature[i];
    }
    const melSim = dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
    let pitchSim = 0;
    if (basePitch && pitch > 0) pitchSim = Math.max(0, 1 - (Math.abs(pitch - basePitch) / 50));
    return (melSim * 0.7) + (pitchSim * 0.3);
  }
}
