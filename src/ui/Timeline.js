/**
 * @fileoverview Timeline UI component
 * Multi-track canvas-based timeline with drag-and-drop
 */

import { Canvas2DRenderer } from '../rendering/Canvas2DRenderer.js';
import {
  TRACK_HEIGHT,
  RULER_HEIGHT,
  MIN_CLIP_WIDTH,
  PLAYHEAD_WIDTH,
  COLORS,
  ZOOM_STEP,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../core/constants.js';
import { timeToPixels, pixelsToTime, getTimelineDuration } from '../utils/time.js';
import * as actions from '../core/actions.js';

/**
 * Timeline component
 */
export class Timeline {
  /**
   * @param {HTMLElement} containerEl
   * @param {import('../core/state.js').StateManager} stateManager
   */
  constructor(containerEl, stateManager) {
    this.container = containerEl;
    this.state = stateManager;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'timeline-canvas';
    this.container.appendChild(this.canvas);

    // Create renderer
    this.renderer = new Canvas2DRenderer(this.canvas);

    // Interaction state
    this.dragState = null;
    this.hoverClipId = null;
    this.resizeHandle = null; // 'left', 'right', or null

    // Scroll state
    this.scrollX = 0;
    this.lastZoom = this.state.getState().zoom;
    this.zoomAnchor = null;

    this.setupCanvas();
    this.setupEventListeners();

    // Subscribe to state changes
    this.unsubscribe = this.state.subscribe((state) => {
      this.render(state);
    });

    // Initial render
    this.render(this.state.getState());
  }

  /**
   * Setup canvas dimensions
   */
  setupCanvas() {
    this.resizeCanvas();

    // Handle window resize
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  /**
   * Resize canvas to fit container
   */
  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.render(this.state.getState());
  }

  /**
   * Get max scroll position for current zoom and content
   * @param {import('../core/types.js').EditorState} state
   * @param {number} visibleWidth
   * @returns {number}
   */
  getMaxScroll(state, visibleWidth) {
    const duration = getTimelineDuration(state.clips);
    const totalWidth = timeToPixels(duration, state.zoom);
    return Math.max(0, totalWidth - visibleWidth);
  }

  /**
   * Setup event listeners for interaction
   */
  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', (e) => this.onPointerUp(e));

    // Wheel for zoom
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Prevent context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Drag and drop
    this.canvas.addEventListener('dragover', (e) => this.onDragOver(e));
    this.canvas.addEventListener('drop', (e) => this.onDrop(e));
  }

  /**
   * Main render method
   * @param {import('../core/types.js').EditorState} state
   */
  render(state) {
    this.renderer.clear();

    const visibleWidth = this.renderer.width;
    const visibleHeight = this.renderer.height;
    const timelineHeight = state.tracks.length * TRACK_HEIGHT + RULER_HEIGHT;

    if (this.lastZoom !== state.zoom) {
      if (this.zoomAnchor !== 'mouse') {
        const playheadX = timeToPixels(state.playhead, state.zoom);
        this.scrollX = playheadX - visibleWidth / 2;
      }
      this.zoomAnchor = null;
      this.lastZoom = state.zoom;
    }

    const maxScroll = this.getMaxScroll(state, visibleWidth);
    this.scrollX = Math.max(0, Math.min(this.scrollX, maxScroll));

    // Calculate visible time range
    const startTime = pixelsToTime(this.scrollX, state.zoom);
    const endTime = pixelsToTime(this.scrollX + visibleWidth, state.zoom);
    const pixelsPerMs = Math.pow(2, state.zoom) * (100 / 1000); // pixels per millisecond

    // Draw time ruler
    this.renderer.drawTimeRuler(startTime, endTime, pixelsPerMs, RULER_HEIGHT);

    // Draw tracks
    state.tracks.forEach((track, index) => {
      const y = RULER_HEIGHT + index * TRACK_HEIGHT;
      this.renderer.drawTrackBackground(y, visibleWidth, TRACK_HEIGHT, index % 2 === 1);
    });

    // Draw clips
    const visibleClips = this.getVisibleClips(state, startTime, endTime);
    visibleClips.forEach(clip => {
      this.drawClip(clip, state);
    });

    // Draw playhead
    const playheadX = timeToPixels(state.playhead, state.zoom) - this.scrollX;
    if (playheadX >= 0 && playheadX <= visibleWidth) {
      this.renderer.drawPlayhead(playheadX, timelineHeight, COLORS.playhead);
    }
  }

  /**
   * Get clips visible in current viewport
   * @param {import('../core/types.js').EditorState} state
   * @param {number} startTime
   * @param {number} endTime
   * @returns {import('../core/types.js').Clip[]}
   */
  getVisibleClips(state, startTime, endTime) {
    return state.clips.filter(clip => {
      const clipEnd = clip.start + clip.duration;
      // Clip is visible if it overlaps with viewport
      return clipEnd >= startTime && clip.start <= endTime;
    });
  }

  /**
   * Draw a single clip
   * @param {import('../core/types.js').Clip} clip
   * @param {import('../core/types.js').EditorState} state
   */
  drawClip(clip, state) {
    const track = state.tracks.find(t => t.id === clip.trackId);
    if (!track || !track.visible) return;

    const trackIndex = state.tracks.indexOf(track);
    const x = timeToPixels(clip.start, state.zoom) - this.scrollX;
    const y = RULER_HEIGHT + trackIndex * TRACK_HEIGHT + 2;
    const width = Math.max(MIN_CLIP_WIDTH, timeToPixels(clip.duration, state.zoom));
    const height = TRACK_HEIGHT - 4;

    const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
    const selected = selectedIds.includes(clip.id) || clip.id === state.selectedClipId;

    // Draw clip
    this.renderer.drawClip(clip, x, y, width, height, selected);

    // Draw waveform if available
    if (clip.waveformData) {
      this.renderer.drawWaveform(
        clip.waveformData,
        x + 4,
        y + 4,
        width - 8,
        height - 8,
        'rgba(74, 158, 255, 0.5)'
      );
    }
  }

  /**
   * Handle pointer down (start drag/resize)
   * @param {PointerEvent} e
   */
  onPointerDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const state = this.state.getState();

    // Check if clicking on playhead (anywhere on the vertical line)
    const playheadX = timeToPixels(state.playhead, state.zoom) - this.scrollX;
    if (Math.abs(x - playheadX) < 8) {
      this.dragState = {
        type: 'playhead',
        startX: x,
      };
      return;
    }

    // Check if clicking in ruler area (to jump playhead)
    if (y < RULER_HEIGHT) {
      // Jump playhead to click position
      const newTime = Math.max(0, pixelsToTime(x + this.scrollX, state.zoom));
      this.state.dispatch(actions.setPlayhead(newTime), false);

      // Start dragging playhead
      this.dragState = {
        type: 'playhead',
        startX: x,
      };
      return;
    }

    // Check if clicking on a clip
    const clickedClip = this.getClipAtPoint(x, y, state);

    if (clickedClip) {
      const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
      const clipX = timeToPixels(clickedClip.start, state.zoom) - this.scrollX;
      const clipWidth = timeToPixels(clickedClip.duration, state.zoom);
      const isToggle = e.ctrlKey || e.metaKey;
      const isAdd = e.shiftKey;

      // Check if clicking on resize handles
      const isLeftHandle = Math.abs(x - clipX) < 5;
      const isRightHandle = Math.abs(x - (clipX + clipWidth)) < 5;

      if (isLeftHandle || isRightHandle) {
        if (!selectedIds.includes(clickedClip.id) || selectedIds.length > 1) {
          this.state.dispatch(actions.setSelection([clickedClip.id], clickedClip.id));
        }
        this.dragState = {
          type: 'resize',
          clip: clickedClip,
          handle: isLeftHandle ? 'left' : 'right',
          startX: x,
          originalStart: clickedClip.start,
          originalDuration: clickedClip.duration,
          originalTrimStart: clickedClip.trimStart,
          snapBoundariesByTrack: this.buildSnapBoundaries(state, new Set([clickedClip.id])),
          snapThreshold: this.getSnapThreshold(state),
          historySnapshot: this.state.getState(),
          didUpdate: false,
        };
        return;
      }

      if (isToggle) {
        this.state.dispatch(actions.toggleClipSelection(clickedClip.id));
        return;
      }

      if (isAdd) {
        this.state.dispatch(actions.addClipToSelection(clickedClip.id));
        return;
      }

      const activeSelection = selectedIds.includes(clickedClip.id)
        ? selectedIds
        : [clickedClip.id];
      if (!selectedIds.includes(clickedClip.id) || selectedIds.length !== 1) {
        this.state.dispatch(actions.setSelection(activeSelection, clickedClip.id));
      }

      // Start dragging selected clips
      const selectedClips = state.clips
        .filter(clip => activeSelection.includes(clip.id))
        .map(clip => ({
          id: clip.id,
          originalStart: clip.start,
          originalTrackId: clip.trackId,
        }));
      const minStart = selectedClips.reduce(
        (min, clip) => Math.min(min, clip.originalStart),
        Infinity
      );

      this.dragState = {
        type: 'move',
        clip: clickedClip,
        startX: x,
        originalStart: clickedClip.start,
        originalTrackId: clickedClip.trackId,
        selectedClips,
        minStart,
        snapBoundariesByTrack: this.buildSnapBoundaries(state, new Set(activeSelection)),
        snapThreshold: this.getSnapThreshold(state),
        historySnapshot: this.state.getState(),
        didUpdate: false,
      };
    } else {
      // Deselect if clicking on empty space
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        this.state.dispatch(actions.setSelection([], null));
      }
    }
  }

  /**
   * Handle pointer move (drag/resize)
   * @param {PointerEvent} e
   */
  onPointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const state = this.state.getState();

    // Update cursor based on hover
    this.updateCursor(x, y, state);

    if (!this.dragState) return;

    const deltaX = x - this.dragState.startX;
    const deltaTime = pixelsToTime(deltaX, state.zoom);

    if (this.dragState.type === 'playhead') {
      // Drag playhead
      const newTime = Math.max(0, pixelsToTime(x + this.scrollX, state.zoom));
      this.state.dispatch(actions.setPlayhead(newTime), false);

    } else if (this.dragState.type === 'move') {
      // Move selected clips
      const trackIndex = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
      const newTrackId = Math.max(0, Math.min(state.tracks.length - 1, trackIndex));
      const deltaTrack = newTrackId - this.dragState.originalTrackId;

      let adjustedDeltaTime = deltaTime;
      if (this.dragState.minStart + adjustedDeltaTime < 0) {
        adjustedDeltaTime = -this.dragState.minStart;
      }

      if (Math.abs(deltaTime) > 0.001) {
        const snapDelta = this.getMoveSnapDelta(state, this.dragState, adjustedDeltaTime, deltaTrack);
        if (snapDelta !== 0) {
          adjustedDeltaTime += snapDelta;
          if (this.dragState.minStart + adjustedDeltaTime < 0) {
            adjustedDeltaTime = -this.dragState.minStart;
          }
        }
      }

      if (adjustedDeltaTime === 0 && deltaTrack === 0) {
        return;
      }

      const moves = (this.dragState.selectedClips || []).map(clip => {
        const start = Math.max(0, clip.originalStart + adjustedDeltaTime);
        const trackId = Math.max(
          0,
          Math.min(state.tracks.length - 1, clip.originalTrackId + deltaTrack)
        );
        return { id: clip.id, start, trackId };
      });

      if (moves.length > 0) {
        this.state.dispatch(actions.moveClips(moves), false);
        this.dragState.didUpdate = true;
      }

    } else if (this.dragState.type === 'resize') {
      // Resize clip
      const clip = this.dragState.clip;

      if (this.dragState.handle === 'left') {
        // Resize from left (adjust start and trim)
        let adjustedDeltaTime = deltaTime;
        if (Math.abs(deltaTime) > 0.001) {
          const snapDelta = this.getResizeSnapDelta(state, this.dragState, adjustedDeltaTime, 'start');
          if (snapDelta !== 0) {
            const snappedDelta = adjustedDeltaTime + snapDelta;
            const clampedSnapped = Math.max(snappedDelta, -this.dragState.originalStart);
            const snappedDuration = this.dragState.originalDuration - clampedSnapped;
            const snappedTrimStart = this.dragState.originalTrimStart + clampedSnapped;
            if (snappedDuration > 100 && snappedTrimStart >= 0) {
              adjustedDeltaTime = clampedSnapped;
            }
          }
        }
        if (this.dragState.originalStart + adjustedDeltaTime < 0) {
          adjustedDeltaTime = -this.dragState.originalStart;
        }
        const newStart = Math.max(0, this.dragState.originalStart + adjustedDeltaTime);
        const newTrimStart = this.dragState.originalTrimStart + adjustedDeltaTime;
        const newDuration = this.dragState.originalDuration - adjustedDeltaTime;

        if (newDuration > 100 && newTrimStart >= 0) { // Min duration 100ms
          this.state.dispatch(actions.updateClip(clip.id, {
            start: newStart,
            trimStart: newTrimStart,
            duration: newDuration,
          }), false);
          this.dragState.didUpdate = true;
        }

      } else if (this.dragState.handle === 'right') {
        // Resize from right (adjust duration)
        let adjustedDeltaTime = deltaTime;
        if (Math.abs(deltaTime) > 0.001) {
          const snapDelta = this.getResizeSnapDelta(state, this.dragState, adjustedDeltaTime, 'end');
          if (snapDelta !== 0) {
            const snappedDelta = adjustedDeltaTime + snapDelta;
            const snappedDuration = this.dragState.originalDuration + snappedDelta;
            if (snappedDuration >= 100) {
              adjustedDeltaTime = snappedDelta;
            }
          }
        }
        const newDuration = Math.max(100, this.dragState.originalDuration + adjustedDeltaTime);

        if (newDuration !== clip.duration) {
          this.state.dispatch(actions.updateClip(clip.id, {
            duration: newDuration,
          }), false);
          this.dragState.didUpdate = true;
        }
      }
    }
  }

  /**
   * Handle pointer up (end drag)
   * @param {PointerEvent} e
   */
  onPointerUp(e) {
    if (this.dragState && this.dragState.historySnapshot && this.dragState.didUpdate) {
      this.state.dispatch(state => state, true, this.dragState.historySnapshot);
    }
    this.dragState = null;
    this.canvas.style.cursor = 'default';
  }

  /**
   * Handle mouse wheel (zoom)
   * @param {WheelEvent} e
   */
  onWheel(e) {
    e.preventDefault();

    const state = this.state.getState();

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomStep = ZOOM_STEP * 0.5;
      const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + delta));

      // Zoom around playhead (consistent with zoom buttons)
      this.zoomAnchor = 'playhead';
      this.state.dispatch(actions.setZoom(newZoom), false);

    } else {
      // Horizontal scroll
      const scrollDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.scrollX += scrollDelta;
      const maxScroll = this.getMaxScroll(state, this.renderer.width);
      this.scrollX = Math.max(0, Math.min(this.scrollX, maxScroll));
      this.render(state);
    }
  }

  /**
   * Update cursor based on hover position
   * @param {number} x
   * @param {number} y
   * @param {import('../core/types.js').EditorState} state
   */
  updateCursor(x, y, state) {
    if (this.dragState) return; // Don't change cursor while dragging

    const clip = this.getClipAtPoint(x, y, state);

    if (clip) {
      const clipX = timeToPixels(clip.start, state.zoom) - this.scrollX;
      const clipWidth = timeToPixels(clip.duration, state.zoom);

      const isLeftHandle = Math.abs(x - clipX) < 5;
      const isRightHandle = Math.abs(x - (clipX + clipWidth)) < 5;

      if (isLeftHandle || isRightHandle) {
        this.canvas.style.cursor = 'ew-resize';
      } else {
        this.canvas.style.cursor = 'move';
      }
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Get clip at given point
   * @param {number} x
   * @param {number} y
   * @param {import('../core/types.js').EditorState} state
   * @returns {import('../core/types.js').Clip|null}
   */
  getClipAtPoint(x, y, state) {
    if (y < RULER_HEIGHT) return null;

    const trackIndex = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
    if (trackIndex < 0 || trackIndex >= state.tracks.length) return null;

    const track = state.tracks[trackIndex];
    const time = pixelsToTime(x + this.scrollX, state.zoom);

    // Find clip at this time and track
    return state.clips.find(clip =>
      clip.trackId === track.id &&
      time >= clip.start &&
      time < clip.start + clip.duration
    ) || null;
  }

  /**
   * Get snapping threshold in milliseconds based on export FPS
   * @param {import('../core/types.js').EditorState} state
   * @returns {number}
   */
  getSnapThreshold(state) {
    const fps = state.exportSettings && state.exportSettings.fps ? state.exportSettings.fps : 30;
    const threshold = (1000 / fps) * 1.5;
    return Math.min(100, Math.max(10, threshold));
  }

  /**
   * Build snap boundary lists per track index
   * @param {import('../core/types.js').EditorState} state
   * @param {Set<string>} excludedIds
   * @returns {number[][]}
   */
  buildSnapBoundaries(state, excludedIds) {
    const boundariesByTrack = state.tracks.map(() => [0]);
    state.clips.forEach((clip) => {
      if (excludedIds.has(clip.id)) return;
      const trackIndex = clip.trackId;
      if (trackIndex < 0 || trackIndex >= boundariesByTrack.length) return;
      boundariesByTrack[trackIndex].push(clip.start, clip.start + clip.duration);
    });
    return boundariesByTrack;
  }

  /**
   * Find snap delta for a time given a boundary list
   * @param {number} time
   * @param {number[]} boundaries
   * @param {number} threshold
   * @returns {number}
   */
  findSnapDelta(time, boundaries, threshold) {
    let bestDelta = 0;
    let bestAbs = threshold + 1;
    boundaries.forEach((boundary) => {
      const delta = boundary - time;
      const absDelta = Math.abs(delta);
      if (absDelta > 0 && absDelta <= threshold && absDelta < bestAbs) {
        bestAbs = absDelta;
        bestDelta = delta;
      }
    });
    return bestDelta;
  }

  /**
   * Compute snap delta for moving selected clips
   * @param {import('../core/types.js').EditorState} state
   * @param {object} dragState
   * @param {number} deltaTime
   * @param {number} deltaTrack
   * @returns {number}
   */
  getMoveSnapDelta(state, dragState, deltaTime, deltaTrack) {
    const threshold = dragState.snapThreshold || this.getSnapThreshold(state);
    if (!threshold) return 0;
    const boundariesByTrack = dragState.snapBoundariesByTrack || [];
    let bestDelta = 0;
    let bestAbs = threshold + 1;

    (dragState.selectedClips || []).forEach((selected) => {
      const clip = state.clips.find(c => c.id === selected.id);
      if (!clip) return;
      const targetTrackId = Math.max(
        0,
        Math.min(state.tracks.length - 1, selected.originalTrackId + deltaTrack)
      );
      const boundaries = boundariesByTrack[targetTrackId];
      if (!boundaries || boundaries.length === 0) return;
      const newStart = selected.originalStart + deltaTime;
      const newEnd = newStart + clip.duration;
      [newStart, newEnd].forEach((edge) => {
        const delta = this.findSnapDelta(edge, boundaries, threshold);
        const absDelta = Math.abs(delta);
        if (delta !== 0 && absDelta < bestAbs) {
          bestAbs = absDelta;
          bestDelta = delta;
        }
      });
    });

    return bestDelta;
  }

  /**
   * Compute snap delta for resizing a clip
   * @param {import('../core/types.js').EditorState} state
   * @param {object} dragState
   * @param {number} deltaTime
   * @param {'start'|'end'} edge
   * @returns {number}
   */
  getResizeSnapDelta(state, dragState, deltaTime, edge) {
    const threshold = dragState.snapThreshold || this.getSnapThreshold(state);
    if (!threshold) return 0;
    const boundariesByTrack = dragState.snapBoundariesByTrack || [];
    const trackId = dragState.clip.trackId;
    const boundaries = boundariesByTrack[trackId];
    if (!boundaries || boundaries.length === 0) return 0;
    const edgeTime = edge === 'start'
      ? dragState.originalStart + deltaTime
      : dragState.originalStart + dragState.originalDuration + deltaTime;
    return this.findSnapDelta(edgeTime, boundaries, threshold);
  }

  /**
   * Handle drag over (allow drop)
   * @param {DragEvent} e
   */
  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Handle drop (add media to timeline)
   * @param {DragEvent} e
   */
  onDrop(e) {
    e.preventDefault();

    const mediaId = e.dataTransfer.getData('mediaId');
    if (!mediaId) return;

    const state = this.state.getState();
    const media = state.mediaLibrary.find(m => m.id === mediaId);
    if (!media) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate drop position
    const time = pixelsToTime(x + this.scrollX, state.zoom);
    const trackIndex = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
    const trackId = Math.max(0, Math.min(state.tracks.length - 1, trackIndex));

    // Add clip at drop position
    this.state.dispatch(actions.addClip({
      name: media.name,
      mediaId: media.id,
      trackId: trackId,
      start: Math.max(0, time),
      duration: media.duration,
      color: '#4a9eff',
    }));
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
