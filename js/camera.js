/**
 * js/camera.js - Handles webcam access and frame capture for multimodal AI.
 */
export class CameraManager {
  constructor(videoElement, eventBus) {
    this.video = videoElement;
    this.eventBus = eventBus;
    this.stream = null;
    this.isActive = false;

    // Optional: Pre-canvas for reuse
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.eventBus.on('camera:start', () => this.start());
    this.eventBus.on('camera:stop', () => this.stop());
  }

  async start() {
    if (this.isActive) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      this.video.srcObject = this.stream;
      this.isActive = true;
      console.log('[Camera] Stream started');
    } catch (err) {
      console.error('[Camera] Access denied:', err);
      // Audit Fix: Emit status change on failure
      this.eventBus.emit('status:change', { text: 'Camera Denied', type: 'error' });
    }
  }

  stop() {
    if (!this.isActive) return;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.video.srcObject = null;
    this.isActive = false;
    console.log('[Camera] Stream stopped');
  }

  /**
   * Captures the current frame and returns a Base64 string.
   * Phase 2: Downsizes image to max 1024px to reduce memory/bandwidth.
   */
  captureBase64() {
    if (!this.isActive || this.video.readyState !== 4) return null;

    const maxDimension = 1024;
    let w = this.video.videoWidth;
    let h = this.video.videoHeight;

    // Calculate aspect ratio
    if (w > h) {
      if (w > maxDimension) {
        h *= maxDimension / w;
        w = maxDimension;
      }
    } else {
      if (h > maxDimension) {
        w *= maxDimension / h;
        h = maxDimension;
      }
    }

    this.canvas.width = w;
    this.canvas.height = h;

    this.ctx.drawImage(this.video, 0, 0, w, h);
    
    // Phase 2: Use 0.8 quality for smaller payloads
    return this.canvas.toDataURL('image/jpeg', 0.8);
  }
}
