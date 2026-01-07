/**
 * @fileoverview FFmpeg export pipeline helpers
 */

import { DEFAULT_AUDIO_FILTERS, DEFAULT_VIDEO_FILTERS } from '../core/constants.js';
import { escapeShellArg, formatSeconds } from '../utils/format.js';

/**
 * Pick an export resolution based on loaded media
 * @param {import('../core/types.js').EditorState} state
 * @returns {{width: number, height: number}}
 */
export function getExportResolution(state) {
  let width = 1280;
  let height = 720;

  state.clips.forEach(clip => {
    const media = state.mediaLibrary.find(m => m.id === clip.mediaId);
    if (media && media.width && media.height) {
      width = Math.max(width, media.width);
      height = Math.max(height, media.height);
    }
  });

  return { width, height };
}

/**
 * Build an ffmpeg command that renders the timeline
 * @param {import('../core/types.js').EditorState} state
 * @param {{
 *  exportSettings: import('../core/types.js').ExportSettings,
 *  defaultFilters: import('../core/types.js').DefaultFilters,
 *  mediaInfo: Map<string, {hasAudio: boolean|null, hasVideo: boolean|null, isAudioOnly: boolean, isVideoType: boolean}>|null,
 *  resolveVideoFilters: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => import('../core/types.js').ClipVideoFilters,
 *  resolveAudioFilters: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => import('../core/types.js').ClipAudioFilters,
 *  resolveClipVolume: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => number,
 * }} options
 * @returns {{command: string, exportAudioWarning: boolean, usedLosslessCopy: boolean}|null}
 */
export function buildFfmpegExportCommand(state, options) {
  const {
    exportSettings,
    defaultFilters,
    mediaInfo,
    resolveVideoFilters,
    resolveAudioFilters,
    resolveClipVolume,
  } = options || {};
  if (!state || !exportSettings || !defaultFilters) return null;

  let segments = getTopmostSegments(state, mediaInfo);
  if (segments.length === 0) return null;

  let exportAudioWarning = false;
  const rangeStart = Number.isFinite(exportSettings.rangeStart)
    ? Math.max(0, exportSettings.rangeStart)
    : 0;
  let rangeEnd = null;
  if (
    exportSettings.rangeEnd !== null &&
    exportSettings.rangeEnd !== undefined &&
    exportSettings.rangeEnd !== ''
  ) {
    const endValue = Number(exportSettings.rangeEnd);
    if (Number.isFinite(endValue)) {
      rangeEnd = Math.max(0, endValue);
    }
  }

  if (rangeEnd !== null && rangeEnd <= rangeStart) {
    return null;
  }

  const rangedSegments = [];
  segments.forEach(segment => {
    const start = Math.max(segment.start, rangeStart);
    const end = rangeEnd !== null ? Math.min(segment.end, rangeEnd) : segment.end;
    if (end <= start) return;
    rangedSegments.push({ ...segment, start, end });
  });
  segments = rangedSegments;
  if (segments.length === 0) return null;

  const mergedResult = mergeConnectedSegments(segments, {
    defaultFilters,
    resolveVideoFilters,
    resolveAudioFilters,
    resolveClipVolume,
  });
  segments = mergedResult.segments;
  const mergeBlockedByOtherTracks = mergedResult.mergeBlockedByOtherTracks;

  const mediaById = new Map(state.mediaLibrary.map(media => [media.id, media]));
  if (exportSettings.allowLosslessCopy !== false && exportSettings.deClick !== true) {
    const copyCommand = buildConcatCopyCommand({
      segments,
      mediaById,
      exportSettings,
      defaultFilters,
      mediaInfo,
      resolveVideoFilters,
      resolveAudioFilters,
      resolveClipVolume,
    });
    if (copyCommand) {
      return { ...copyCommand, mergeBlockedByOtherTracks };
    }
  }

  const inputList = [];
  const mediaIndexById = new Map();

  segments.forEach(segment => {
    const segmentClips = [segment.videoClip, segment.audioClip];
    segmentClips.forEach(clip => {
      if (!clip) return;
      const media = mediaById.get(clip.mediaId);
      if (!media) return;
      if (!mediaIndexById.has(media.id)) {
        mediaIndexById.set(media.id, inputList.length);
        inputList.push(media);
      }
    });
  });

  if (inputList.length === 0) return null;

  const resolution = exportSettings.resolution === 'auto'
    ? getExportResolution(state)
    : exportSettings.resolution;
  const width = resolution && resolution.width ? resolution.width : 1280;
  const height = resolution && resolution.height ? resolution.height : 720;
  const fps = exportSettings.fps || 30;
  const sampleRate = exportSettings.sampleRate || 44100;
  const filterParts = [];
  const segmentLabels = [];
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

  segments.forEach((segment, index) => {
    const vLabel = `v${index}`;
    const aLabel = `a${index}`;
    const durationMs = segment.end - segment.start;
    if (durationMs <= 0) return;

    const videoClip = segment.videoClip || null;
    const audioClip = segment.audioClip || null;

    if (videoClip) {
      const media = mediaById.get(videoClip.mediaId);
      if (!media) return;

      const inputIndex = mediaIndexById.get(media.id);
      const sourceWindow = getClipSourceWindow(videoClip, segment.start, durationMs);
      const startSec = sourceWindow.startSec;
      const endSec = sourceWindow.endSec;
      const info = mediaInfo ? mediaInfo.get(media.id) : null;
      const isAudioOnly = media.type && media.type.startsWith('audio/');
      const hasVideo = info ? info.hasVideo !== false : !isAudioOnly;
      const videoFilters = [];

      if (hasVideo) {
        videoFilters.push(`trim=start=${startSec}:end=${endSec}`);
        videoFilters.push('setpts=PTS-STARTPTS');
        if (videoClip.reversed) {
          videoFilters.push('reverse');
          videoFilters.push('setpts=PTS-STARTPTS');
        }
        if (sourceWindow.speed && sourceWindow.speed !== 1) {
          videoFilters.push(`setpts=PTS-STARTPTS/${sourceWindow.speed}`);
        }

        const vf = resolveVideoFilters(videoClip, defaultFilters);
        const eqParts = [];
        if (vf.brightness !== 0) eqParts.push(`brightness=${vf.brightness}`);
        if (vf.contrast !== 1) eqParts.push(`contrast=${vf.contrast}`);
        if (vf.saturation !== 1) eqParts.push(`saturation=${vf.saturation}`);
        if (vf.gamma !== 1) eqParts.push(`gamma=${vf.gamma}`);
        if (eqParts.length > 0) {
          videoFilters.push(`eq=${eqParts.join(':')}`);
        }
        if (vf.hue !== 0) {
          videoFilters.push(`hue=h=${vf.hue}`);
        }
        if (vf.rotate === 90) {
          videoFilters.push('transpose=1');
        } else if (vf.rotate === 180) {
          videoFilters.push('transpose=2,transpose=2');
        } else if (vf.rotate === 270) {
          videoFilters.push('transpose=2');
        }
        if (vf.flipH) {
          videoFilters.push('hflip');
        }
        if (vf.flipV) {
          videoFilters.push('vflip');
        }
        if (vf.blur > 0) {
          videoFilters.push(`boxblur=lr=${vf.blur}:lp=1`);
        }
        if (vf.sharpen > 0) {
          videoFilters.push(`unsharp=5:5:${vf.sharpen}:5:5:0.0`);
        }
        if (vf.denoise > 0) {
          const strength = (vf.denoise / 2).toFixed(2).replace(/\.?0+$/, '');
          const luma = strength;
          const chroma = (vf.denoise / 2 * 1.5).toFixed(2).replace(/\.?0+$/, '');
          videoFilters.push(`hqdn3d=${luma}:${luma}:${chroma}:${chroma}`);
        }
        if (vf.fadeIn > 0) {
          videoFilters.push(`fade=in:st=0:d=${vf.fadeIn}`);
        }
        if (vf.fadeOut > 0) {
          const durationSec = durationMs / 1000;
          const start = Math.max(0, durationSec - vf.fadeOut);
          const startValue = start.toFixed(3).replace(/\.?0+$/, '');
          videoFilters.push(`fade=out:st=${startValue}:d=${vf.fadeOut}`);
        }

        videoFilters.push(scaleFilter);
        videoFilters.push('format=yuv420p');

        filterParts.push(
          `[${inputIndex}:v]${videoFilters.join(',')}[${vLabel}]`
        );
      } else {
        const durationSec = formatSeconds(durationMs);
        filterParts.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
          `format=yuv420p,setsar=1[${vLabel}]`
        );
      }
    } else {
      const durationSec = formatSeconds(durationMs);
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
        `format=yuv420p,setsar=1[${vLabel}]`
      );
    }

    if (audioClip) {
      const media = mediaById.get(audioClip.mediaId);
      if (!media) return;

      const inputIndex = mediaIndexById.get(media.id);
      const sourceWindow = getClipSourceWindow(audioClip, segment.start, durationMs);
      const startSec = sourceWindow.startSec;
      const endSec = sourceWindow.endSec;
      const info = mediaInfo ? mediaInfo.get(media.id) : null;
      const isAudioOnly = media.type && media.type.startsWith('audio/');
      const isVideoType = media.type && media.type.startsWith('video/');
      let hasAudio = false;
      if (info && info.hasAudio !== null && info.hasAudio !== undefined) {
        hasAudio = info.hasAudio === true;
      } else if (isAudioOnly) {
        hasAudio = true;
      } else if (isVideoType) {
        hasAudio = true;
        exportAudioWarning = true;
      } else {
        exportAudioWarning = true;
      }
      const audioFilters = [];

      if (hasAudio) {
        audioFilters.push(`atrim=start=${startSec}:end=${endSec}`);
        audioFilters.push('asetpts=PTS-STARTPTS');
        if (audioClip.reversed) {
          audioFilters.push('areverse');
          audioFilters.push('asetpts=PTS-STARTPTS');
        }

        const af = resolveAudioFilters(audioClip, defaultFilters);
        const pitchSemitones = af.pitch || 0;
        const pitchRatio = Math.pow(2, pitchSemitones / 12);
        const speed = sourceWindow.speed || 1;
        const tempo = speed / pitchRatio;

        if (pitchSemitones !== 0) {
          const rate = (sampleRate * pitchRatio).toFixed(2).replace(/\.?0+$/, '');
          audioFilters.push(`asetrate=${rate}`);
        }

        buildAtempoFilters(tempo).forEach(filter => audioFilters.push(filter));

        if (af.bass) {
          audioFilters.push(`bass=g=${af.bass}`);
        }
        if (af.treble) {
          audioFilters.push(`treble=g=${af.treble}`);
        }
        if (af.normalize) {
          audioFilters.push('dynaudnorm');
        }
        if (af.pan) {
          const left = ((1 - af.pan) / 2).toFixed(3).replace(/\.?0+$/, '');
          const right = ((1 + af.pan) / 2).toFixed(3).replace(/\.?0+$/, '');
          audioFilters.push(`pan=stereo|c0=${left}*c0+${left}*c1|c1=${right}*c0+${right}*c1`);
        }
        if (af.fadeIn > 0) {
          audioFilters.push(`afade=t=in:st=0:d=${af.fadeIn}`);
        }
        if (af.fadeOut > 0) {
          const durationSec = durationMs / 1000;
          const start = Math.max(0, durationSec - af.fadeOut);
          const startValue = start.toFixed(3).replace(/\.?0+$/, '');
          audioFilters.push(`afade=t=out:st=${startValue}:d=${af.fadeOut}`);
        }

        const volume = audioClip.muted ? 0 : resolveClipVolume(audioClip, defaultFilters);
        if (volume !== 1) {
          audioFilters.push(`volume=${volume}`);
        }

        if (exportSettings.deClick === true) {
          appendDeClickFilters(audioFilters, durationMs);
        }

        filterParts.push(
          `[${inputIndex}:a]${audioFilters.join(',')}[${aLabel}]`
        );
      } else {
        const durationSec = formatSeconds(durationMs);
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:d=${durationSec}[${aLabel}]`
        );
      }
    } else {
      const durationSec = formatSeconds(durationMs);
      filterParts.push(
        `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:d=${durationSec}[${aLabel}]`
      );
    }

    segmentLabels.push(`[${vLabel}][${aLabel}]`);
  });

  if (segmentLabels.length === 0) return null;

  filterParts.push(
    `${segmentLabels.join('')}concat=n=${segmentLabels.length}:v=1:a=1[outv][outa]`
  );

  const inputs = inputList
    .map(media => `-i "${escapeShellArg(media.name)}"`)
    .join(' ');
  const filterComplex = filterParts.join('; ');
  const outputFormat = exportSettings.format || 'mp4';
  const videoFlags = [];
  const audioFlags = [];

  if (exportSettings.videoCodec) {
    videoFlags.push(`-c:v ${exportSettings.videoCodec}`);
  }

  if (exportSettings.videoBitrate) {
    videoFlags.push(`-b:v ${exportSettings.videoBitrate}`);
  } else if (
    exportSettings.videoCodec &&
    (exportSettings.videoCodec.includes('264') || exportSettings.videoCodec.includes('265'))
  ) {
    videoFlags.push(`-crf ${exportSettings.crf || 23}`);
    if (exportSettings.preset) {
      videoFlags.push(`-preset ${exportSettings.preset}`);
    }
  }

  if (exportSettings.fps) {
    videoFlags.push(`-r ${exportSettings.fps}`);
  }

  if (exportSettings.audioCodec) {
    audioFlags.push(`-c:a ${exportSettings.audioCodec}`);
  }
  if (exportSettings.audioBitrate) {
    audioFlags.push(`-b:a ${exportSettings.audioBitrate}`);
  }
  if (exportSettings.sampleRate) {
    audioFlags.push(`-ar ${exportSettings.sampleRate}`);
  }
  const movFlags = (outputFormat === 'mp4' || outputFormat === 'mov')
    ? ' -movflags +faststart'
    : '';

  return {
    command: `ffmpeg ${inputs} -filter_complex "${filterComplex}" ` +
      `-map "[outv]" -map "[outa]" ` +
      `${videoFlags.join(' ')} ${audioFlags.join(' ')}` +
      `${movFlags} -y output.${outputFormat}`,
    exportAudioWarning,
    usedLosslessCopy: false,
    mergeBlockedByOtherTracks,
  };
}

/**
 * Build a concat-demuxer copy command when the timeline has no effects.
 * @param {{
 *  segments: Array<{audioClip: import('../core/types.js').Clip|null, videoClip: import('../core/types.js').Clip|null, start: number, end: number}>,
 *  mediaById: Map<string, import('../core/types.js').Media>,
 *  exportSettings: import('../core/types.js').ExportSettings,
 *  defaultFilters: import('../core/types.js').DefaultFilters,
 *  mediaInfo: Map<string, {hasAudio: boolean|null, hasVideo: boolean|null, isAudioOnly: boolean, isVideoType: boolean}>|null,
 *  resolveVideoFilters: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => import('../core/types.js').ClipVideoFilters,
 *  resolveAudioFilters: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => import('../core/types.js').ClipAudioFilters,
 *  resolveClipVolume: (clip: import('../core/types.js').Clip, defaults: import('../core/types.js').DefaultFilters) => number,
 * }} options
 * @returns {{command: string, exportAudioWarning: boolean, usedLosslessCopy: boolean}|null}
 */
function buildConcatCopyCommand(options) {
  const {
    segments,
    mediaById,
    exportSettings,
    defaultFilters,
    mediaInfo,
    resolveVideoFilters,
    resolveAudioFilters,
    resolveClipVolume,
  } = options;

  if (!segments || segments.length === 0) return null;

  let sourceMediaId = null;
  let exportAudioWarning = false;
  const concatLines = [];

  for (const segment of segments) {
    const durationMs = segment.end - segment.start;
    if (durationMs <= 0) return null;
    if (!segment.videoClip || !segment.audioClip) return null;
    if (segment.videoClip.id !== segment.audioClip.id) return null;

    const clip = segment.videoClip;
    if (!isCopySafeClip(clip, defaultFilters, resolveVideoFilters, resolveAudioFilters, resolveClipVolume)) {
      return null;
    }

    if (!sourceMediaId) {
      sourceMediaId = clip.mediaId;
    } else if (sourceMediaId !== clip.mediaId) {
      return null;
    }

    const media = mediaById.get(clip.mediaId);
    if (!media) return null;

    const info = mediaInfo ? mediaInfo.get(media.id) : null;
    const isAudioOnly = media.type && media.type.startsWith('audio/');
    const isVideoType = media.type && media.type.startsWith('video/');
    const hasVideo = info ? info.hasVideo !== false : (isVideoType || !isAudioOnly);
    const hasAudio = info ? info.hasAudio !== false : (isAudioOnly || isVideoType);
    if (!hasVideo || !hasAudio) return null;
    if (!info || info.hasAudio === null || info.hasAudio === undefined) {
      exportAudioWarning = true;
    }

    const sourceWindow = getClipSourceWindow(clip, segment.start, durationMs);
    concatLines.push(`file 'file:${escapeConcatFilePath(media.name)}'`);
    concatLines.push(`inpoint ${sourceWindow.startSec}`);
    concatLines.push(`outpoint ${sourceWindow.endSec}`);
  }

  if (!sourceMediaId) return null;

  const concatPayload = `${concatLines.join('\\n')}\\n`;
  const concatArg = escapeForSingleQuotes(concatPayload);
  const outputFormat = exportSettings.format || 'mp4';
  const movFlags = (outputFormat === 'mp4' || outputFormat === 'mov')
    ? ' -movflags +faststart'
    : '';

  return {
    command: `printf '%b' '${concatArg}' | ` +
      `ffmpeg -f concat -safe 0 ` +
      `-protocol_whitelist file,pipe,fd,crypto,data -i - ` +
      `-c copy${movFlags} -y output.${outputFormat}`,
    exportAudioWarning,
    usedLosslessCopy: true,
  };
}

function isCopySafeClip(clip, defaults, resolveVideoFilters, resolveAudioFilters, resolveClipVolume) {
  const speed = clip.speed === undefined ? 1 : clip.speed;
  if (speed !== 1) return false;
  if (clip.reversed) return false;
  if (clip.muted) return false;
  if (clip.visible === false) return false;

  const videoFilters = resolveVideoFilters(clip, defaults);
  if (!isNeutralVideoFilters(videoFilters)) return false;

  const audioFilters = resolveAudioFilters(clip, defaults);
  if (!isNeutralAudioFilters(audioFilters)) return false;

  const volume = resolveClipVolume(clip, defaults);
  if (!Number.isFinite(volume) || volume !== 1) return false;

  return true;
}

function isNeutralVideoFilters(filters) {
  return (
    filters.brightness === DEFAULT_VIDEO_FILTERS.brightness &&
    filters.contrast === DEFAULT_VIDEO_FILTERS.contrast &&
    filters.saturation === DEFAULT_VIDEO_FILTERS.saturation &&
    filters.hue === DEFAULT_VIDEO_FILTERS.hue &&
    filters.gamma === DEFAULT_VIDEO_FILTERS.gamma &&
    filters.rotate === DEFAULT_VIDEO_FILTERS.rotate &&
    filters.flipH === DEFAULT_VIDEO_FILTERS.flipH &&
    filters.flipV === DEFAULT_VIDEO_FILTERS.flipV &&
    filters.blur === DEFAULT_VIDEO_FILTERS.blur &&
    filters.sharpen === DEFAULT_VIDEO_FILTERS.sharpen &&
    filters.denoise === DEFAULT_VIDEO_FILTERS.denoise &&
    filters.fadeIn === DEFAULT_VIDEO_FILTERS.fadeIn &&
    filters.fadeOut === DEFAULT_VIDEO_FILTERS.fadeOut
  );
}

function isNeutralAudioFilters(filters) {
  return (
    filters.volume === DEFAULT_AUDIO_FILTERS.volume &&
    filters.bass === DEFAULT_AUDIO_FILTERS.bass &&
    filters.treble === DEFAULT_AUDIO_FILTERS.treble &&
    filters.normalize === DEFAULT_AUDIO_FILTERS.normalize &&
    filters.pan === DEFAULT_AUDIO_FILTERS.pan &&
    filters.pitch === DEFAULT_AUDIO_FILTERS.pitch &&
    filters.fadeIn === DEFAULT_AUDIO_FILTERS.fadeIn &&
    filters.fadeOut === DEFAULT_AUDIO_FILTERS.fadeOut
  );
}

function escapeConcatFilePath(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeForSingleQuotes(value) {
  return String(value).replace(/'/g, `'\\''`);
}

/**
 * Build topmost-visible segments for the timeline
 * @param {import('../core/types.js').EditorState} state
 * @param {Map<string, {hasAudio: boolean|null, hasVideo: boolean|null, isAudioOnly: boolean, isVideoType: boolean}>|null} mediaInfo
 * @returns {Array<{audioClip: import('../core/types.js').Clip|null, videoClip: import('../core/types.js').Clip|null, start: number, end: number}>}
 */
function getTopmostSegments(state, mediaInfo) {
  const clips = state.clips;
  if (clips.length === 0) return [];

  const infoMap = mediaInfo || new Map();
  const mediaById = new Map(state.mediaLibrary.map(media => [media.id, media]));
  const hasVideoForClip = (clip) => {
    const media = mediaById.get(clip.mediaId);
    if (!media) return false;
    const info = infoMap.get(media.id);
    const isAudioOnly = media.type && media.type.startsWith('audio/');
    const isVideoType = media.type && media.type.startsWith('video/');
    if (info) {
      if (info.hasVideo === true) return true;
      if (info.hasVideo === false) return false;
      return info.isVideoType || isVideoType || !isAudioOnly;
    }
    return isVideoType || !isAudioOnly;
  };

  const boundaries = new Set([0]);
  clips.forEach(clip => {
    boundaries.add(clip.start);
    boundaries.add(clip.start + clip.duration);
  });

  const times = Array.from(boundaries).sort((a, b) => a - b);
  const segments = [];

  const getTopmost = (active) => {
    let topmost = null;
    for (const clip of active) {
      if (!topmost || clip.trackId < topmost.trackId) {
        topmost = clip;
      }
    }
    return topmost;
  };

  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i];
    const end = times[i + 1];
    if (end <= start) continue;

    const active = clips.filter(
      clip => start >= clip.start && start < clip.start + clip.duration
    );
    if (active.length === 0) {
      segments.push({ audioClip: null, videoClip: null, start, end });
      continue;
    }

    const audioClip = getTopmost(active);
    const videoClip = getTopmost(
      active.filter(clip => clip.visible !== false && hasVideoForClip(clip))
    );

    segments.push({ audioClip, videoClip, start, end });
  }

  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    const sameAudio = last && (
      (last.audioClip && segment.audioClip && last.audioClip.id === segment.audioClip.id) ||
      (!last.audioClip && !segment.audioClip)
    );
    const sameVideo = last && (
      (last.videoClip && segment.videoClip && last.videoClip.id === segment.videoClip.id) ||
      (!last.videoClip && !segment.videoClip)
    );
    if (last && sameAudio && sameVideo) {
      last.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

/**
 * Compute source trim window for a timeline segment
 * @param {import('../core/types.js').Clip} clip
 * @param {number} segmentStart
 * @param {number} durationMs
 * @returns {{startSec: string, endSec: string, speed: number}}
 */
function getClipSourceWindow(clip, segmentStart, durationMs) {
  const clipSpeed = clip.speed || 1;
  const segmentOffsetMs = segmentStart - clip.start;
  const sourceDurationMs = durationMs * clipSpeed;
  const trimStart = clip.trimStart || 0;

  if (clip.reversed) {
    const sourceLengthMs = clip.duration * clipSpeed;
    const reverseStart = sourceLengthMs - (segmentOffsetMs + durationMs) * clipSpeed;
    const sourceStartMs = trimStart + Math.max(0, reverseStart);
    return {
      startSec: formatSeconds(sourceStartMs),
      endSec: formatSeconds(sourceStartMs + sourceDurationMs),
      speed: clipSpeed,
    };
  }

  const sourceStartMs = trimStart + segmentOffsetMs * clipSpeed;
  return {
    startSec: formatSeconds(sourceStartMs),
    endSec: formatSeconds(sourceStartMs + sourceDurationMs),
    speed: clipSpeed,
  };
}

/**
 * Build chained atempo filters for a tempo value
 * @param {number} tempo
 * @returns {string[]}
 */
function buildAtempoFilters(tempo) {
  const filters = [];
  if (!tempo || tempo === 1) return filters;
  let remaining = tempo;
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  if (Math.abs(remaining - 1) > 0.001) {
    const value = remaining.toFixed(3).replace(/\.?0+$/, '');
    filters.push(`atempo=${value}`);
  }
  return filters;
}

function appendDeClickFilters(audioFilters, durationMs) {
  if (!Array.isArray(audioFilters)) return;
  const durationSec = durationMs / 1000;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;

  const target = 0.005;
  const fade = Math.min(target, durationSec / 2);
  if (fade <= 0) return;

  const fadeValue = fade.toFixed(3).replace(/\.?0+$/, '');
  const start = Math.max(0, durationSec - fade);
  const startValue = start.toFixed(3).replace(/\.?0+$/, '');

  audioFilters.push(`afade=t=in:st=0:d=${fadeValue}`);
  audioFilters.push(`afade=t=out:st=${startValue}:d=${fadeValue}`);
}

function mergeConnectedSegments(segments, options) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { segments: [], mergeBlockedByOtherTracks: false };
  }

  const {
    defaultFilters,
    resolveVideoFilters,
    resolveAudioFilters,
    resolveClipVolume,
  } = options || {};

  if (!defaultFilters || !resolveVideoFilters || !resolveAudioFilters || !resolveClipVolume) {
    return { segments: segments.map(segment => ({ ...segment })), mergeBlockedByOtherTracks: false };
  }

  const TIME_EPSILON_MS = 0.5;
  const isCloseTime = (a, b) => Math.abs(a - b) <= TIME_EPSILON_MS;

  const videoFiltersCache = new Map();
  const audioFiltersCache = new Map();
  const volumeCache = new Map();

  const getVideoFilters = (clip) => {
    if (!clip) return null;
    if (videoFiltersCache.has(clip.id)) return videoFiltersCache.get(clip.id);
    const resolved = resolveVideoFilters(clip, defaultFilters);
    videoFiltersCache.set(clip.id, resolved);
    return resolved;
  };

  const getAudioFilters = (clip) => {
    if (!clip) return null;
    if (audioFiltersCache.has(clip.id)) return audioFiltersCache.get(clip.id);
    const resolved = resolveAudioFilters(clip, defaultFilters);
    audioFiltersCache.set(clip.id, resolved);
    return resolved;
  };

  const getVolume = (clip) => {
    if (!clip) return null;
    if (volumeCache.has(clip.id)) return volumeCache.get(clip.id);
    const volume = resolveClipVolume(clip, defaultFilters);
    volumeCache.set(clip.id, volume);
    return volume;
  };

  const areVideoFiltersEqual = (a, b) => (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.hue === b.hue &&
    a.gamma === b.gamma &&
    a.rotate === b.rotate &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    a.blur === b.blur &&
    a.sharpen === b.sharpen &&
    a.denoise === b.denoise &&
    a.fadeIn === b.fadeIn &&
    a.fadeOut === b.fadeOut
  );

  const areAudioFiltersEqual = (a, b) => (
    a.volume === b.volume &&
    a.bass === b.bass &&
    a.treble === b.treble &&
    a.normalize === b.normalize &&
    a.pan === b.pan &&
    a.pitch === b.pitch &&
    a.fadeIn === b.fadeIn &&
    a.fadeOut === b.fadeOut
  );

  const areVolumesEqual = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= 1e-6;
  };

  const isContinuousClipPair = (prevClip, nextClip, boundaryTime, kind) => {
    if (!prevClip || !nextClip) return false;
    if (prevClip.mediaId !== nextClip.mediaId) return false;

    const prevSpeed = prevClip.speed || 1;
    const nextSpeed = nextClip.speed || 1;
    if (prevSpeed !== nextSpeed) return false;
    if (Boolean(prevClip.reversed) !== Boolean(nextClip.reversed)) return false;
    if (prevClip.reversed) return false;

    const prevEnd = prevClip.start + prevClip.duration;
    if (!isCloseTime(prevEnd, boundaryTime) || !isCloseTime(nextClip.start, boundaryTime)) {
      return false;
    }

    const expectedTrimStart = (prevClip.trimStart || 0) + prevClip.duration * prevSpeed;
    if (!isCloseTime(expectedTrimStart, nextClip.trimStart || 0)) return false;

    if (kind === 'video') {
      if (prevClip.visible === false || nextClip.visible === false) return false;
      const prevFilters = getVideoFilters(prevClip);
      const nextFilters = getVideoFilters(nextClip);
      if (!prevFilters || !nextFilters || !areVideoFiltersEqual(prevFilters, nextFilters)) {
        return false;
      }
    }

    if (kind === 'audio') {
      if (Boolean(prevClip.muted) !== Boolean(nextClip.muted)) return false;
      const prevFilters = getAudioFilters(prevClip);
      const nextFilters = getAudioFilters(nextClip);
      if (!prevFilters || !nextFilters || !areAudioFiltersEqual(prevFilters, nextFilters)) {
        return false;
      }
      const prevVolume = getVolume(prevClip);
      const nextVolume = getVolume(nextClip);
      if (!areVolumesEqual(prevVolume, nextVolume)) return false;
    }

    return true;
  };

  const canMergeClip = (prevClip, nextClip, boundaryTime, kind) => {
    if (!prevClip && !nextClip) return { ok: true, reason: 'empty' };
    if (!prevClip || !nextClip) return { ok: false, reason: 'different' };
    if (prevClip.id === nextClip.id) return { ok: true, reason: 'same-clip' };
    if (isContinuousClipPair(prevClip, nextClip, boundaryTime, kind)) {
      return { ok: true, reason: 'continuous' };
    }
    return { ok: false, reason: 'different' };
  };

  const merged = [{ ...segments[0] }];
  let mergeBlockedByOtherTracks = false;

  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    const last = merged[merged.length - 1];

    if (!last || !isCloseTime(last.end, segment.start)) {
      merged.push({ ...segment });
      continue;
    }

    const boundaryTime = segment.start;
    const audioMerge = canMergeClip(last.audioClip, segment.audioClip, boundaryTime, 'audio');
    const videoMerge = canMergeClip(last.videoClip, segment.videoClip, boundaryTime, 'video');

    if (audioMerge.ok && videoMerge.ok) {
      last.end = segment.end;
      continue;
    }

    if (
      (audioMerge.reason === 'continuous' && !videoMerge.ok) ||
      (videoMerge.reason === 'continuous' && !audioMerge.ok)
    ) {
      mergeBlockedByOtherTracks = true;
    }

    merged.push({ ...segment });
  }

  return { segments: merged, mergeBlockedByOtherTracks };
}
