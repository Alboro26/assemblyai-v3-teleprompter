// AudioWorkletProcessor for high-performance PCM extraction
class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    
    const channelData = input[0];
    if (!channelData) return true;

    // Buffer and convert Float32 [-1.0, 1.0] to Int16 PCM
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];
      
      if (this.bufferIndex >= this.bufferSize) {
        const int16Data = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          int16Data[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Transfer the raw ArrayBuffer back to the main thread
        this.port.postMessage(int16Data.buffer, [int16Data.buffer]);
        
        this.bufferIndex = 0;
        // Removed: this.buffer = new Float32Array(this.bufferSize); // Optimization: Reuse buffer to cut GC pressure
      }
    }

    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);
