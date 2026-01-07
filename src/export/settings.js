/**
 * @fileoverview Export defaults and presets
 */

export const DEFAULT_EXPORT_SETTINGS = {
  resolution: 'auto',
  fps: 30,
  videoCodec: 'libx264',
  videoBitrate: '',
  crf: 23,
  preset: 'medium',
  audioCodec: 'aac',
  audioBitrate: '192k',
  sampleRate: 44100,
  format: 'mp4',
  rangeStart: 0,
  rangeEnd: null,
  deClick: true,
  allowLosslessCopy: true,
};

export function createDefaultExportSettings() {
  return { ...DEFAULT_EXPORT_SETTINGS };
}

export const EXPORT_PRESETS = [
  {
    id: 'universal-h264',
    label: 'Universal (H.264)',
    settings: {
      resolution: 'auto',
      fps: 30,
      videoCodec: 'libx264',
      videoBitrate: '',
      crf: 23,
      preset: 'medium',
      audioCodec: 'aac',
      audioBitrate: '192k',
      sampleRate: 44100,
    },
  },
  {
    id: 'small-share',
    label: 'Small Share (720p)',
    settings: {
      resolution: { width: 1280, height: 720 },
      fps: 30,
      videoCodec: 'libx264',
      videoBitrate: '',
      crf: 28,
      preset: 'veryfast',
      audioCodec: 'aac',
      audioBitrate: '96k',
      sampleRate: 44100,
    },
  },
  {
    id: 'youtube-1080p',
    label: 'YouTube 1080p',
    settings: {
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      videoCodec: 'libx264',
      videoBitrate: '',
      crf: 20,
      preset: 'slow',
      audioCodec: 'aac',
      audioBitrate: '192k',
      sampleRate: 48000,
    },
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K (H.265)',
    settings: {
      resolution: { width: 3840, height: 2160 },
      fps: 30,
      videoCodec: 'libx265',
      videoBitrate: '',
      crf: 20,
      preset: 'slow',
      audioCodec: 'aac',
      audioBitrate: '256k',
      sampleRate: 48000,
    },
  },
];

/**
 * Check if export settings match a preset
 * @param {import('../core/types.js').ExportSettings} exportSettings
 * @param {object} presetSettings
 * @returns {boolean}
 */
export function exportSettingsMatchPreset(exportSettings, presetSettings) {
  const normalizeResolution = (value) => {
    if (value === 'auto') return 'auto';
    if (!value || typeof value !== 'object') return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height };
  };

  const currentResolution = normalizeResolution(exportSettings.resolution);
  const presetResolution = normalizeResolution(presetSettings.resolution);

  if (!presetResolution) {
    return false;
  }
  if (presetResolution === 'auto') {
    if (currentResolution !== 'auto') return false;
  } else {
    if (!currentResolution || currentResolution === 'auto') return false;
    if (
      currentResolution.width !== presetResolution.width ||
      currentResolution.height !== presetResolution.height
    ) {
      return false;
    }
  }

  const numberKeys = new Set(['fps', 'crf', 'sampleRate']);
  const keys = [
    'fps',
    'videoCodec',
    'videoBitrate',
    'crf',
    'preset',
    'audioCodec',
    'audioBitrate',
    'sampleRate',
  ];

  for (const key of keys) {
    const presetValue = presetSettings[key];
    const currentValue = exportSettings[key];
    if (numberKeys.has(key)) {
      if (Number(presetValue) !== Number(currentValue)) return false;
    } else if (String(presetValue || '') !== String(currentValue || '')) {
      return false;
    }
  }

  return true;
}

/**
 * Find a matching export preset id for current settings
 * @param {import('../core/types.js').ExportSettings} exportSettings
 * @returns {string}
 */
export function getExportPresetMatch(exportSettings) {
  if (!Array.isArray(EXPORT_PRESETS)) return '';
  for (const preset of EXPORT_PRESETS) {
    if (exportSettingsMatchPreset(exportSettings, preset.settings)) {
      return preset.id;
    }
  }
  return '';
}
