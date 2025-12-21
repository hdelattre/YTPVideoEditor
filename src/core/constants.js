/**
 * @fileoverview Constants for YTP Video Editor
 */

// Timeline layout constants
export const TRACK_HEIGHT = 60; // pixels
export const RULER_HEIGHT = 30; // pixels
export const PIXELS_PER_SECOND_BASE = 100; // At zoom level 0
export const MIN_CLIP_WIDTH = 10; // Minimum clip width in pixels
export const PLAYHEAD_WIDTH = 2; // pixels

// Zoom constants
export const MIN_ZOOM = -8;
export const MAX_ZOOM = 5;
export const ZOOM_STEP = 0.5;

// State history
export const MAX_HISTORY_LEVELS = 50;

// Frame cache
export const MAX_CACHED_FRAMES = 100;

// Colors
export const COLORS = {
  background: '#1a1a1a',
  timelineBackground: '#242424',
  trackBackground: '#2a2a2a',
  trackBorder: '#3a3a3a',
  clipDefault: '#4a9eff',
  clipSelected: '#6ab7ff',
  clipAudio: '#ff9d4a',
  clipText: '#ffffff',
  playhead: '#ff4a4a',
  waveform: '#4a9eff',
  waveformBackground: 'rgba(74, 158, 255, 0.1)',
  rulerText: '#999999',
  rulerLine: '#3a3a3a',
};

// Export settings
export const EXPORT_PRESETS = {
  '1080p': { width: 1920, height: 1080, fps: 30, bitrate: 5000000 },
  '720p': { width: 1280, height: 720, fps: 30, bitrate: 3000000 },
  '480p': { width: 854, height: 480, fps: 30, bitrate: 1500000 },
};

// Keyboard shortcuts
export const SHORTCUTS = {
  PLAY_PAUSE: 'Space',
  JUMP_BACKWARD: 'j',
  JUMP_FORWARD: 'l',
  PAUSE: 'k',
  SPLIT: 's',
  DELETE: 'Delete',
  DELETE_BACKSPACE: 'Backspace',
  UNDO: 'Ctrl+z',
  REDO: 'Ctrl+Shift+z',
  COPY: 'Ctrl+c',
  PASTE: 'Ctrl+v',
  REVERSE: 'r',
  SPEED_UP: ']',
  SPEED_DOWN: '[',
  ZOOM_IN: '=',
  ZOOM_OUT: '-',
};

// Playback
export const JUMP_INTERVAL = 1000; // ms
export const PLAYBACK_FPS = 60; // Target FPS for preview

// Default values
export const DEFAULT_TRACK_COUNT = 3;
export const DEFAULT_CLIP_COLOR = COLORS.clipDefault;
export const DEFAULT_CLIP_DURATION = 5000; // ms
export const DEFAULT_SPEED = 1.0;

// Media
export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
];

export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
];

// IndexedDB
export const DB_NAME = 'YTPEditor';
export const DB_VERSION = 1;
export const STORE_MEDIA = 'media';
export const STORE_FRAMES = 'frames';
export const STORE_WAVEFORMS = 'waveforms';
export const STORE_PROJECTS = 'projects';
