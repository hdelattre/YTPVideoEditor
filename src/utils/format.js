/**
 * @fileoverview Formatting and escaping helpers
 */

/**
 * Format milliseconds as seconds with ffmpeg-friendly precision
 * @param {number} ms
 * @returns {string}
 */
export function formatSeconds(ms) {
  return (ms / 1000).toFixed(3).replace(/\.?0+$/, '');
}

/**
 * Escape text for safe HTML rendering
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape double quotes for shell usage
 * @param {string} value
 * @returns {string}
 */
export function escapeShellArg(value) {
  return String(value).replace(/"/g, '\\"');
}
