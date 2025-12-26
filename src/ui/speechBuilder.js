/**
 * @fileoverview Speech builder helpers for transcript-driven sentence assembly
 */

import { escapeHtml } from '../utils/format.js';
import { formatTime } from '../utils/time.js';

const WORD_REGEX = /[A-Za-z0-9']+/g;
const APOSTROPHE_REGEX = /[\u2019\u2018]/g;

function normalizeToken(token) {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenizeText(text) {
  const normalized = text.replace(APOSTROPHE_REGEX, "'");
  const rawTokens = normalized.match(WORD_REGEX) || [];
  return rawTokens
    .map((raw) => {
      const norm = normalizeToken(raw);
      return norm ? { raw, norm } : null;
    })
    .filter(Boolean);
}

function buildTranscriptWords(transcript) {
  const words = [];
  if (!transcript || !Array.isArray(transcript.cues)) return words;

  transcript.cues.forEach((cue, cueIndex) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return;
    const cueText = cue.text || '';
    const tokenData = tokenizeText(cueText);
    if (tokenData.length === 0) return;

    const duration = Math.max(0, cue.end - cue.start);
    const perWord = tokenData.length > 0 ? duration / tokenData.length : 0;

    tokenData.forEach((token, index) => {
      const start = cue.start + perWord * index;
      const end = index === tokenData.length - 1 ? cue.end : cue.start + perWord * (index + 1);
      words.push({
        word: token.norm,
        raw: token.raw,
        start,
        end,
        cueIndex,
        cueText,
      });
    });
  });

  return words;
}

function buildWordIndex(words) {
  const index = new Map();
  words.forEach((wordEntry, idx) => {
    if (!wordEntry || !wordEntry.word) return;
    const list = index.get(wordEntry.word) || [];
    list.push(idx);
    index.set(wordEntry.word, list);
  });
  return index;
}

function scoreExactMatch(length) {
  if (length > 1) {
    return 300 + length;
  }
  return 200;
}

function scorePartialMatch(token, word) {
  const maxLen = Math.max(token.length, word.length) || 1;
  const minLen = Math.min(token.length, word.length);
  const ratio = minLen / maxLen;
  return 100 + ratio * 50;
}

function sortOptions(options) {
  return options.sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.start - b.start;
  });
}

function findExactOptions(tokens, words, wordIndex) {
  if (!tokens.length) return [];
  const firstWord = tokens[0];
  const startIndices = wordIndex.get(firstWord) || [];
  if (startIndices.length === 0) return [];

  const options = [];
  startIndices.forEach((startIdx) => {
    if (startIdx + tokens.length > words.length) return;
    for (let offset = 0; offset < tokens.length; offset += 1) {
      if (words[startIdx + offset].word !== tokens[offset]) {
        return;
      }
    }
    const wordSlice = words.slice(startIdx, startIdx + tokens.length);
    const start = wordSlice[0].start;
    const end = wordSlice[wordSlice.length - 1].end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    options.push({
      start,
      end,
      text: wordSlice.map(word => word.raw).join(' '),
      cueText: wordSlice[0].cueText || '',
      matchType: tokens.length > 1 ? 'phrase' : 'exact',
      score: scoreExactMatch(tokens.length),
    });
  });

  return sortOptions(options);
}

function findPartialOptions(token, words) {
  if (!token) return [];
  const options = [];
  words.forEach((wordEntry) => {
    if (!wordEntry || !wordEntry.word) return;
    const word = wordEntry.word;
    if (word === token) return;
    let start = wordEntry.start;
    let end = wordEntry.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    if (word.includes(token)) {
      const index = word.indexOf(token);
      const length = word.length || 1;
      const duration = end - start;
      const sliceStart = start + duration * (index / length);
      const sliceEnd = start + duration * ((index + token.length) / length);
      if (sliceEnd > sliceStart) {
        start = sliceStart;
        end = sliceEnd;
      }
    } else if (!token.includes(word)) {
      return;
    }

    options.push({
      start,
      end,
      text: wordEntry.raw,
      cueText: wordEntry.cueText || '',
      matchType: 'partial',
      score: scorePartialMatch(token, word),
    });
  });

  return sortOptions(options);
}

function splitTokenByDictionary(token, wordSet) {
  if (!token) return { parts: [], leftover: '' };
  const length = token.length;
  const dp = Array(length + 1).fill(null);
  dp[0] = [];

  for (let i = 0; i < length; i += 1) {
    if (!dp[i]) continue;
    for (let j = i + 1; j <= length; j += 1) {
      const piece = token.slice(i, j);
      if (!wordSet.has(piece)) continue;
      const candidate = dp[i].concat(piece);
      if (!dp[j] || candidate.length < dp[j].length) {
        dp[j] = candidate;
      }
    }
  }

  let bestIndex = 0;
  for (let i = 1; i <= length; i += 1) {
    if (dp[i] && i > bestIndex) {
      bestIndex = i;
    }
  }

  return {
    parts: dp[bestIndex] || [],
    leftover: token.slice(bestIndex),
  };
}

/**
 * Build candidate segments from a sentence against a transcript
 * @param {string} sentence
 * @param {import('../core/types.js').Transcript|null} transcript
 * @param {{maxPhraseLength?: number}} [options]
 * @returns {{tokens: Array<{raw: string, norm: string}>, segments: Array<{label: string, origin?: string, options: Array<object>}>, missingCount: number}}
 */
export function buildSpeechSegments(sentence, transcript, options = {}) {
  const tokens = tokenizeText(sentence || '');
  const segments = [];
  if (!tokens.length || !transcript || !Array.isArray(transcript.cues)) {
    return { tokens, segments, missingCount: 0 };
  }

  const words = buildTranscriptWords(transcript);
  if (words.length === 0) {
    return { tokens, segments, missingCount: 0 };
  }
  const wordIndex = buildWordIndex(words);
  const wordSet = new Set(words.map(word => word.word));
  const maxPhraseLength = Math.max(1, options.maxPhraseLength || 4);

  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    const remaining = tokens.length - i;
    const maxLen = Math.min(maxPhraseLength, remaining);

    for (let len = maxLen; len >= 1; len -= 1) {
      const slice = tokens.slice(i, i + len);
      const phraseTokens = slice.map(token => token.norm);
      const exactOptions = findExactOptions(phraseTokens, words, wordIndex);
      if (exactOptions.length > 0) {
        segments.push({
          label: slice.map(token => token.raw).join(' '),
          options: exactOptions,
        });
        i += len;
        matched = true;
        break;
      }
    }

    if (matched) continue;

    const token = tokens[i];
    let optionsForToken = findPartialOptions(token.norm, words);
    if (optionsForToken.length > 0) {
      segments.push({
        label: token.raw,
        options: optionsForToken,
      });
      i += 1;
      continue;
    }

    const split = splitTokenByDictionary(token.norm, wordSet);
    if (split.parts.length > 0) {
      split.parts.forEach((part) => {
        let partOptions = findExactOptions([part], words, wordIndex);
        if (partOptions.length === 0) {
          partOptions = findPartialOptions(part, words);
        }
        segments.push({
          label: part,
          origin: token.raw,
          options: partOptions,
        });
      });
      if (split.leftover) {
        const leftoverOptions = findPartialOptions(split.leftover, words);
        segments.push({
          label: split.leftover,
          origin: token.raw,
          options: leftoverOptions,
        });
      }
      i += 1;
      continue;
    }

    segments.push({
      label: token.raw,
      options: [],
    });
    i += 1;
  }

  const missingCount = segments.reduce((count, segment) => (
    count + ((segment.options || []).length === 0 ? 1 : 0)
  ), 0);

  return { tokens, segments, missingCount };
}

function formatMatchLabel(matchType) {
  switch (matchType) {
    case 'phrase':
      return 'Phrase';
    case 'exact':
      return 'Word';
    case 'partial':
      return 'Partial';
    default:
      return 'Match';
  }
}

/**
 * Render builder segments to HTML markup
 * @param {Array<{label: string, origin?: string, options: Array<object>}>} segments
 * @param {Record<number, number>} selections
 * @returns {string}
 */
export function renderSpeechBuilderResults(segments, selections = {}) {
  if (!segments || segments.length === 0) {
    return '<div class="builder-empty">No segments built yet.</div>';
  }

  return segments.map((segment, segmentIndex) => {
    const label = escapeHtml(segment.label);
    const origin = segment.origin ? ` <span class="builder-segment-origin">(from ${escapeHtml(segment.origin)})</span>` : '';
    const options = Array.isArray(segment.options) ? segment.options : [];
    let optionsMarkup = '';
    if (options.length === 0) {
      optionsMarkup = '<div class="builder-empty">No matches.</div>';
    } else {
      optionsMarkup = options.map((option, optionIndex) => {
        const selected = selections[segmentIndex] === optionIndex;
        const timeLabel = `${formatTime(option.start)} - ${formatTime(option.end)}`;
        const matchLabel = formatMatchLabel(option.matchType);
        const context = option.cueText && option.cueText !== option.text
          ? `<div class="builder-option-context">${escapeHtml(option.cueText)}</div>`
          : '';
        return `
          <button type="button"
                  class="builder-option${selected ? ' is-selected' : ''}"
                  data-segment-index="${segmentIndex}"
                  data-option-index="${optionIndex}"
                  aria-pressed="${selected ? 'true' : 'false'}">
            <div class="builder-option-row">
              <span class="builder-option-time">${timeLabel}</span>
              <span class="builder-option-text">${escapeHtml(option.text)}</span>
              <span class="builder-option-type">${matchLabel}</span>
            </div>
            ${context}
          </button>
        `;
      }).join('');
    }

    return `
      <div class="builder-segment">
        <div class="builder-segment-header">
          <span class="builder-segment-label">${label}${origin}</span>
          <span class="builder-segment-count">${options.length} option${options.length === 1 ? '' : 's'}</span>
        </div>
        <div class="builder-options">
          ${optionsMarkup}
        </div>
      </div>
    `;
  }).join('');
}
