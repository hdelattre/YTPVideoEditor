/**
 * @fileoverview Time conversion and formatting utilities
 */

import { PIXELS_PER_SECOND_BASE } from '../core/constants.js';

/**
 * Convert time in milliseconds to pixels based on zoom level
 * @param {number} timeMs - Time in milliseconds
 * @param {number} zoom - Zoom level (-5 to 5)
 * @returns {number} Position in pixels
 */
export function timeToPixels(timeMs, zoom) {
  const scale = Math.pow(2, zoom);
  return (timeMs / 1000) * PIXELS_PER_SECOND_BASE * scale;
}

/**
 * Convert pixels to time in milliseconds based on zoom level
 * @param {number} pixels - Position in pixels
 * @param {number} zoom - Zoom level (-5 to 5)
 * @returns {number} Time in milliseconds
 */
export function pixelsToTime(pixels, zoom) {
  const scale = Math.pow(2, zoom);
  return (pixels / (PIXELS_PER_SECOND_BASE * scale)) * 1000;
}

/**
 * Format milliseconds as MM:SS.ms
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10);

  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`;
}

/**
 * Format milliseconds as HH:MM:SS
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTimeLong(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Parse time string (MM:SS or MM:SS.ms) to milliseconds
 * @param {string} timeString
 * @returns {number} Time in milliseconds
 */
export function parseTime(timeString) {
  const parts = timeString.split(':');
  if (parts.length < 2) return 0;

  const minutes = parseInt(parts[0], 10) || 0;
  const secondsParts = parts[1].split('.');
  const seconds = parseInt(secondsParts[0], 10) || 0;
  const milliseconds = secondsParts[1] ? parseInt(secondsParts[1].padEnd(3, '0'), 10) : 0;

  return (minutes * 60 + seconds) * 1000 + milliseconds;
}

/**
 * Snap time to frame boundary
 * @param {number} timeMs - Time in milliseconds
 * @param {number} fps - Frames per second
 * @returns {number} Snapped time in milliseconds
 */
export function snapToFrame(timeMs, fps) {
  const frameDuration = 1000 / fps;
  return Math.round(timeMs / frameDuration) * frameDuration;
}

/**
 * Get frame number at given time
 * @param {number} timeMs - Time in milliseconds
 * @param {number} fps - Frames per second
 * @returns {number} Frame number
 */
export function getFrameNumber(timeMs, fps) {
  return Math.floor(timeMs / (1000 / fps));
}

/**
 * Get time at frame number
 * @param {number} frameNumber - Frame number
 * @param {number} fps - Frames per second
 * @returns {number} Time in milliseconds
 */
export function getTimeAtFrame(frameNumber, fps) {
  return frameNumber * (1000 / fps);
}

/**
 * Clamp time within bounds
 * @param {number} timeMs - Time in milliseconds
 * @param {number} minTime - Minimum time
 * @param {number} maxTime - Maximum time
 * @returns {number} Clamped time
 */
export function clampTime(timeMs, minTime, maxTime) {
  return Math.max(minTime, Math.min(maxTime, timeMs));
}

/**
 * Get duration of timeline (latest clip end time)
 * @param {import('../core/types.js').Clip[]} clips
 * @returns {number} Total duration in milliseconds
 */
export function getTimelineDuration(clips) {
  if (clips.length === 0) return 0;

  return Math.max(...clips.map(clip => clip.start + clip.duration));
}

/**
 * Check if time is within clip bounds
 * @param {number} timeMs - Time in milliseconds
 * @param {import('../core/types.js').Clip} clip
 * @returns {boolean}
 */
export function isTimeInClip(timeMs, clip) {
  return timeMs >= clip.start && timeMs < clip.start + clip.duration;
}
