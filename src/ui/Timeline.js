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
   * @param {{scrollEl?: HTMLInputElement|null}} [options]
   */
  constructor(containerEl, stateManager, options = {}) {
    this.container = containerEl;
    this.state = stateManager;
    this.scrollEl = options && options.scrollEl ? options.scrollEl : null;

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
    this.lastPointer = null;
    this.isPointerOverTimeline = false;

    this.setupCanvas();
    this.setupEventListeners();
    this.setupScrollbar();

    // Subscribe to state changes
    this.unsubscribe = this.state.subscribe((state) => {
      this.render(state);
    });

    // Initial render
    this.render(this.state.getState());
  }

  /**
   * Hit area size for resize handles (touch needs a larger target).
   * @param {number} clipWidthPx
   * @param {string} pointerType
   * @returns {number}
   */
  getResizeHandleHitSlopPx(clipWidthPx, pointerType) {
    const isTouch = pointerType === 'touch' || pointerType === 'pen';
    const isSmallScreen = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 900px)').matches;
    const base = isTouch ? 22 : (isSmallScreen ? 12 : 6);
    const maxSlop = Math.max(6, Math.floor(clipWidthPx / 2));
    return Math.min(base, maxSlop);
  }

  /**
   * Get resize handle slop for inside vs outside the clip bounds.
   * Outside slop is intentionally larger so users can grab handles by aiming just past the edge.
   * @param {number} clipWidthPx
   * @param {string} pointerType
   * @returns {{interior: number, exterior: number}}
   */
  getResizeHandleSlopPx(clipWidthPx, pointerType) {
    const isTouch = pointerType === 'touch' || pointerType === 'pen';
    const isSmallScreen = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 900px)').matches;
    const exterior = isTouch ? 28 : (isSmallScreen ? 14 : 6);
    const interior = this.getResizeHandleHitSlopPx(clipWidthPx, pointerType);
    return { interior, exterior: Math.max(interior, exterior) };
  }

  /**
   * Determine which resize handle (if any) is being targeted.
   * For very small clips, dragging from inside the clip prefers move; dragging just outside prefers resize.
   * @param {number} x
   * @param {number} clipX
   * @param {number} clipWidthPx
   * @param {string} pointerType
   * @returns {'left'|'right'|null}
   */
  getResizeHandleAtX(x, clipX, clipWidthPx, pointerType) {
    const leftDist = Math.abs(x - clipX);
    const rightDist = Math.abs(x - (clipX + clipWidthPx));
    const inside = x >= clipX && x <= clipX + clipWidthPx;
    const slop = this.getResizeHandleSlopPx(clipWidthPx, pointerType);
    const threshold = inside ? slop.interior : slop.exterior;
    const isLeftHandle = leftDist < threshold;
    const isRightHandle = rightDist < threshold;

    if (!isLeftHandle && !isRightHandle) return null;
    if (isLeftHandle && !isRightHandle) return 'left';
    if (isRightHandle && !isLeftHandle) return 'right';

    if (inside) {
      // If the pointer is inside a tiny clip and close to both edges, prefer move.
      const diff = Math.abs(leftDist - rightDist);
      if (diff < 3) return null;
    }

    return leftDist <= rightDist ? 'left' : 'right';
  }

  setupScrollbar() {
    if (!this.scrollEl) return;
    this.scrollEl.min = '0';
    this.scrollEl.step = '1';
    this.scrollEl.addEventListener('input', () => {
      const state = this.state.getState();
      const maxScroll = this.getMaxScroll(state, this.renderer.width);
      const next = Number(this.scrollEl.value);
      this.scrollX = Number.isFinite(next) ? Math.max(0, Math.min(next, maxScroll)) : 0;
      this.render(state);
    });
  }

  syncScrollbar(maxScroll) {
    if (!this.scrollEl) return;
    const shouldShow = maxScroll > 0.5;
    const wasHidden = this.scrollEl.hidden;
    this.scrollEl.hidden = !shouldShow;
    this.scrollEl.disabled = !shouldShow;
    const isHidden = this.scrollEl.hidden;
    if (wasHidden !== isHidden) {
      requestAnimationFrame(() => this.resizeCanvas());
    }

    if (!shouldShow) {
      this.scrollEl.max = '0';
      this.scrollEl.value = '0';
      this.scrollEl.style.setProperty('--range-percent', '0%');
      return;
    }

    const clampedScroll = Math.max(0, Math.min(this.scrollX, maxScroll));
    const roundedMax = Math.ceil(maxScroll);
    const roundedValue = Math.round(clampedScroll);

    if (Number(this.scrollEl.max) !== roundedMax) {
      this.scrollEl.max = String(roundedMax);
    }
    if (Number(this.scrollEl.value) !== roundedValue) {
      this.scrollEl.value = String(roundedValue);
    }

    const percent = roundedMax === 0 ? 0 : (roundedValue / roundedMax) * 100;
    this.scrollEl.style.setProperty('--range-percent', `${Math.max(0, Math.min(100, percent))}%`);
  }

  /**
   * Setup canvas dimensions
   */
  setupCanvas() {
    this.resizeCanvas();

    // Handle window resize
    window.addEventListener('resize', () => this.resizeCanvas());

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.container);
    }
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
   * Scroll timeline so a given time is visible (centered by default).
   * @param {number} timeMs
   * @param {{center?: boolean}} [options]
   */
  scrollToTime(timeMs, options = {}) {
    const state = this.state.getState();
    const visibleWidth = this.renderer.width;
    const maxScroll = this.getMaxScroll(state, visibleWidth);
    const timeX = timeToPixels(Math.max(0, timeMs), state.zoom);
    const center = options.center !== false;

    if (center) {
      this.scrollX = timeX - visibleWidth / 2;
    } else {
      const viewStart = this.scrollX;
      const viewEnd = this.scrollX + visibleWidth;
      if (timeX < viewStart) {
        this.scrollX = timeX;
      } else if (timeX > viewEnd) {
        this.scrollX = timeX - visibleWidth;
      }
    }

    this.scrollX = Math.max(0, Math.min(this.scrollX, maxScroll));
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
      if (this.zoomAnchor && this.zoomAnchor.type === 'mouse') {
        const targetX = timeToPixels(this.zoomAnchor.time, state.zoom);
        this.scrollX = targetX - this.zoomAnchor.x;
      } else if (this.isPointerOverTimeline && this.lastPointer) {
        const timeAtCursor = pixelsToTime(this.scrollX + this.lastPointer.x, this.lastZoom);
        const targetX = timeToPixels(timeAtCursor, state.zoom);
        this.scrollX = targetX - this.lastPointer.x;
      } else {
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

    // Draw selection rectangle
    if (this.dragState && this.dragState.type === 'select' && this.dragState.didMove) {
      const rect = this.getSelectionRect(state, this.dragState);
      if (rect && rect.width > 0 && rect.height > 0) {
        this.renderer.drawSelectionRect(rect.x, rect.y, rect.width, rect.height);
      }
    }

    // Draw playhead
    const playheadX = timeToPixels(state.playhead, state.zoom) - this.scrollX;
    if (playheadX >= 0 && playheadX <= visibleWidth) {
      this.renderer.drawPlayhead(playheadX, timelineHeight, COLORS.playhead);
    }

    this.syncScrollbar(maxScroll);
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
   * Get selection rectangle in canvas coordinates
   * @param {import('../core/types.js').EditorState} state
   * @param {object} dragState
   * @returns {{x: number, y: number, width: number, height: number}|null}
   */
  getSelectionRect(state, dragState) {
    if (!dragState) return null;
    const startX = dragState.startX;
    const startY = dragState.startY;
    const currentX = dragState.currentX ?? startX;
    const currentY = dragState.currentY ?? startY;
    const x1 = Math.min(startX, currentX);
    const x2 = Math.max(startX, currentX);
    const y1 = Math.min(startY, currentY);
    const y2 = Math.max(startY, currentY);
    const maxY = RULER_HEIGHT + state.tracks.length * TRACK_HEIGHT;
    const top = Math.max(RULER_HEIGHT, y1);
    const bottom = Math.min(maxY, y2);
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, bottom - top);
    return { x: x1, y: top, width, height };
  }

  /**
   * Get clip IDs inside a selection rectangle
   * @param {import('../core/types.js').EditorState} state
   * @param {{x: number, y: number, width: number, height: number}} rect
   * @returns {string[]}
   */
  getClipsInRect(state, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return [];
    const ids = [];
    state.clips.forEach((clip) => {
      const track = state.tracks.find(t => t.id === clip.trackId);
      if (!track || !track.visible) return;
      const trackIndex = state.tracks.indexOf(track);
      const x = timeToPixels(clip.start, state.zoom) - this.scrollX;
      const y = RULER_HEIGHT + trackIndex * TRACK_HEIGHT + 2;
      const width = Math.max(MIN_CLIP_WIDTH, timeToPixels(clip.duration, state.zoom));
      const height = TRACK_HEIGHT - 4;
      const intersects = x < rect.x + rect.width &&
        x + width > rect.x &&
        y < rect.y + rect.height &&
        y + height > rect.y;
      if (intersects) {
        ids.push(clip.id);
      }
    });
    return ids;
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

    // Check if clicking in ruler area (to jump playhead)
    if (y < RULER_HEIGHT) {
      // Jump playhead to click position
      const newTime = Math.max(0, pixelsToTime(x + this.scrollX, state.zoom));
      this.state.dispatch(actions.setPlayhead(newTime), false);
      this.dragState = {
        type: 'playhead',
        startX: x,
      };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors.
      }
      return;
    }

    // Check if clicking on a clip
    const clickedClip = this.getClipAtPoint(x, y, state, { pointerType: e.pointerType || 'mouse' });

    if (clickedClip) {
      const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];
      const clipX = timeToPixels(clickedClip.start, state.zoom) - this.scrollX;
      const clipWidth = Math.max(MIN_CLIP_WIDTH, timeToPixels(clickedClip.duration, state.zoom));
      const isToggle = e.ctrlKey || e.metaKey;
      const isAdd = e.shiftKey;

      // Check if clicking on resize handles
      const handle = this.getResizeHandleAtX(x, clipX, clipWidth, e.pointerType || 'mouse');

      if (handle) {
        if (!selectedIds.includes(clickedClip.id) || selectedIds.length > 1) {
          this.state.dispatch(actions.setSelection([clickedClip.id], clickedClip.id));
        }
        this.dragState = {
          type: 'resize',
          clip: clickedClip,
          handle,
          startX: x,
          originalStart: clickedClip.start,
          originalDuration: clickedClip.duration,
          originalTrimStart: clickedClip.trimStart,
          snapBoundariesByTrack: this.buildSnapBoundaries(state, new Set([clickedClip.id])),
          snapThreshold: this.getSnapThreshold(state),
          snapBiasThreshold: this.getSnapBiasThreshold(state),
          historySnapshot: this.state.getState(),
          didUpdate: false,
        };
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors.
        }
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
        snapBiasThreshold: this.getSnapBiasThreshold(state),
        historySnapshot: this.state.getState(),
        didUpdate: false,
      };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors.
      }
    } else {
      const mode = e.altKey
        ? 'subtract'
        : (e.ctrlKey || e.metaKey)
          ? 'toggle'
          : e.shiftKey
            ? 'add'
            : 'replace';
      this.dragState = {
        type: 'select',
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        mode,
        didMove: false,
        threshold: 4,
      };
      this.canvas.style.cursor = 'crosshair';
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore pointer capture errors.
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

    this.lastPointer = { x, y };
    this.isPointerOverTimeline = true;

    // Update cursor based on hover
    this.updateCursor(x, y, state, e.pointerType || 'mouse');

    if (!this.dragState) return;

    const deltaX = x - this.dragState.startX;
    const deltaTime = pixelsToTime(deltaX, state.zoom);

    if (this.dragState.type === 'playhead') {
      // Drag playhead (ruler only)
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

      this.dragState.lastDeltaTime = deltaTime;
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

        this.dragState.lastDeltaTime = deltaTime;
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

        this.dragState.lastDeltaTime = deltaTime;
        if (newDuration !== clip.duration) {
          this.state.dispatch(actions.updateClip(clip.id, {
            duration: newDuration,
          }), false);
          this.dragState.didUpdate = true;
        }
      }
    } else if (this.dragState.type === 'select') {
      this.dragState.currentX = x;
      this.dragState.currentY = y;
      const moveX = x - this.dragState.startX;
      const moveY = y - this.dragState.startY;
      if (!this.dragState.didMove &&
          Math.hypot(moveX, moveY) >= (this.dragState.threshold || 4)) {
        this.dragState.didMove = true;
      }
      if (this.dragState.didMove) {
        this.render(state);
      }
    }
  }

  /**
   * Handle pointer up (end drag)
   * @param {PointerEvent} e
   */
  onPointerUp(e) {
    if (e.type === 'pointerleave') {
      this.isPointerOverTimeline = false;
    }
    if (this.dragState && this.dragState.type === 'select') {
      const dragState = this.dragState;
      const state = this.state.getState();
      this.dragState = null;
      this.canvas.style.cursor = 'default';
      if (dragState.didMove) {
        const rect = this.getSelectionRect(state, dragState);
        const hits = this.getClipsInRect(state, rect);
        const existing = new Set(Array.isArray(state.selectedClipIds) ? state.selectedClipIds : []);
        let nextIds = [];
        if (dragState.mode === 'replace') {
          nextIds = hits;
        } else if (dragState.mode === 'add') {
          hits.forEach(id => existing.add(id));
          nextIds = Array.from(existing);
        } else if (dragState.mode === 'subtract') {
          hits.forEach(id => existing.delete(id));
          nextIds = Array.from(existing);
        } else if (dragState.mode === 'toggle') {
          hits.forEach((id) => {
            if (existing.has(id)) {
              existing.delete(id);
            } else {
              existing.add(id);
            }
          });
          nextIds = Array.from(existing);
        }
        const primary = nextIds.includes(state.selectedClipId)
          ? state.selectedClipId
          : (nextIds[0] || null);
        this.state.dispatch(actions.setSelection(nextIds, primary));
      } else if (dragState.mode === 'replace') {
        this.state.dispatch(actions.setSelection([], null));
      }
      return;
    }

    if (this.dragState && this.dragState.historySnapshot && this.dragState.didUpdate) {
      this.state.dispatch(state => state, true, this.dragState.historySnapshot);
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors.
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

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const timeAtCursor = pixelsToTime(x + this.scrollX, state.zoom);
      this.zoomAnchor = { type: 'mouse', x, y, time: timeAtCursor };
      this.lastPointer = { x, y };
      this.isPointerOverTimeline = true;
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
  updateCursor(x, y, state, pointerType = 'mouse') {
    if (this.dragState) return; // Don't change cursor while dragging

    const clip = this.getClipAtPoint(x, y, state, { pointerType });

    if (clip) {
      const clipX = timeToPixels(clip.start, state.zoom) - this.scrollX;
      const clipWidth = Math.max(MIN_CLIP_WIDTH, timeToPixels(clip.duration, state.zoom));
      const handle = this.getResizeHandleAtX(x, clipX, clipWidth, pointerType);

      if (handle) {
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
  getClipAtPoint(x, y, state, options = {}) {
    if (y < RULER_HEIGHT) return null;

    const trackIndex = Math.floor((y - RULER_HEIGHT) / TRACK_HEIGHT);
    if (trackIndex < 0 || trackIndex >= state.tracks.length) return null;

    const track = state.tracks[trackIndex];
    const pointerType = options && options.pointerType ? options.pointerType : 'mouse';
    const selectedIds = Array.isArray(state.selectedClipIds) ? state.selectedClipIds : [];

    // Prefer interacting with an already selected clip when multiple overlap.
    // Otherwise, prefer the topmost (last rendered) clip.
    let topmost = null;
    for (let i = state.clips.length - 1; i >= 0; i -= 1) {
      const clip = state.clips[i];
      if (clip.trackId !== track.id) continue;

      const clipX = timeToPixels(clip.start, state.zoom) - this.scrollX;
      const clipWidth = Math.max(MIN_CLIP_WIDTH, timeToPixels(clip.duration, state.zoom));
      const handleSlop = this.getResizeHandleSlopPx(clipWidth, pointerType);

      const inside = x >= clipX && x <= clipX + clipWidth;
      const leftDist = Math.abs(x - clipX);
      const rightDist = Math.abs(x - (clipX + clipWidth));
      const nearEdge = inside
        ? (leftDist < handleSlop.interior || rightDist < handleSlop.interior)
        : (leftDist < handleSlop.exterior || rightDist < handleSlop.exterior);
      if (!inside && !nearEdge) continue;

      if (clip.id === state.selectedClipId || selectedIds.includes(clip.id)) {
        return clip;
      }
      if (!topmost) {
        topmost = clip;
      }
    }

    return topmost;
  }

  /**
   * Get snapping threshold in milliseconds based on zoom level
   * @param {import('../core/types.js').EditorState} state
   * @returns {number}
   */
  getSnapThreshold(state) {
    const zoom = Number.isFinite(state.zoom) ? state.zoom : 0;
    const snapPixels = 6;
    return Math.max(0, pixelsToTime(snapPixels, zoom));
  }

  /**
   * Get snap bias threshold in milliseconds based on zoom level.
   * This is a smaller zone that allows snapping even with minor input jitter.
   * @param {import('../core/types.js').EditorState} state
   * @returns {number}
   */
  getSnapBiasThreshold(state) {
    const zoom = Number.isFinite(state.zoom) ? state.zoom : 0;
    const biasPixels = 3;
    return Math.max(0, pixelsToTime(biasPixels, zoom));
  }

  /**
   * Get drag direction for snapping decisions.
   * @param {object} dragState
   * @param {number} deltaTime
   * @returns {number}
   */
  getSnapDirection(dragState, deltaTime) {
    const lastDelta = Number.isFinite(dragState.lastDeltaTime)
      ? dragState.lastDeltaTime
      : deltaTime;
    return Math.sign(deltaTime - lastDelta);
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
   * @param {number} biasThreshold
   * @param {number} [direction]
   * @returns {number}
   */
  findSnapDelta(time, boundaries, threshold, biasThreshold, direction = 0) {
    let bestDelta = 0;
    let bestAbs = threshold + 1;
    boundaries.forEach((boundary) => {
      const delta = boundary - time;
      const absDelta = Math.abs(delta);
      if (absDelta === 0 || absDelta > threshold) return;
      if (direction !== 0 && absDelta > biasThreshold && Math.sign(delta) !== direction) return;
      if (absDelta < bestAbs) {
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
    const biasThreshold = dragState.snapBiasThreshold || this.getSnapBiasThreshold(state);
    const boundariesByTrack = dragState.snapBoundariesByTrack || [];
    const direction = this.getSnapDirection(dragState, deltaTime);
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
        const delta = this.findSnapDelta(edge, boundaries, threshold, biasThreshold, direction);
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
    const biasThreshold = dragState.snapBiasThreshold || this.getSnapBiasThreshold(state);
    const boundariesByTrack = dragState.snapBoundariesByTrack || [];
    const trackId = dragState.clip.trackId;
    const boundaries = boundariesByTrack[trackId];
    if (!boundaries || boundaries.length === 0) return 0;
    const edgeTime = edge === 'start'
      ? dragState.originalStart + deltaTime
      : dragState.originalStart + dragState.originalDuration + deltaTime;
    const direction = this.getSnapDirection(dragState, deltaTime);
    return this.findSnapDelta(edgeTime, boundaries, threshold, biasThreshold, direction);
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
