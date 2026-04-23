/**
 * js/services/EventBus.js
 * A lightweight, production-ready Pub/Sub system for decoupled communication.
 * Refined based on Senior Architect review.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event - The namespaced event name (e.g., 'stt:interim').
   * @param {function} callback - The handler function.
   * @returns {function} An unsubscribe function.
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    
    // Return an unsubscribe function for convenience
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   */
  off(event, callback) {
    this._listeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event to all subscribers.
   * Includes error isolation to prevent one handler from breaking others.
   */
  emit(event, payload) {
    this._listeners.get(event)?.forEach(fn => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }
}
