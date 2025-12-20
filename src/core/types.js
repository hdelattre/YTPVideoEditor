/**
 * @fileoverview Type definitions for YTP Video Editor
 * Uses JSDoc for type checking without TypeScript
 */

/**
 * @typedef {Object} Clip
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} mediaId - Reference to media in IndexedDB
 * @property {number} trackId - Track this clip belongs to
 * @property {number} start - Start time on timeline (ms)
 * @property {number} duration - Duration of clip (ms)
 * @property {number} trimStart - Trim from beginning of source (ms)
 * @property {number} trimEnd - Trim from end of source (ms)
 * @property {string} color - Display color
 * @property {ClipTransform} [transform] - Position/scale/rotation
 * @property {Float32Array} [waveformData] - Audio waveform data
 * @property {boolean} [reversed] - Play in reverse
 * @property {number} [speed] - Playback speed multiplier (default 1.0)
 * @property {number} [volume] - Audio volume (0.0 to 1.0, default 1.0)
 * @property {boolean} [muted] - Is audio muted (default false)
 */

/**
 * @typedef {Object} ClipTransform
 * @property {number} x - X position (px)
 * @property {number} y - Y position (px)
 * @property {number} scale - Scale multiplier
 * @property {number} rotation - Rotation in degrees
 */

/**
 * @typedef {Object} Track
 * @property {number} id - Track number (0-indexed)
 * @property {string} name - Track name
 * @property {boolean} muted - Is track muted
 * @property {boolean} locked - Is track locked (no editing)
 * @property {boolean} visible - Is track visible
 */

/**
 * @typedef {Object} Media
 * @property {string} id - Unique identifier
 * @property {string} hash - SHA-256 hash of file
 * @property {string} name - Original filename
 * @property {string} type - MIME type
 * @property {number} size - File size in bytes
 * @property {number} duration - Media duration (ms)
 * @property {number} width - Video width (px)
 * @property {number} height - Video height (px)
 * @property {string} [thumbnail] - Base64 thumbnail data URL
 * @property {number} uploadedAt - Timestamp of upload
 */

/**
 * @typedef {Object} Project
 * @property {string} id - Project ID
 * @property {string} name - Project name
 * @property {number} createdAt - Creation timestamp
 * @property {number} modifiedAt - Last modification timestamp
 */

/**
 * @typedef {Object} ExportState
 * @property {boolean} isExporting - Is export in progress
 * @property {number} progress - Progress percentage (0-100)
 * @property {string} [error] - Error message if export failed
 */

/**
 * @typedef {Object} EditorState
 * @property {Project} project - Current project metadata
 * @property {Clip[]} clips - All clips on timeline
 * @property {Track[]} tracks - All tracks
 * @property {Media[]} mediaLibrary - Imported media files
 * @property {number} playhead - Current playhead position (ms)
 * @property {number} zoom - Zoom level (-5 to 5)
 * @property {string|null} selectedClipId - ID of selected clip
 * @property {string[]} selectedClipIds - IDs of selected clips
 * @property {boolean} isPlaying - Is timeline playing
 * @property {ExportState} exportState - Export progress state
 * @property {number} scrollX - Timeline horizontal scroll position
 */

/**
 * @typedef {function(EditorState): EditorState} ActionFunction
 * State mutation function that takes current state and returns new state
 */

export {};
