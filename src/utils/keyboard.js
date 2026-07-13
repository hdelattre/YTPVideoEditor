/**
 * @fileoverview Keyboard shortcuts manager
 * YTP-optimized keyboard controls for rapid editing
 */

import { SHORTCUTS, JUMP_INTERVAL, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, MIN_CLIP_SPEED, MAX_CLIP_SPEED } from '../core/constants.js';
import * as actions from '../core/actions.js';
import { createId } from './id.js';

const CLIPBOARD_MIME = 'application/x-ytp-editor-clips';

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
    this.register(SHORTCUTS.STEP_FRAME_BACKWARD, () => this.stepFrame(-1));
    this.register(SHORTCUTS.STEP_FRAME_FORWARD, () => this.stepFrame(1));
    this.register(SHORTCUTS.NUDGE_CLIPS_BACKWARD, () => this.nudgeSelectedClips(-1));
    this.register(SHORTCUTS.NUDGE_CLIPS_FORWARD, () => this.nudgeSelectedClips(1));
    this.register(SHORTCUTS.NUDGE_EDGE_BACKWARD, () => this.nudgeNearestEdge(-1));
    this.register(SHORTCUTS.NUDGE_EDGE_FORWARD, () => this.nudgeNearestEdge(1));
    this.register(SHORTCUTS.TOGGLE_SNAPPING, () => this.toggleSnapping());

    // Editing
    this.register(SHORTCUTS.SPLIT, () => this.splitClip());
    this.register(SHORTCUTS.DELETE, () => this.deleteClip());
    this.register(SHORTCUTS.DELETE_BACKSPACE, () => this.deleteClip());

    // Undo/Redo
    this.register(SHORTCUTS.UNDO, () => this.state.undo());
    this.register(SHORTCUTS.REDO, () => this.state.redo());

    // Clipboard events are routed by the editor so external media files and
    // internal clips can share the native copy/paste commands.
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

  /**
   * Get the project frame rate used by frame-accurate timeline controls.
   * @returns {number}
   */
  getProjectFps() {
    const fps = Number(this.state.getState().exportSettings?.fps);
    return Number.isFinite(fps) && fps > 0 ? fps : 30;
  }

  /**
   * Move the playhead to the adjacent frame boundary.
   * @param {-1|1} direction
   */
  stepFrame(direction) {
    const state = this.state.getState();
    const frameDuration = 1000 / this.getProjectFps();
    const framePosition = state.playhead / frameDuration;
    const epsilon = 1e-7;
    const frameNumber = direction > 0
      ? Math.floor(framePosition + epsilon) + 1
      : Math.ceil(framePosition - epsilon) - 1;
    const newTime = Math.max(0, frameNumber * frameDuration);

    if (state.isPlaying) {
      this.state.dispatch(actions.setPlaying(false), false);
    }
    this.state.dispatch(actions.setPlayhead(newTime), false);
  }

  /**
   * Move all unlocked selected clips by one frame while preserving their spacing.
   * @param {-1|1} direction
   */
  nudgeSelectedClips(direction) {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    const selectedClips = state.clips.filter((clip) => {
      if (!selectedIds.includes(clip.id)) return false;
      const track = state.tracks.find(item => item.id === clip.trackId);
      return !track || !track.locked;
    });
    if (selectedClips.length === 0) return;

    const requestedDelta = direction * (1000 / this.getProjectFps());
    const minStart = Math.min(...selectedClips.map(clip => clip.start));
    const delta = Math.max(requestedDelta, -minStart);
    if (Math.abs(delta) < 1e-7) return;

    this.state.dispatch(actions.moveClips(selectedClips.map(clip => ({
      id: clip.id,
      start: clip.start + delta,
    }))));
  }

  /**
   * Nudge the selected clip edge nearest the playhead by one frame.
   * Source bounds are preserved for sped-up and reversed clips.
   * @param {-1|1} direction
   */
  nudgeNearestEdge(direction) {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    if (selectedIds.length !== 1) return;

    const clip = state.clips.find(item => item.id === selectedIds[0]);
    if (!clip) return;
    const track = state.tracks.find(item => item.id === clip.trackId);
    if (track && track.locked) return;

    const clipStart = clip.start;
    const clipEnd = clip.start + clip.duration;
    const edge = Math.abs(state.playhead - clipStart) <= Math.abs(state.playhead - clipEnd)
      ? 'left'
      : 'right';
    const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
    const trimStart = Number.isFinite(clip.trimStart) ? clip.trimStart : 0;
    const media = state.mediaLibrary.find(item => item.id === clip.mediaId);
    const mediaDuration = media && Number.isFinite(media.duration) && media.duration > 0
      ? media.duration
      : null;
    const minDuration = Math.min(clip.duration, 100, 1000 / this.getProjectFps());
    let delta = direction * (1000 / this.getProjectFps());

    if (edge === 'left') {
      delta = Math.max(delta, -clipStart);
      delta = Math.min(delta, clip.duration - minDuration);

      if (!clip.reversed) {
        delta = Math.max(delta, -trimStart / speed);
      } else if (delta < 0 && mediaDuration !== null) {
        const sourceEnd = trimStart + clip.duration * speed;
        const availableSource = Math.max(0, mediaDuration - sourceEnd);
        delta = Math.max(delta, -availableSource / speed);
      }

      if (Math.abs(delta) < 1e-7) return;
      this.state.dispatch(actions.updateClip(clip.id, {
        start: clip.start + delta,
        duration: clip.duration - delta,
        trimStart: clip.reversed ? trimStart : trimStart + delta * speed,
      }));
      return;
    }

    delta = Math.max(delta, minDuration - clip.duration);
    if (clip.reversed) {
      delta = Math.min(delta, trimStart / speed);
    } else if (delta > 0 && mediaDuration !== null) {
      const sourceEnd = trimStart + clip.duration * speed;
      const availableSource = Math.max(0, mediaDuration - sourceEnd);
      delta = Math.min(delta, availableSource / speed);
    }

    if (Math.abs(delta) < 1e-7) return;
    this.state.dispatch(actions.updateClip(clip.id, {
      duration: clip.duration + delta,
      trimStart: clip.reversed ? trimStart - delta * speed : trimStart,
    }));
  }

  /** Toggle magnetic timeline snapping. */
  toggleSnapping() {
    const enabled = this.state.getState().snappingEnabled !== false;
    this.state.dispatch(actions.setSnappingEnabled(!enabled), false);
  }

  splitClip() {
    const state = this.state.getState();
    const selectedClip = state.clips.find(c => c.id === state.selectedClipId);
    const selectedTrack = selectedClip
      ? state.tracks.find(track => track.id === selectedClip.trackId)
      : null;
    const playhead = state.playhead;

    if (selectedClip && !(selectedTrack && selectedTrack.locked) && playhead >= selectedClip.start &&
        playhead < selectedClip.start + selectedClip.duration) {
      const splitPoint = playhead - selectedClip.start;
      this.state.dispatch(actions.splitClip(selectedClip.id, splitPoint));
    }
  }

  deleteClip() {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
    const unlockedIds = selectedIds.filter((id) => {
      const clip = state.clips.find(item => item.id === id);
      const track = clip ? state.tracks.find(item => item.id === clip.trackId) : null;
      return !track || !track.locked;
    });
    if (unlockedIds.length > 0) {
      this.state.dispatch(actions.removeClips(unlockedIds));
    } else if (state.selectedClipId) {
      const clip = state.clips.find(item => item.id === state.selectedClipId);
      const track = clip ? state.tracks.find(item => item.id === clip.trackId) : null;
      if (!track || !track.locked) {
        this.state.dispatch(actions.removeClip(state.selectedClipId));
      }
    }
  }

  /**
   * Copy selected clips into the in-memory and native clipboard payloads.
   * @param {DataTransfer|null} [clipboardData]
   * @returns {boolean} Whether clips were copied
   */
  copyClip(clipboardData = null) {
    const state = this.state.getState();
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));

    if (selectedClips.length === 0) return false;

    window._ytpClipboard = {
      clips: selectedClips.map((clip) => {
        const clipboardClip = { ...clip };
        // Derived waveform samples can be large and are regenerated from the media source.
        delete clipboardClip.waveformData;
        return clipboardClip;
      }),
    };
    if (clipboardData) {
      try {
        clipboardData.setData(
          'text/plain',
          `${selectedClips.length} YTP Editor clip${selectedClips.length === 1 ? '' : 's'}`
        );
        clipboardData.setData(CLIPBOARD_MIME, JSON.stringify(window._ytpClipboard));
      } catch (error) {
        console.warn('Could not write editor clips to the system clipboard:', error);
      }
    }
    console.log('Clips copied');
    return true;
  }

  /** Read an internal clip payload from a native paste event. */
  readClipClipboardData(clipboardData) {
    if (!clipboardData) return null;
    try {
      const serialized = clipboardData.getData(CLIPBOARD_MIME);
      if (!serialized) return null;
      const parsed = JSON.parse(serialized);
      return parsed && Array.isArray(parsed.clips) && parsed.clips.length > 0 ? parsed : null;
    } catch (error) {
      console.warn('Could not read editor clips from the system clipboard:', error);
      return null;
    }
  }

  /**
   * Paste clip from clipboard
   * @param {{clips?: object[]}|object|null} [clipboardData]
   * @returns {boolean} Whether clips were pasted
   */
  pasteClip(clipboardData = window._ytpClipboard) {
    if (!clipboardData) {
      console.log('Nothing to paste');
      return false;
    }

    const state = this.state.getState();
    const clipData = clipboardData;

    if (clipData.clips && Array.isArray(clipData.clips)) {
      const clips = clipData.clips;
      if (clips.length === 0) return false;
      const minStart = Math.min(...clips.map(clip => clip.start));
      const offset = state.playhead - minStart;

      clips.forEach(clip => {
        this.state.dispatch(actions.addClip({
          ...clip,
          id: createId(),
          start: clip.start + offset,
        }));
      });

      console.log('Clips pasted');
      return true;
    }

    // Backward compatibility for single clip
    this.state.dispatch(actions.addClip({
      ...clipData,
      id: createId(),
      start: state.playhead,
    }));

    console.log('Clip pasted');
    return true;
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
      const newSpeed = Math.max(MIN_CLIP_SPEED, Math.min(MAX_CLIP_SPEED, currentSpeed + delta));
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
