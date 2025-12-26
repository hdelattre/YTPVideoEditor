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
      color: clip.color || DEFAULT_CLIP_COLOR,
      transform: clip.transform,
      waveformData: clip.waveformData,
      reversed: clip.reversed || false,
      speed: clip.speed || DEFAULT_SPEED,
      volume: clip.volume,
      muted: Boolean(clip.muted),
      visible: clip.visible !== undefined
        ? Boolean(clip.visible)
        : (clip.videoMuted !== undefined ? !clip.videoMuted : true),
      videoFilters: clip.videoFilters ? { ...clip.videoFilters } : undefined,
      audioFilters: clip.audioFilters ? { ...clip.audioFilters } : undefined,
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
    if (Array.isArray(state.selectedClipIds)) {
      state.selectedClipIds = state.selectedClipIds.filter(id => id !== clipId);
      if (state.selectedClipIds.length === 0) {
        state.selectedClipId = null;
      } else if (!state.selectedClipIds.includes(state.selectedClipId)) {
        state.selectedClipId = state.selectedClipIds[0] || null;
      }
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
    state.selectedClipIds = clipId ? [clipId] : [];
    state.selectedMediaId = null;
    return state;
  };
}

/**
 * Set multiple selected clips
 * @param {string[]} clipIds
 * @param {string|null} primaryId
 * @returns {import('./types.js').ActionFunction}
 */
export function setSelection(clipIds, primaryId = null) {
  return (state) => {
    const unique = Array.from(new Set(clipIds.filter(Boolean)));
    state.selectedClipIds = unique;
    if (primaryId !== null) {
      state.selectedClipId = primaryId;
    } else {
      state.selectedClipId = unique[0] || null;
    }
    state.selectedMediaId = null;
    return state;
  };
}

/**
 * Add a clip to selection
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function addClipToSelection(clipId) {
  return (state) => {
    const ids = new Set(state.selectedClipIds || []);
    ids.add(clipId);
    state.selectedClipIds = Array.from(ids);
    state.selectedClipId = clipId;
    state.selectedMediaId = null;
    return state;
  };
}

/**
 * Toggle clip selection
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function toggleClipSelection(clipId) {
  return (state) => {
    const ids = new Set(state.selectedClipIds || []);
    if (ids.has(clipId)) {
      ids.delete(clipId);
    } else {
      ids.add(clipId);
      state.selectedClipId = clipId;
    }
    state.selectedClipIds = Array.from(ids);
    if (!state.selectedClipIds.includes(state.selectedClipId)) {
      state.selectedClipId = state.selectedClipIds[0] || null;
    }
    state.selectedMediaId = null;
    return state;
  };
}

/**
 * Select a media item in the library
 * @param {string|null} mediaId
 * @returns {import('./types.js').ActionFunction}
 */
export function selectMedia(mediaId) {
  return (state) => {
    state.selectedMediaId = mediaId;
    state.selectedClipId = null;
    state.selectedClipIds = [];
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
 * Update export settings
 * @param {Partial<import('./types.js').ExportSettings>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateExportSettings(updates) {
  return (state) => {
    state.exportSettings = {
      ...state.exportSettings,
      ...updates,
    };
    return state;
  };
}

/**
 * Update global default filters
 * @param {'video'|'audio'} section
 * @param {object} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateDefaultFilters(section, updates) {
  return (state) => {
    if (!state.defaultFilters) {
      state.defaultFilters = { video: {}, audio: {} };
    }
    if (!state.defaultFilters[section]) {
      state.defaultFilters[section] = {};
    }
    Object.assign(state.defaultFilters[section], updates);
    return state;
  };
}

/**
 * Update per-clip video filters (override defaults)
 * @param {string} clipId
 * @param {object} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateClipVideoFilters(clipId, updates) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (!clip) return state;
    if (!clip.videoFilters) {
      clip.videoFilters = {};
    }
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (value === undefined) {
        delete clip.videoFilters[key];
      } else {
        clip.videoFilters[key] = value;
      }
    });
    if (Object.keys(clip.videoFilters).length === 0) {
      delete clip.videoFilters;
    }
    return state;
  };
}

/**
 * Update per-clip audio filters (override defaults)
 * @param {string} clipId
 * @param {object} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateClipAudioFilters(clipId, updates) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (!clip) return state;
    if (!clip.audioFilters) {
      clip.audioFilters = {};
    }
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (value === undefined) {
        delete clip.audioFilters[key];
      } else {
        clip.audioFilters[key] = value;
      }
    });
    if (Object.keys(clip.audioFilters).length === 0) {
      delete clip.audioFilters;
    }
    return state;
  };
}

/**
 * Clear all per-clip video filter overrides
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function clearClipVideoFilters(clipId) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (clip && clip.videoFilters) {
      delete clip.videoFilters;
    }
    return state;
  };
}

/**
 * Clear all per-clip audio filter overrides
 * @param {string} clipId
 * @returns {import('./types.js').ActionFunction}
 */
export function clearClipAudioFilters(clipId) {
  return (state) => {
    const clip = state.clips.find(c => c.id === clipId);
    if (clip && clip.audioFilters) {
      delete clip.audioFilters;
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
    if (Array.isArray(state.selectedClipIds)) {
      const remainingIds = new Set(state.clips.map(c => c.id));
      state.selectedClipIds = state.selectedClipIds.filter(id => remainingIds.has(id));
      if (!state.selectedClipIds.includes(state.selectedClipId)) {
        state.selectedClipId = state.selectedClipIds[0] || null;
      }
    }
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
 * Update multiple clips with same fields
 * @param {string[]} clipIds
 * @param {Partial<import('./types.js').Clip>} updates
 * @returns {import('./types.js').ActionFunction}
 */
export function updateClips(clipIds, updates) {
  return (state) => {
    const idSet = new Set(clipIds);
    state.clips.forEach(clip => {
      if (idSet.has(clip.id)) {
        Object.assign(clip, updates);
      }
    });
    return state;
  };
}

/**
 * Move multiple clips with per-clip values
 * @param {Array<{id: string, start?: number, trackId?: number}>} moves
 * @returns {import('./types.js').ActionFunction}
 */
export function moveClips(moves) {
  return (state) => {
    const moveById = new Map(moves.map(move => [move.id, move]));
    state.clips.forEach(clip => {
      const move = moveById.get(clip.id);
      if (move) {
        if (typeof move.start === 'number') {
          clip.start = move.start;
        }
        if (typeof move.trackId === 'number') {
          clip.trackId = move.trackId;
        }
      }
    });
    return state;
  };
}

/**
 * Remove multiple clips
 * @param {string[]} clipIds
 * @returns {import('./types.js').ActionFunction}
 */
export function removeClips(clipIds) {
  return (state) => {
    const idSet = new Set(clipIds);
    state.clips = state.clips.filter(c => !idSet.has(c.id));
    if (Array.isArray(state.selectedClipIds)) {
      state.selectedClipIds = state.selectedClipIds.filter(id => !idSet.has(id));
      if (!state.selectedClipIds.includes(state.selectedClipId)) {
        state.selectedClipId = state.selectedClipIds[0] || null;
      }
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
      const previousSpeed = clip.speed || DEFAULT_SPEED;
      const sourceDuration = clip.duration * previousSpeed;
      clip.speed = Math.max(0.25, Math.min(4.0, speed));
      // Adjust duration based on speed, preserving the source window
      clip.duration = sourceDuration / clip.speed;
    }
    return state;
  };
}

/**
 * Adjust speed for multiple clips
 * @param {string[]} clipIds
 * @param {number} speed
 * @returns {import('./types.js').ActionFunction}
 */
export function setClipsSpeed(clipIds, speed) {
  return (state) => {
    const idSet = new Set(clipIds);
    state.clips.forEach(clip => {
      if (idSet.has(clip.id)) {
        const previousSpeed = clip.speed || DEFAULT_SPEED;
        const sourceDuration = clip.duration * previousSpeed;
        clip.speed = Math.max(0.25, Math.min(4.0, speed));
        clip.duration = sourceDuration / clip.speed;
      }
    });
    return state;
  };
}
