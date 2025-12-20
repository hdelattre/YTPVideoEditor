/**
 * @fileoverview State management with undo/redo support
 * State management with history tracking and pub/sub
 */

import { MAX_HISTORY_LEVELS, DEFAULT_TRACK_COUNT } from './constants.js';

/**
 * State Manager with history tracking and pub/sub
 */
export class StateManager {
  constructor() {
    /** @type {import('./types.js').EditorState} */
    this.state = this.createInitialState();

    /** @type {import('./types.js').EditorState[]} */
    this.history = [];

    /** @type {import('./types.js').EditorState[]} */
    this.future = [];

    this.maxHistory = MAX_HISTORY_LEVELS;

    /** @type {Set<function(import('./types.js').EditorState): void>} */
    this.listeners = new Set();
  }

  /**
   * Create initial empty state
   * @returns {import('./types.js').EditorState}
   */
  createInitialState() {
    return {
      project: {
        id: crypto.randomUUID(),
        name: 'Untitled Project',
        createdAt: Date.now(),
        modifiedAt: Date.now(),
      },
      clips: [],
      tracks: this.createDefaultTracks(),
      mediaLibrary: [],
      playhead: 0,
      zoom: 0,
      selectedClipId: null,
      selectedClipIds: [],
      isPlaying: false,
      exportState: {
        isExporting: false,
        progress: 0,
      },
      scrollX: 0,
    };
  }

  /**
   * Create default tracks
   * @returns {import('./types.js').Track[]}
   */
  createDefaultTracks() {
    const tracks = [];
    for (let i = 0; i < DEFAULT_TRACK_COUNT; i++) {
      tracks.push({
        id: i,
        name: `Track ${i + 1}`,
        muted: false,
        locked: false,
        visible: true,
      });
    }
    return tracks;
  }

  /**
   * Dispatch an action to mutate state
   * @param {import('./types.js').ActionFunction} actionFn - Function that mutates state
   * @param {boolean} historyEnabled - Whether to add to undo history
   */
  dispatch(actionFn, historyEnabled = true) {
    if (historyEnabled) {
      // Save current state to history
      this.history.push(this.cloneState(this.state));

      // Trim history if too large
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }

      // Clear redo stack on new action
      this.future = [];
    }

    // Apply action
    this.state = actionFn(this.cloneState(this.state));
    this.state.project.modifiedAt = Date.now();

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Undo last action
   */
  undo() {
    if (this.history.length === 0) {
      console.warn('Nothing to undo');
      return;
    }

    // Save current state to future
    this.future.push(this.cloneState(this.state));

    // Restore from history
    this.state = this.history.pop();

    this.notifyListeners();
  }

  /**
   * Redo last undone action
   */
  redo() {
    if (this.future.length === 0) {
      console.warn('Nothing to redo');
      return;
    }

    // Save current state to history
    this.history.push(this.cloneState(this.state));

    // Restore from future
    this.state = this.future.pop();

    this.notifyListeners();
  }

  /**
   * Subscribe to state changes
   * @param {function(import('./types.js').EditorState): void} listener
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   */
  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('Error in state listener:', error);
      }
    });
  }

  /**
   * Deep clone state object
   * @param {import('./types.js').EditorState} state
   * @returns {import('./types.js').EditorState}
   */
  cloneState(state) {
    // Use structuredClone for deep cloning (modern browsers)
    // Note: VideoFrame and other non-cloneable objects should not be in state
    try {
      return structuredClone(state);
    } catch (error) {
      console.warn('structuredClone failed, falling back to JSON clone:', error);
      // Fallback for objects with non-cloneable properties
      return JSON.parse(JSON.stringify(state));
    }
  }

  /**
   * Get current state (read-only)
   * @returns {Readonly<import('./types.js').EditorState>}
   */
  getState() {
    return this.state;
  }

  /**
   * Check if undo is available
   * @returns {boolean}
   */
  canUndo() {
    return this.history.length > 0;
  }

  /**
   * Check if redo is available
   * @returns {boolean}
   */
  canRedo() {
    return this.future.length > 0;
  }

  /**
   * Reset state to initial
   */
  reset() {
    this.state = this.createInitialState();
    this.history = [];
    this.future = [];
    this.notifyListeners();
  }

  /**
   * Load state from serialized JSON
   * @param {string} json
   */
  loadFromJSON(json) {
    try {
      const loadedState = JSON.parse(json);
      if (!Array.isArray(loadedState.selectedClipIds)) {
        loadedState.selectedClipIds = loadedState.selectedClipId
          ? [loadedState.selectedClipId]
          : [];
      }
      this.state = loadedState;
      this.history = [];
      this.future = [];
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to load state from JSON:', error);
      throw error;
    }
  }

  /**
   * Serialize state to JSON
   * @returns {string}
   */
  toJSON() {
    return JSON.stringify(this.state, null, 2);
  }
}
