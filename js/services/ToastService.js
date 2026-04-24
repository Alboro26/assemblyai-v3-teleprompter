/**
 * js/services/ToastService.js
 * Decoupled toast notification service.
 */
export class ToastService {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.toastEl = document.getElementById('toast');
    this.timeout = null;

    this.eventBus.on('ui:show-toast', (data) => this.show(data.message, data.type));
  }

  show(message, type = 'success') {
    if (!this.toastEl) return;

    if (this.timeout) clearTimeout(this.timeout);

    this.toastEl.textContent = message;
    this.toastEl.className = `toast show ${type}`;

    this.timeout = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 3000);
  }
}
