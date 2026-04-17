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
      await this.audioCtx.resume();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.FFT_SIZE;
      const src = this.audioCtx.createMediaStreamSource(this.mediaStream);
      src.connect(this.analyser);
      return true;
    } catch (e) {
      console.error('[Audio] Init failed:', e);
      return false;
    }
  }

  getRMS() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return Math.sqrt(data.reduce((a, b) => a + b * b, 0) / data.length);
  }

  getFingerprint() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const timeData = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(timeData);

    return {
      fp: this.voiceAnalyzer.getMelEnergy(data, this.audioCtx.sampleRate, this.FFT_SIZE),
      pitch: this.voiceAnalyzer.getPitch(timeData, this.audioCtx.sampleRate)
    };
  }

  compareFingerprint(fp, pitch, signature) {
    return this.voiceAnalyzer.compare(fp, pitch, signature);
  }
}

class VoiceAnalyzer {
  constructor() {
    this.melBins = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 2800, 3100, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000];
  }

  getMelEnergy(dataArray, sampleRate, fftSize) {
    const binFreq = sampleRate / fftSize;
    const energies = new Float32Array(this.melBins.length);
    for (let i = 0; i < this.melBins.length; i++) {
      const startBin = Math.floor(this.melBins[i] / binFreq);
      const endBin = Math.floor((this.melBins[i+1] || this.melBins[i]*1.2) / binFreq);
      let sum = 0, count = 0;
      for (let j = startBin; j <= endBin && j < dataArray.length; j++) { sum += dataArray[j]; count++; }
      energies[i] = count > 0 ? sum / count : 0;
    }
    const maxE = Math.max(...energies) || 1;
    return Array.from(energies).map(v => v / maxE);
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
