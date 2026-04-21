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

    async captureAndOCR(onStatusCb) {
        if (!this.videoEl || !this.stream) return null;
        const w = this.videoEl.videoWidth || 1280;
        const h = this.videoEl.videoHeight || 720;
        this.canvas.width = w;
        this.canvas.height = h;
        const ctx = this.canvas.getContext('2d');
        ctx.drawImage(this.videoEl, 0, 0, w, h);

        if (typeof Tesseract === 'undefined') {
            if (onStatusCb) onStatusCb("Tesseract library missing.", "error");
            return null;
        }

        if (onStatusCb) onStatusCb("Scanning image (OCR)...", "");
        try {
            const { data: { text } } = await Tesseract.recognize(this.canvas, 'eng', {
                logger: m => {
                    if (m.status === 'recognizing text' && onStatusCb) {
                        onStatusCb(`Scanning... ${Math.round(m.progress * 100)}%`, '');
                    }
                }
            });
            if (onStatusCb) onStatusCb("Scan complete. Solving...", "ok");
            return text;
        } catch (e) {
            console.error("OCR Failed:", e);
            if (onStatusCb) onStatusCb("OCR Failed", "error");
            return null;
        }
    }
}
