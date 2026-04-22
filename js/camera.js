export class CameraManager {
    constructor() {
        this.stream = null;
        this.videoEl = document.getElementById('cameraFeed');
        this.canvas = document.createElement('canvas');
    }

    async start() {
        if (!this.videoEl) return false;
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            this.videoEl.srcObject = this.stream;
            await this.videoEl.play();
            return true;
        } catch (err) {
            console.error("Camera error:", err);
            return false;
        }
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.videoEl) {
            this.videoEl.srcObject = null;
        }
    }

    /**
     * Captures the current video frame and returns it as a Base64 JPEG data URL.
     * @returns {string|null} Base64 data URL or null if no stream is active.
     */
    captureBase64() {
        if (!this.videoEl || !this.stream) return null;
        const w = this.videoEl.videoWidth || 1280;
        const h = this.videoEl.videoHeight || 720;
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.getContext('2d').drawImage(this.videoEl, 0, 0, w, h);
        // Return full data URL; ai.js will strip the prefix for the API payload
        return this.canvas.toDataURL('image/jpeg', 0.85);
    }
}
