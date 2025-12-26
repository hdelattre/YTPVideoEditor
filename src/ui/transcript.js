/**
 * @fileoverview Transcript helpers for the properties panel
 */

import { formatTime } from '../utils/time.js';
import { escapeHtml } from '../utils/format.js';
import { getClipSourceRange } from '../utils/clipTiming.js';

/**
 * Render transcript search results for a clip
 * @param {import('../core/types.js').Clip|null} clip
 * @param {import('../core/types.js').Transcript|null} transcript
 * @param {string} query
 * @param {HTMLElement|null} container
 * @param {HTMLElement|null} pagination
 * @param {number} page
 * @returns {{page: number, pageCount: number, total: number}}
 */
export function renderTranscriptResults(clip, transcript, query, container, pagination, page = 0) {
  if (!container) return { page: 0, pageCount: 0, total: 0 };
  if (!transcript || !Array.isArray(transcript.cues) || transcript.cues.length === 0) {
    container.innerHTML = '<div class="transcript-empty">Load a transcript to search.</div>';
    if (pagination) {
      pagination.hidden = true;
    }
    return { page: 0, pageCount: 0, total: 0 };
  }

  const search = query ? query.trim().toLowerCase() : '';
  const range = clip ? getClipSourceRange(clip) : null;
  const matches = [];

  transcript.cues.forEach((cue) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return;
    if (range && (cue.end <= range.start || cue.start >= range.end)) return;
    if (search && (!cue.text || !cue.text.toLowerCase().includes(search))) return;
    matches.push({ sourceTime: cue.start, text: cue.text || '' });
  });

  if (matches.length === 0) {
    container.innerHTML = '<div class="transcript-empty">No matches.</div>';
    if (pagination) {
      pagination.hidden = true;
    }
    return { page: 0, pageCount: 0, total: 0 };
  }

  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const safePage = Math.max(0, Math.min(pageCount - 1, page));
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(matches.length, startIndex + pageSize);
  const visible = matches.slice(startIndex, endIndex);
  container.innerHTML = visible.map((item) => (
    `<button type="button" class="transcript-result"
      data-source-time="${item.sourceTime}">
      <span class="transcript-time">${formatTime(item.sourceTime)}</span>
      <span class="transcript-text">${escapeHtml(item.text)}</span>
    </button>`
  )).join('');
  container.scrollTop = 0;

  if (matches.length > pageSize) {
    container.innerHTML += `<div class="transcript-more">Showing ${startIndex + 1}-${endIndex} of ${matches.length} matches.</div>`;
  }

  if (pagination) {
    const prevBtn = pagination.querySelector('.transcript-prev');
    const nextBtn = pagination.querySelector('.transcript-next');
    const pageLabel = pagination.querySelector('.transcript-page');
    if (pageLabel) {
      pageLabel.textContent = `Page ${safePage + 1} of ${pageCount}`;
    }
    if (prevBtn) {
      prevBtn.disabled = safePage <= 0;
    }
    if (nextBtn) {
      nextBtn.disabled = safePage >= pageCount - 1;
    }
    pagination.hidden = pageCount <= 1;
  }

  return { page: safePage, pageCount, total: matches.length };
}

/**
 * Parse a Whisper transcript text file with [HH:MM:SS.mmm --> HH:MM:SS.mmm] lines
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function parseWhisperTranscript(text) {
  const cues = [];
  if (!text) return cues;

  const lines = text.split(/\r?\n/);
  const timeRegex = /^\s*\[(\d{1,2}):(\d{2}):(\d{2}(?:\.\d{1,3})?)\s*-->\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/;
  const toMs = (hours, minutes, seconds) => {
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    const s = parseFloat(seconds) || 0;
    return (h * 3600 + m * 60 + s) * 1000;
  };

  let lastCue = null;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = line.match(timeRegex);
    if (match) {
      const start = toMs(match[1], match[2], match[3]);
      const end = toMs(match[4], match[5], match[6]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return;
      }
      const textValue = match[7] ? match[7].trim() : '';
      const cue = { start, end, text: textValue };
      cues.push(cue);
      lastCue = cue;
    } else if (lastCue) {
      lastCue.text = lastCue.text ? `${lastCue.text} ${trimmed}` : trimmed;
    }
  });

  return cues;
}
