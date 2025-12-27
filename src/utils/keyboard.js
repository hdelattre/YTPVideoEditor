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
    this.register(SHORTCUTS.DELETE_BACKSPACE, () => this.deleteClip());

    // Undo/Redo
    this.register(SHORTCUTS.UNDO, () => this.state.undo());
    this.register(SHORTCUTS.REDO, () => this.state.redo());

    // Clipboard (basic implementation)
    this.register(SHORTCUTS.COPY, () => this.copyClip());
    this.register(SHORTCUTS.PASTE, () => this.pasteClip());
    this.register(SHORTCUTS.SELECT_ALL, () => this.selectAllClips());
    this.register(SHORTCUTS.SELECT_LEFT, () => this.selectClipsLeft());
    this.register(SHORTCUTS.SELECT_RIGHT, () => this.selectClipsRight());

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
    const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
    if (selectedIds.length > 0) {
      this.state.dispatch(actions.removeClips(selectedIds));
    } else if (state.selectedClipId) {
      this.state.dispatch(actions.removeClip(state.selectedClipId));
    }
  }

  /**
   * Copy selected clip (stores in clipboard variable)
   */
  copyClip() {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));

    if (selectedClips.length > 0) {
      window._ytpClipboard = {
        clips: selectedClips.map(clip => ({ ...clip })),
      };
      console.log('Clips copied');
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

    if (clipData.clips && Array.isArray(clipData.clips)) {
      const clips = clipData.clips;
      const minStart = Math.min(...clips.map(clip => clip.start));
      const offset = state.playhead - minStart;

      clips.forEach(clip => {
        this.state.dispatch(actions.addClip({
          ...clip,
          id: crypto.randomUUID(),
          start: clip.start + offset,
        }));
      });

      console.log('Clips pasted');
      return;
    }

    // Backward compatibility for single clip
    this.state.dispatch(actions.addClip({
      ...clipData,
      id: crypto.randomUUID(),
      start: state.playhead,
    }));

    console.log('Clip pasted');
  }

  /**
   * Select all clips on the timeline
   */
  selectAllClips() {
    const state = this.state.getState();
    const allIds = state.clips.map(clip => clip.id);
    if (allIds.length === 0) return;
    const primary = state.selectedClipId && allIds.includes(state.selectedClipId)
      ? state.selectedClipId
      : allIds[0];
    this.state.dispatch(actions.setSelection(allIds, primary));
  }

  /**
   * Add all clips to the left of the current selection
   */
  selectClipsLeft() {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    if (selectedIds.length === 0) return;
    const selectedClips = state.clips.filter(clip => selectedIds.includes(clip.id));
    if (selectedClips.length === 0) return;
    const selectionStart = Math.min(...selectedClips.map(clip => clip.start));
    const leftIds = state.clips
      .filter(clip => (clip.start + clip.duration) <= selectionStart)
      .map(clip => clip.id);
    const nextIds = Array.from(new Set([...selectedIds, ...leftIds]));
    const primary = state.selectedClipId && nextIds.includes(state.selectedClipId)
      ? state.selectedClipId
      : nextIds[0];
    this.state.dispatch(actions.setSelection(nextIds, primary));
  }

  /**
   * Add all clips to the right of the current selection
   */
  selectClipsRight() {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    if (selectedIds.length === 0) return;
    const selectedClips = state.clips.filter(clip => selectedIds.includes(clip.id));
    if (selectedClips.length === 0) return;
    const selectionStart = Math.min(...selectedClips.map(clip => clip.start));
    const rightIds = state.clips
      .filter(clip => clip.start >= selectionStart)
      .map(clip => clip.id);
    const nextIds = Array.from(new Set([...selectedIds, ...rightIds]));
    const primary = state.selectedClipId && nextIds.includes(state.selectedClipId)
      ? state.selectedClipId
      : nextIds[0];
    this.state.dispatch(actions.setSelection(nextIds, primary));
  }

  /**
   * Reverse selected clip
   */
  reverseClip() {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
    if (selectedIds.length > 0) {
      selectedIds.forEach(id => {
        this.state.dispatch(actions.reverseClip(id));
      });
    } else if (state.selectedClipId) {
      this.state.dispatch(actions.reverseClip(state.selectedClipId));
    }
  }

  /**
   * Adjust speed of selected clip
   * @param {number} delta - Speed change amount
   */
  adjustSpeed(delta) {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));

    if (selectedClips.length > 0) {
      const currentSpeed = selectedClips[0].speed || 1.0;
      const newSpeed = Math.max(0.25, Math.min(4.0, currentSpeed + delta));
      if (selectedClips.length > 1) {
        this.state.dispatch(actions.setClipsSpeed(selectedIds, newSpeed));
      } else {
        this.state.dispatch(actions.setClipSpeed(selectedClips[0].id, newSpeed));
      }
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
