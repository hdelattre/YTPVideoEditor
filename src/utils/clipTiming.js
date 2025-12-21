/**
 * @fileoverview Clip timing helpers
 */

/**
 * Get source range for a clip in milliseconds
 * @param {import('../core/types.js').Clip} clip
 * @returns {{start: number, end: number, speed: number, sourceLength: number}}
 */
export function getClipSourceRange(clip) {
  const speed = clip.speed || 1;
  const trimStart = clip.trimStart || 0;
  const sourceLength = clip.duration * speed;
  return {
    start: trimStart,
    end: trimStart + sourceLength,
    speed,
    sourceLength,
  };
}

/**
 * Map a source time to clip timeline time
 * @param {import('../core/types.js').Clip} clip
 * @param {number} sourceMs
 * @param {{start: number, end: number, speed: number, sourceLength: number}} range
 * @returns {number}
 */
export function mapSourceTimeToClipTime(clip, sourceMs, range) {
  const trimStart = range.start;
  const speed = range.speed;
  const sourceLength = range.sourceLength;
  let offset;
  if (clip.reversed) {
    offset = (sourceLength - (sourceMs - trimStart)) / speed;
  } else {
    offset = (sourceMs - trimStart) / speed;
  }
  const clipStart = clip.start;
  const clipEnd = clip.start + clip.duration;
  const time = clipStart + offset;
  return Math.min(clipEnd, Math.max(clipStart, time));
}

/**
 * Map a clip timeline time to a source time
 * @param {import('../core/types.js').Clip} clip
 * @param {number} timelineMs
 * @returns {number}
 */
export function mapClipTimeToSourceTime(clip, timelineMs) {
  const clipStart = clip.start;
  const clipEnd = clip.start + clip.duration;
  const clamped = Math.min(clipEnd, Math.max(clipStart, timelineMs));
  const clipOffset = clamped - clipStart;
  const trimStart = clip.trimStart || 0;
  const speed = clip.speed || 1;
  const sourceLength = clip.duration * speed;
  let sourceOffset;
  if (clip.reversed) {
    sourceOffset = sourceLength - clipOffset * speed;
  } else {
    sourceOffset = clipOffset * speed;
  }
  sourceOffset = Math.max(0, Math.min(sourceLength, sourceOffset));
  return trimStart + sourceOffset;
}
