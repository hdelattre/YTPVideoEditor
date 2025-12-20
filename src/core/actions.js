/**
 * @fileoverview Action functions for state mutations
 * These are pure functions that take state and return new state
 */

import { DEFAULT_CLIP_COLOR, DEFAULT_SPEED } from './constants.js';

/**
 * Add a new clip to the timeline
 * @param {import('./types.js').Clip} clip
 * @returns {import('./types.js').ActionFunction}
 */
export function addClip(clip) {
  return (state) => {
    state.clips.push({
      id: clip.id || crypto.randomUUID(),
      name: clip.name,
      mediaId: clip.mediaId,
      trackId: clip.trackId,
      start: clip.start,
      duration: clip.duration,
      trimStart: clip.trimStart || 0,
      trimEnd: clip.trimEnd || 0,
      color: clip.color || DEFAULT_CLIP_COLOR,
      transform: clip.transform,
      waveformData: clip.waveformData,
      reversed: clip.reversed || false,
      speed: clip.speed || DEFAULT_SPEED,
    });
    return state;
  };
}

/**
 * Remove a clip from timeline
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function removeClip(clipId) {
  return (state) => {
    state.clips = state.clips.filter(c => c.id !== clipId);
    if (state.selectedClipId === clipId) {
      state.selectedClipId = null;
    }
    return state;
  };
}

/**
 * Update clip properties
 * @param {string} clipId
 * @param {Partial<import('./types.js').Clip>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateClip(clipId, updates) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (clip) {
      Object.assign(clip, updates);
    }
    return state;
  };
}

/**
 * Split clip at current playhead position
 * @param {string} clipId
 * @param {number} splitTime - Time in ms from clip start
 * @returns {import('./types.js').ActionFunction}
 */
export function splitClip(clipId, splitTime) {
  return (state) => {
    const clipIndex = state.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return state;

    const originalClip = state.clips[clipIndex];

    // Create two new clips from the split
    const clip1 = {
      ...originalClip,
      id: crypto.randomUUID(),
      duration: splitTime,
    };

    const clip2 = {
      ...originalClip,
      id: crypto.randomUUID(),
      start: originalClip.start + splitTime,
      trimStart: originalClip.trimStart + splitTime,
      duration: originalClip.duration - splitTime,
    };

    // Remove original and add the two new clips
    state.clips.splice(clipIndex, 1, clip1, clip2);

    return state;
  };
}

/**
 * Select a clip
 * @param {string|null} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function selectClip(clipId) {
  return (state) => {
    state.selectedClipId = clipId;
    return state;
  };
}

/**
 * Set playhead position
 * @param {number} time - Time in ms
 * @returns {import('./types.js').ActionFunction}
 */
export function setPlayhead(time) {
  return (state) => {
    state.playhead = Math.max(0, time);
    return state;
  };
}

/**
 * Set playing state
 * @param {boolean} isPlaying
 * @returns {import('./types.js').ActionFunction}
 */
export function setPlaying(isPlaying) {
  return (state) => {
    state.isPlaying = isPlaying;
    return state;
  };
}

/**
 * Set zoom level
 * @param {number} zoom
 * @returns {import('./types.js').ActionFunction}
 */
export function setZoom(zoom) {
  return (state) => {
    state.zoom = zoom;
    return state;
  };
}

/**
 * Add media to library
 * @param {import('./types.js').Media} media
 * @returns {import('./types.js').ActionFunction}
 */
export function addMedia(media) {
  return (state) => {
    state.mediaLibrary.push(media);
    return state;
  };
}

/**
 * Update media metadata
 * @param {string} mediaId
 * @param {Partial<import('./types.js').Media>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateMedia(mediaId, updates) {
  return (state) => {
    const media = state.mediaLibrary.find(m => m.id === mediaId);
    if (media) {
      Object.assign(media, updates);
    }
    return state;
  };
}

/**
 * Remove media from library
 * @param {string} mediaId
 * @returns {import('./types.js').ActionFunction}
 */
export function removeMedia(mediaId) {
  return (state) => {
    state.mediaLibrary = state.mediaLibrary.filter(m => m.id !== mediaId);
    // Also remove any clips using this media
    state.clips = state.clips.filter(c => c.mediaId !== mediaId);
    return state;
  };
}

/**
 * Add a new track
 * @param {string} name
 * @returns {import('./types.js').ActionFunction}
 */
export function addTrack(name) {
  return (state) => {
    const newTrackId = state.tracks.length;
    state.tracks.push({
      id: newTrackId,
      name: name || `Track ${newTrackId + 1}`,
      muted: false,
      locked: false,
      visible: true,
    });
    return state;
  };
}

/**
 * Remove a track
 * @param {number} trackId
 * @returns {import('./types.js').ActionFunction}
 */
export function removeTrack(trackId) {
  return (state) => {
    state.tracks = state.tracks.filter(t => t.id !== trackId);
    // Remove clips on this track
    state.clips = state.clips.filter(c => c.trackId !== trackId);
    return state;
  };
}

/**
 * Update track properties
 * @param {number} trackId
 * @param {Partial<import('./types.js').Track>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateTrack(trackId, updates) {
  return (state) => {
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      Object.assign(track, updates);
    }
    return state;
  };
}

/**
 * Set timeline scroll position
 * @param {number} scrollX
 * @returns {import('./types.js').ActionFunction}
 */
export function setScrollX(scrollX) {
  return (state) => {
    state.scrollX = scrollX;
    return state;
  };
}

/**
 * Update export state
 * @param {Partial<import('./types.js').ExportState>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateExportState(updates) {
  return (state) => {
    Object.assign(state.exportState, updates);
    return state;
  };
}

/**
 * Reverse clip playback direction
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function reverseClip(clipId) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (clip) {
      clip.reversed = !clip.reversed;
    }
    return state;
  };
}

/**
 * Adjust clip speed
 * @param {string} clipId
 * @param {number} speed - Speed multiplier (0.25 to 4.0)
 * @returns {import('./types.js').ActionFunction}
 */
export function setClipSpeed(clipId, speed) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (clip) {
      clip.speed = Math.max(0.25, Math.min(4.0, speed));
      // Adjust duration based on speed
      clip.duration = (clip.trimEnd || clip.duration) / clip.speed;
    }
    return state;
  };
}
