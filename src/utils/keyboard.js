/**
 * @fileoverview Keyboard shortcuts manager
 * YTP-optimized keyboard controls for rapid editing
 */

import { SHORTCUTS, JUMP_INTERVAL, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../core/constants.js';
import * as actions from '../core/actions.js';

/**
 * Keyboard shortcuts manager
 */
export class KeyboardManager {
  /**
   * @param {import('../core/state.js').StateManager} stateManager
   */
  constructor(stateManager) {
    this.state = stateManager;
    this.enabled = true;

    /** @type {Map<string, function(): void>} */
    this.shortcuts = new Map();

    this.setupDefaultShortcuts();
    this.setupEventListeners();
  }

  /**
   * Setup default keyboard shortcuts
   */
  setupDefaultShortcuts() {
    // Playback controls
    this.register(SHORTCUTS.PLAY_PAUSE, () => this.togglePlayback());
    this.register(SHORTCUTS.JUMP_BACKWARD, () => this.jumpBackward());
    this.register(SHORTCUTS.JUMP_FORWARD, () => this.jumpForward());
    this.register(SHORTCUTS.PAUSE, () => this.pause());

    // Editing
    this.register(SHORTCUTS.SPLIT, () => this.splitClip());
    this.register(SHORTCUTS.DELETE, () => this.deleteClip());

    // Undo/Redo
    this.register(SHORTCUTS.UNDO, () => this.state.undo());
    this.register(SHORTCUTS.REDO, () => this.state.redo());

    // Clipboard (basic implementation)
    this.register(SHORTCUTS.COPY, () => this.copyClip());
    this.register(SHORTCUTS.PASTE, () => this.pasteClip());

    // YTP-specific
    this.register(SHORTCUTS.REVERSE, () => this.reverseClip());
    this.register(SHORTCUTS.SPEED_UP, () => this.adjustSpeed(0.25));
    this.register(SHORTCUTS.SPEED_DOWN, () => this.adjustSpeed(-0.25));

    // Zoom
    this.register(SHORTCUTS.ZOOM_IN, () => this.zoomIn());
    this.register(SHORTCUTS.ZOOM_OUT, () => this.zoomOut());
  }

  /**
   * Setup keyboard event listeners
   */
  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;

      // Ignore if typing in input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = this.getKeyCombo(e);
      const handler = this.shortcuts.get(key);

      if (handler) {
        e.preventDefault();
        handler();
      }
    });
  }

  /**
   * Get key combination string from event
   * @param {KeyboardEvent} e
   * @returns {string}
   */
  getKeyCombo(e) {
    const parts = [];

    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Normalize space key
    const key = e.key === ' ' ? 'Space' : e.key;
    parts.push(key);

    return parts.join('+');
  }

  /**
   * Register a keyboard shortcut
   * @param {string} keyCombo - Key combination (e.g., "Ctrl+z")
   * @param {function(): void} handler - Handler function
   */
  register(keyCombo, handler) {
    this.shortcuts.set(keyCombo, handler);
  }

  /**
   * Unregister a keyboard shortcut
   * @param {string} keyCombo
   */
  unregister(keyCombo) {
    this.shortcuts.delete(keyCombo);
  }

  /**
   * Enable keyboard shortcuts
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable keyboard shortcuts
   */
  disable() {
    this.enabled = false;
  }

  // Action handlers

  togglePlayback() {
    const isPlaying = this.state.getState().isPlaying;
    this.state.dispatch(actions.setPlaying(!isPlaying), false);
  }

  pause() {
    this.state.dispatch(actions.setPlaying(false), false);
  }

  jumpBackward() {
    const currentTime = this.state.getState().playhead;
    const newTime = Math.max(0, currentTime - JUMP_INTERVAL);
    this.state.dispatch(actions.setPlayhead(newTime), false);
  }

  jumpForward() {
    const currentTime = this.state.getState().playhead;
    const newTime = currentTime + JUMP_INTERVAL;
    this.state.dispatch(actions.setPlayhead(newTime), false);
  }

  splitClip() {
    const state = this.state.getState();
    const selectedClip = state.clips.find(c => c.id === state.selectedClipId);
    const playhead = state.playhead;

    if (selectedClip && playhead >= selectedClip.start &&
        playhead < selectedClip.start + selectedClip.duration) {
      const splitPoint = playhead - selectedClip.start;
      this.state.dispatch(actions.splitClip(selectedClip.id, splitPoint));
    }
  }

  deleteClip() {
    const state = this.state.getState();
    if (state.selectedClipId) {
      this.state.dispatch(actions.removeClip(state.selectedClipId));
    }
  }

  /**
   * Copy selected clip (stores in clipboard variable)
   */
  copyClip() {
    const state = this.state.getState();
    const selectedClip = state.clips.find(c => c.id === state.selectedClipId);

    if (selectedClip) {
      // Store in a global clipboard variable (simple implementation)
      window._ytpClipboard = { ...selectedClip };
      console.log('Clip copied');
    }
  }

  /**
   * Paste clip from clipboard
   */
  pasteClip() {
    if (!window._ytpClipboard) {
      console.log('Nothing to paste');
      return;
    }

    const state = this.state.getState();
    const clipData = window._ytpClipboard;

    // Paste at current playhead
    this.state.dispatch(actions.addClip({
      ...clipData,
      id: crypto.randomUUID(),
      start: state.playhead,
    }));

    console.log('Clip pasted');
  }

  /**
   * Reverse selected clip
   */
  reverseClip() {
    const state = this.state.getState();
    if (state.selectedClipId) {
      this.state.dispatch(actions.reverseClip(state.selectedClipId));
    }
  }

  /**
   * Adjust speed of selected clip
   * @param {number} delta - Speed change amount
   */
  adjustSpeed(delta) {
    const state = this.state.getState();
    const selectedClip = state.clips.find(c => c.id === state.selectedClipId);

    if (selectedClip) {
      const currentSpeed = selectedClip.speed || 1.0;
      const newSpeed = Math.max(0.25, Math.min(4.0, currentSpeed + delta));
      this.state.dispatch(actions.setClipSpeed(selectedClip.id, newSpeed));
    }
  }

  /**
   * Zoom in timeline
   */
  zoomIn() {
    const currentZoom = this.state.getState().zoom;
    const newZoom = Math.min(MAX_ZOOM, currentZoom + ZOOM_STEP);
    this.state.dispatch(actions.setZoom(newZoom), false);
  }

  /**
   * Zoom out timeline
   */
  zoomOut() {
    const currentZoom = this.state.getState().zoom;
    const newZoom = Math.max(MIN_ZOOM, currentZoom - ZOOM_STEP);
    this.state.dispatch(actions.setZoom(newZoom), false);
  }
}
