/**
 * @fileoverview Properties panel renderer and bindings
 */

import * as actions from '../core/actions.js';
import { createDefaultFilters } from '../core/constants.js';
import { escapeHtml, formatSeconds } from '../utils/format.js';
import { getExportResolution } from '../export/ffmpeg.js';
import { EXPORT_PRESETS, getExportPresetMatch } from '../export/settings.js';
import { getClipSourceRange, mapSourceTimeToClipTime } from '../utils/clipTiming.js';
import { decoratePropertySliders } from './rangeVisuals.js';
import { parseWhisperTranscript, renderTranscriptResults } from './transcript.js';
import { buildSpeechSegments, renderSpeechBuilderResults } from './speechBuilder.js';

export class PropertiesPanel {
  /**
   * @param {object} editor
   */
  constructor(editor) {
    this.editor = editor;
    this.activeTab = 'properties';
    this.builderState = {
      sentence: '',
      segments: [],
      selections: {},
      mediaId: null,
      transcriptKey: null,
      missingCount: 0,
    };
    this.transcriptTab = 'search';
  }

  /**
   * Render properties panel for selected clip
   * @param {import('../core/types.js').EditorState} state
   */
  render(state) {
    const editor = this.editor;
    const propertiesContent = document.getElementById('propertiesContent');
    if (!propertiesContent) return;

    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);
    const selectedMediaId = selectedIds.length === 0 ? state.selectedMediaId : null;
    const selectedMedia = selectedMediaId
      ? state.mediaLibrary.find(m => m.id === selectedMediaId) || null
      : null;

    const defaultFilters = editor.getDefaultFilters(state);
    const exportSettings = editor.getExportSettings(state);

    const decorateSliders = () => {
      decoratePropertySliders(propertiesContent, {
        onResetDefaultFilter: (section, key, value) => {
          editor.state.dispatch(actions.updateDefaultFilters(section, { [key]: value }));
        },
      });
    };

    if (selectedIds.length === 0 && !selectedMedia) {
      this.activeTab = 'properties';
      const baseDefaults = createDefaultFilters();
      const resolutionIsAuto = exportSettings.resolution === 'auto';
      const resolvedResolution = resolutionIsAuto
        ? getExportResolution(state)
        : exportSettings.resolution;
      const widthValue = resolvedResolution && resolvedResolution.width ? resolvedResolution.width : 1280;
      const heightValue = resolvedResolution && resolvedResolution.height ? resolvedResolution.height : 720;
      const rangeStartMs = Number.isFinite(exportSettings.rangeStart)
        ? Math.max(0, exportSettings.rangeStart)
        : 0;
      const rangeEndMs = Number.isFinite(exportSettings.rangeEnd)
        ? Math.max(0, exportSettings.rangeEnd)
        : null;
      const rangeStartValue = formatSeconds(rangeStartMs);
      const rangeEndValue = rangeEndMs !== null ? formatSeconds(rangeEndMs) : '';
      const presetMatchId = getExportPresetMatch(exportSettings);
      const presetOptions = Array.isArray(EXPORT_PRESETS)
        ? EXPORT_PRESETS.map((preset) => (
          `<option value="${preset.id}" ${presetMatchId === preset.id ? 'selected' : ''}>${preset.label}</option>`
        )).join('')
        : '';

      propertiesContent.innerHTML = `
        <div class="properties-header">Project Settings</div>
        <div class="property-group">
          <label class="property-label" for="project-export-preset">Export Preset</label>
          <select class="property-input" id="project-export-preset">
            <option value="">Custom</option>
            ${presetOptions}
          </select>
          <div class="property-help">Presets keep the current container format.</div>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-resolution-mode">Resolution</label>
          <select class="property-input" id="project-resolution-mode">
            <option value="auto" ${resolutionIsAuto ? 'selected' : ''}>Auto (max clip)</option>
            <option value="custom" ${resolutionIsAuto ? '' : 'selected'}>Custom</option>
          </select>
          <div class="property-row property-row-stack">
            <label class="property-row-label" for="project-resolution-width">Width</label>
            <input type="number" class="property-input" id="project-resolution-width"
                   min="320" value="${widthValue}">
          </div>
          <div class="property-row property-row-stack">
            <label class="property-row-label" for="project-resolution-height">Height</label>
            <input type="number" class="property-input" id="project-resolution-height"
                   min="240" value="${heightValue}">
          </div>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-fps">FPS</label>
          <input type="number" class="property-input" id="project-fps" min="1" max="120"
                 value="${exportSettings.fps}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-codec">Video Codec</label>
          <select class="property-input" id="project-video-codec">
            <option value="libx264" ${exportSettings.videoCodec === 'libx264' ? 'selected' : ''}>H.264 (libx264)</option>
            <option value="libx265" ${exportSettings.videoCodec === 'libx265' ? 'selected' : ''}>H.265 (libx265)</option>
            <option value="libvpx-vp9" ${exportSettings.videoCodec === 'libvpx-vp9' ? 'selected' : ''}>VP9 (libvpx-vp9)</option>
          </select>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-bitrate">Video Bitrate (optional)</label>
          <input type="text" class="property-input" id="project-video-bitrate"
                 placeholder="e.g. 5M" value="${exportSettings.videoBitrate || ''}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-crf">CRF (x264/x265)</label>
          <input type="number" class="property-input" id="project-crf" min="0" max="51"
                 value="${exportSettings.crf}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-preset">Preset</label>
          <select class="property-input" id="project-preset">
            <option value="ultrafast" ${exportSettings.preset === 'ultrafast' ? 'selected' : ''}>ultrafast</option>
            <option value="fast" ${exportSettings.preset === 'fast' ? 'selected' : ''}>fast</option>
            <option value="medium" ${exportSettings.preset === 'medium' ? 'selected' : ''}>medium</option>
            <option value="slow" ${exportSettings.preset === 'slow' ? 'selected' : ''}>slow</option>
            <option value="veryslow" ${exportSettings.preset === 'veryslow' ? 'selected' : ''}>veryslow</option>
          </select>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-codec">Audio Codec</label>
          <select class="property-input" id="project-audio-codec">
            <option value="aac" ${exportSettings.audioCodec === 'aac' ? 'selected' : ''}>AAC</option>
            <option value="libopus" ${exportSettings.audioCodec === 'libopus' ? 'selected' : ''}>Opus</option>
            <option value="libmp3lame" ${exportSettings.audioCodec === 'libmp3lame' ? 'selected' : ''}>MP3</option>
            <option value="flac" ${exportSettings.audioCodec === 'flac' ? 'selected' : ''}>FLAC</option>
          </select>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-bitrate">Audio Bitrate</label>
          <input type="text" class="property-input" id="project-audio-bitrate"
                 value="${exportSettings.audioBitrate}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-sample-rate">Sample Rate</label>
          <input type="number" class="property-input" id="project-sample-rate" min="8000" max="192000"
                 value="${exportSettings.sampleRate}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-format">Container</label>
          <select class="property-input" id="project-format">
            <option value="mp4" ${exportSettings.format === 'mp4' ? 'selected' : ''}>MP4</option>
            <option value="mkv" ${exportSettings.format === 'mkv' ? 'selected' : ''}>MKV</option>
            <option value="webm" ${exportSettings.format === 'webm' ? 'selected' : ''}>WebM</option>
            <option value="mov" ${exportSettings.format === 'mov' ? 'selected' : ''}>MOV</option>
          </select>
        </div>
        <div class="property-group">
          <label class="property-label">Export Range (seconds)</label>
          <div class="property-row">
            <label class="property-row-label" for="project-export-start">Start</label>
            <input type="number" class="property-input" id="project-export-start"
                   min="0" step="0.1" value="${rangeStartValue}"
                   aria-label="Export start time in seconds">
          </div>
          <div class="property-row">
            <label class="property-row-label" for="project-export-end">End</label>
            <input type="number" class="property-input" id="project-export-end"
                   min="0" step="0.1" value="${rangeEndValue}" placeholder="Full"
                   aria-label="Export end time in seconds">
          </div>
        </div>

        <h3 class="property-section-title">Default Video Filters</h3>
        <div class="property-group">
          <label class="property-label" for="project-video-brightness">Brightness</label>
          <input type="range" class="property-slider" id="project-video-brightness"
                 min="-1" max="1" step="0.05" value="${defaultFilters.video.brightness}"
                 data-filter-section="video" data-filter-key="brightness"
                 data-default-value="${baseDefaults.video.brightness}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-contrast">Contrast</label>
          <input type="range" class="property-slider" id="project-video-contrast"
                 min="0" max="4" step="0.05" value="${defaultFilters.video.contrast}"
                 data-filter-section="video" data-filter-key="contrast"
                 data-default-value="${baseDefaults.video.contrast}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-saturation">Saturation</label>
          <input type="range" class="property-slider" id="project-video-saturation"
                 min="0" max="3" step="0.05" value="${defaultFilters.video.saturation}"
                 data-filter-section="video" data-filter-key="saturation"
                 data-default-value="${baseDefaults.video.saturation}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-hue">Hue</label>
          <input type="range" class="property-slider" id="project-video-hue"
                 min="-180" max="180" step="1" value="${defaultFilters.video.hue}"
                 data-filter-section="video" data-filter-key="hue"
                 data-default-value="${baseDefaults.video.hue}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-gamma">Gamma</label>
          <input type="range" class="property-slider" id="project-video-gamma"
                 min="0.1" max="10" step="0.1" value="${defaultFilters.video.gamma}"
                 data-filter-section="video" data-filter-key="gamma"
                 data-default-value="${baseDefaults.video.gamma}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-rotate">Rotate</label>
          <select class="property-input" id="project-video-rotate">
            <option value="0" ${defaultFilters.video.rotate === 0 ? 'selected' : ''}>0°</option>
            <option value="90" ${defaultFilters.video.rotate === 90 ? 'selected' : ''}>90°</option>
            <option value="180" ${defaultFilters.video.rotate === 180 ? 'selected' : ''}>180°</option>
            <option value="270" ${defaultFilters.video.rotate === 270 ? 'selected' : ''}>270°</option>
          </select>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="project-video-flip-h"
                 ${defaultFilters.video.flipH ? 'checked' : ''}>
          <label class="property-label" for="project-video-flip-h">Flip Horizontal</label>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="project-video-flip-v"
                 ${defaultFilters.video.flipV ? 'checked' : ''}>
          <label class="property-label" for="project-video-flip-v">Flip Vertical</label>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-blur">Blur</label>
          <input type="range" class="property-slider" id="project-video-blur"
                 min="0" max="10" step="0.5" value="${defaultFilters.video.blur}"
                 data-filter-section="video" data-filter-key="blur"
                 data-default-value="${baseDefaults.video.blur}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-sharpen">Sharpen</label>
          <input type="range" class="property-slider" id="project-video-sharpen"
                 min="0" max="10" step="0.5" value="${defaultFilters.video.sharpen}"
                 data-filter-section="video" data-filter-key="sharpen"
                 data-default-value="${baseDefaults.video.sharpen}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-denoise">Denoise</label>
          <input type="range" class="property-slider" id="project-video-denoise"
                 min="0" max="10" step="0.5" value="${defaultFilters.video.denoise}"
                 data-filter-section="video" data-filter-key="denoise"
                 data-default-value="${baseDefaults.video.denoise}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-fade-in">Fade In (s)</label>
          <input type="number" class="property-input" id="project-video-fade-in"
                 min="0" step="0.1" value="${defaultFilters.video.fadeIn}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-video-fade-out">Fade Out (s)</label>
          <input type="number" class="property-input" id="project-video-fade-out"
                 min="0" step="0.1" value="${defaultFilters.video.fadeOut}">
        </div>

        <h3 class="property-section-title">Default Audio Filters</h3>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="project-declick"
                 ${exportSettings.deClick ? 'checked' : ''}>
          <label class="property-label" for="project-declick">De-click cuts (re-encode)</label>
          <div class="property-help">Export-only: adds tiny fades at segment boundaries to reduce clicks/pops.</div>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-volume">Volume</label>
          <input type="range" class="property-slider" id="project-audio-volume"
                 min="0" max="2" step="0.01" value="${defaultFilters.audio.volume}"
                 data-filter-section="audio" data-filter-key="volume"
                 data-default-value="${baseDefaults.audio.volume}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-bass">Bass (dB)</label>
          <input type="range" class="property-slider" id="project-audio-bass"
                 min="-20" max="20" step="1" value="${defaultFilters.audio.bass}"
                 data-filter-section="audio" data-filter-key="bass"
                 data-default-value="${baseDefaults.audio.bass}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-treble">Treble (dB)</label>
          <input type="range" class="property-slider" id="project-audio-treble"
                 min="-20" max="20" step="1" value="${defaultFilters.audio.treble}"
                 data-filter-section="audio" data-filter-key="treble"
                 data-default-value="${baseDefaults.audio.treble}">
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="project-audio-normalize"
                 ${defaultFilters.audio.normalize ? 'checked' : ''}>
          <label class="property-label" for="project-audio-normalize">Normalize</label>
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-pan">Pan</label>
          <input type="range" class="property-slider" id="project-audio-pan"
                 min="-1" max="1" step="0.05" value="${defaultFilters.audio.pan}"
                 data-filter-section="audio" data-filter-key="pan"
                 data-default-value="${baseDefaults.audio.pan}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-pitch">Pitch (semitones)</label>
          <input type="range" class="property-slider" id="project-audio-pitch"
                 min="-12" max="12" step="1" value="${defaultFilters.audio.pitch}"
                 data-filter-section="audio" data-filter-key="pitch"
                 data-default-value="${baseDefaults.audio.pitch}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-fade-in">Fade In (s)</label>
          <input type="number" class="property-input" id="project-audio-fade-in"
                 min="0" step="0.1" value="${defaultFilters.audio.fadeIn}">
        </div>
        <div class="property-group">
          <label class="property-label" for="project-audio-fade-out">Fade Out (s)</label>
          <input type="number" class="property-input" id="project-audio-fade-out"
                 min="0" step="0.1" value="${defaultFilters.audio.fadeOut}">
        </div>
      `;

      const resolutionMode = document.getElementById('project-resolution-mode');
      const resolutionWidth = document.getElementById('project-resolution-width');
      const resolutionHeight = document.getElementById('project-resolution-height');
      const toggleResolutionInputs = () => {
        const isAuto = resolutionMode.value === 'auto';
        resolutionWidth.disabled = isAuto;
        resolutionHeight.disabled = isAuto;
      };
      toggleResolutionInputs();

      resolutionMode.addEventListener('change', () => {
        const isAuto = resolutionMode.value === 'auto';
        if (isAuto) {
          editor.state.dispatch(actions.updateExportSettings({ resolution: 'auto' }));
        } else {
          const width = parseInt(resolutionWidth.value, 10) || widthValue;
          const height = parseInt(resolutionHeight.value, 10) || heightValue;
          editor.state.dispatch(actions.updateExportSettings({ resolution: { width, height } }));
        }
        toggleResolutionInputs();
      });

      const updateResolution = () => {
        if (resolutionMode.value === 'auto') return;
        const width = parseInt(resolutionWidth.value, 10) || widthValue;
        const height = parseInt(resolutionHeight.value, 10) || heightValue;
        editor.state.dispatch(actions.updateExportSettings({ resolution: { width, height } }));
      };

      resolutionWidth.addEventListener('input', updateResolution);
      resolutionHeight.addEventListener('input', updateResolution);

      const presetSelect = document.getElementById('project-export-preset');
      if (presetSelect) {
        presetSelect.addEventListener('change', (e) => {
          const presetId = e.target.value;
          if (!presetId) return;
          const preset = Array.isArray(EXPORT_PRESETS)
            ? EXPORT_PRESETS.find(item => item.id === presetId)
            : null;
          if (!preset) return;
          editor.state.dispatch(actions.updateExportSettings({ ...preset.settings }));
          editor.updateStatus(`Applied preset: ${preset.label}`);
          this.render(editor.state.getState());
        });
      }

      const exportBindings = [
        ['project-fps', value => ({ fps: value })],
        ['project-video-codec', value => ({ videoCodec: value })],
        ['project-video-bitrate', value => ({ videoBitrate: value })],
        ['project-crf', value => ({ crf: value })],
        ['project-preset', value => ({ preset: value })],
        ['project-audio-codec', value => ({ audioCodec: value })],
        ['project-audio-bitrate', value => ({ audioBitrate: value })],
        ['project-sample-rate', value => ({ sampleRate: value })],
        ['project-format', value => ({ format: value })],
      ];

      exportBindings.forEach(([id, buildUpdate]) => {
        const input = document.getElementById(id);
        if (!input) return;
        const handler = (e) => {
          const value = e.target.type === 'number'
            ? parseFloat(e.target.value)
            : e.target.value;
          if (e.target.type === 'number' && Number.isNaN(value)) {
            return;
          }
          editor.state.dispatch(actions.updateExportSettings(buildUpdate(value)));
        };
        if (input.tagName === 'SELECT') {
          input.addEventListener('change', handler);
        } else {
          input.addEventListener('input', handler);
        }
      });

      const deClickInput = document.getElementById('project-declick');
      if (deClickInput) {
        deClickInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateExportSettings({ deClick: e.target.checked }));
        });
      }

      const exportStartInput = document.getElementById('project-export-start');
      const exportEndInput = document.getElementById('project-export-end');
      if (exportStartInput && exportEndInput) {
        const parseRangeValue = (input) => {
          const raw = input.value.trim();
          if (raw === '') return null;
          const seconds = parseFloat(raw);
          if (Number.isNaN(seconds)) return null;
          return Math.max(0, seconds * 1000);
        };

        const updateRange = () => {
          const startMs = parseRangeValue(exportStartInput);
          const endMs = parseRangeValue(exportEndInput);
          editor.state.dispatch(actions.updateExportSettings({
            rangeStart: startMs !== null ? startMs : 0,
            rangeEnd: endMs,
          }));
        };

        exportStartInput.addEventListener('input', updateRange);
        exportEndInput.addEventListener('input', updateRange);
      }

      const defaultVideoBindings = [
        ['project-video-brightness', 'brightness'],
        ['project-video-contrast', 'contrast'],
        ['project-video-saturation', 'saturation'],
        ['project-video-hue', 'hue'],
        ['project-video-gamma', 'gamma'],
        ['project-video-rotate', 'rotate'],
        ['project-video-blur', 'blur'],
        ['project-video-sharpen', 'sharpen'],
        ['project-video-denoise', 'denoise'],
        ['project-video-fade-in', 'fadeIn'],
        ['project-video-fade-out', 'fadeOut'],
      ];

      defaultVideoBindings.forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (!input) return;
        const handler = (e) => {
          const value = parseFloat(e.target.value);
          if (Number.isNaN(value)) return;
          editor.state.dispatch(actions.updateDefaultFilters('video', { [key]: value }));
        };
        if (input.tagName === 'SELECT') {
          input.addEventListener('change', handler);
        } else {
          input.addEventListener('input', handler);
        }
      });

      const flipHInput = document.getElementById('project-video-flip-h');
      if (flipHInput) {
        flipHInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateDefaultFilters('video', { flipH: e.target.checked }));
        });
      }

      const flipVInput = document.getElementById('project-video-flip-v');
      if (flipVInput) {
        flipVInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateDefaultFilters('video', { flipV: e.target.checked }));
        });
      }

      const defaultAudioBindings = [
        ['project-audio-volume', 'volume'],
        ['project-audio-bass', 'bass'],
        ['project-audio-treble', 'treble'],
        ['project-audio-pan', 'pan'],
        ['project-audio-pitch', 'pitch'],
        ['project-audio-fade-in', 'fadeIn'],
        ['project-audio-fade-out', 'fadeOut'],
      ];

      defaultAudioBindings.forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          if (Number.isNaN(value)) return;
          editor.state.dispatch(actions.updateDefaultFilters('audio', { [key]: value }));
        });
      });

      const normalizeInput = document.getElementById('project-audio-normalize');
      if (normalizeInput) {
        normalizeInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateDefaultFilters('audio', { normalize: e.target.checked }));
        });
      }

      decorateSliders();
      return;
    }

    if (selectedIds.length > 1) {
      this.activeTab = 'properties';
      const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));
      if (selectedClips.length === 0) {
        propertiesContent.innerHTML = '<p class="empty-message">Select a clip to edit properties</p>';
        return;
      }

      const mixedTag = (isMixed) => isMixed ? '<span class="property-mixed">Mixed</span>' : '';
      const firstClip = selectedClips[0];
      const allSame = (getValue) => selectedClips.every(clip => getValue(clip) === getValue(firstClip));

      const speedValue = firstClip.speed || 1;
      const volumeValue = editor.resolveClipVolume(firstClip, defaultFilters);
      const colorValue = firstClip.color || '#4a9eff';
      const muteMixed = !allSame(clip => Boolean(clip.muted));
      const visibleMixed = !allSame(clip => clip.visible !== false);
      const reverseMixed = !allSame(clip => Boolean(clip.reversed));
      const speedMixed = !allSame(clip => clip.speed || 1);
      const volumeMixed = !allSame(clip => editor.resolveClipVolume(clip, defaultFilters));
      const colorMixed = !allSame(clip => clip.color || '#4a9eff');

      propertiesContent.innerHTML = `
        <div class="properties-header">Properties</div>
        <p class="multi-select-label">Editing ${selectedClips.length} clips</p>
        <div class="property-group">
          <label class="property-label" for="multi-speed">Speed ${mixedTag(speedMixed)}</label>
          <input type="range" class="property-slider" id="multi-speed"
                 min="0.25" max="4" step="0.25" value="${speedValue}">
          <div style="text-align: center; font-size: 12px; margin-top: 4px;">
            <span id="multi-speed-value">${speedValue}x</span>
          </div>
        </div>
        <div class="property-group">
          <label class="property-label" for="multi-volume">Volume ${mixedTag(volumeMixed)}</label>
          <input type="range" class="property-slider" id="multi-volume"
                 min="0" max="2" step="0.01" value="${volumeValue}">
          <div style="text-align: center; font-size: 12px; margin-top: 4px;">
            <span id="multi-volume-value">${Math.round(volumeValue * 100)}%</span>
          </div>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="multi-muted">
          <label class="property-label" for="multi-muted">Mute Audio ${mixedTag(muteMixed)}</label>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="multi-visible">
          <label class="property-label" for="multi-visible">Visible ${mixedTag(visibleMixed)}</label>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="multi-reversed">
          <label class="property-label" for="multi-reversed">Reversed ${mixedTag(reverseMixed)}</label>
        </div>
        <div class="property-group">
          <label class="property-label" for="multi-color">Color ${mixedTag(colorMixed)}</label>
          <input type="color" class="color-picker" id="multi-color" value="${colorValue}">
        </div>
        <div class="property-group">
          <button class="btn btn-secondary" id="multi-delete" style="width: 100%;">
            Delete ${selectedClips.length} Clips
          </button>
        </div>
      `;

      const muteInput = document.getElementById('multi-muted');
      const visibleInput = document.getElementById('multi-visible');
      const reverseInput = document.getElementById('multi-reversed');

      if (muteInput) {
        muteInput.checked = selectedClips.every(clip => Boolean(clip.muted));
        muteInput.indeterminate = muteMixed;
        muteInput.addEventListener('change', (e) => {
          muteInput.indeterminate = false;
          editor.state.dispatch(actions.updateClips(selectedIds, { muted: e.target.checked }));
        });
      }

      if (visibleInput) {
        visibleInput.checked = selectedClips.every(clip => clip.visible !== false);
        visibleInput.indeterminate = visibleMixed;
        visibleInput.addEventListener('change', (e) => {
          visibleInput.indeterminate = false;
          editor.state.dispatch(actions.updateClips(selectedIds, { visible: e.target.checked }));
        });
      }

      if (reverseInput) {
        reverseInput.checked = selectedClips.every(clip => Boolean(clip.reversed));
        reverseInput.indeterminate = reverseMixed;
        reverseInput.addEventListener('change', (e) => {
          reverseInput.indeterminate = false;
          editor.state.dispatch(actions.updateClips(selectedIds, { reversed: e.target.checked }));
        });
      }

      document.getElementById('multi-speed').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        document.getElementById('multi-speed-value').textContent = `${speed}x`;
        editor.state.dispatch(actions.setClipsSpeed(selectedIds, speed));
      });

      document.getElementById('multi-volume').addEventListener('input', (e) => {
        const volume = parseFloat(e.target.value);
        document.getElementById('multi-volume-value').textContent = `${Math.round(volume * 100)}%`;
        editor.state.dispatch(actions.updateClips(selectedIds, { volume }));
      });

      document.getElementById('multi-color').addEventListener('input', (e) => {
        editor.state.dispatch(actions.updateClips(selectedIds, { color: e.target.value }));
      });

      document.getElementById('multi-delete').addEventListener('click', () => {
        editor.state.dispatch(actions.removeClips(selectedIds));
      });

      decorateSliders();
      return;
    }

    const clip = selectedIds.length > 0 ? state.clips.find(c => c.id === selectedIds[0]) : null;
    if (selectedIds.length > 0 && !clip) return;

    const clipMedia = clip
      ? state.mediaLibrary.find(m => m.id === clip.mediaId) || null
      : selectedMedia;
    const idPrefix = clip
      ? `clip-${clip.id}`
      : `media-${clipMedia ? clipMedia.id : 'unknown'}`;

    const defaultTag = (hasOverride) => hasOverride ? '' : '<span class="property-default">Default</span>';
    const mediaTranscript = clipMedia && clipMedia.transcript ? clipMedia.transcript : null;
    const canLoadTranscript = Boolean(clipMedia);
    const transcriptSummary = mediaTranscript && Array.isArray(mediaTranscript.cues)
      ? `${mediaTranscript.cues.length} cues${mediaTranscript.sourceName ? ` - ${mediaTranscript.sourceName}` : ''}`
      : 'No transcript loaded';
    const hasTranscript = Boolean(mediaTranscript && Array.isArray(mediaTranscript.cues));
    const searchDisabled = hasTranscript ? '' : 'disabled';

    const builderTranscriptKey = hasTranscript
      ? `${mediaTranscript.loadedAt || 0}:${mediaTranscript.cues.length}`
      : 'none';
    const currentMediaId = clipMedia ? clipMedia.id : null;
    if (this.builderState.mediaId !== currentMediaId || this.builderState.transcriptKey !== builderTranscriptKey) {
      this.builderState.segments = [];
      this.builderState.selections = {};
      this.builderState.missingCount = 0;
      this.builderState.mediaId = currentMediaId;
      this.builderState.transcriptKey = builderTranscriptKey;
    }
    const activeTranscriptTab = this.transcriptTab === 'builder' ? 'builder' : 'search';

    if (!clip) {
      this.activeTab = 'transcript';
    }
    const activeTab = clip && this.activeTab === 'transcript' ? 'transcript' : 'properties';
    const propertiesPanelId = `${idPrefix}-panel-properties`;
    const transcriptPanelId = `${idPrefix}-panel-transcript`;

    let propertiesMarkup = '';
    if (clip) {
      const videoOverrides = clip.videoFilters || {};
      const audioOverrides = clip.audioFilters || {};
      const resolvedVideoFilters = editor.resolveVideoFilters(clip, defaultFilters);
      const resolvedAudioFilters = editor.resolveAudioFilters(clip, defaultFilters);
      const clipVolume = editor.resolveClipVolume(clip, defaultFilters);

      propertiesMarkup = `
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-name">Name</label>
        <input type="text" class="property-input" id="${idPrefix}-name" value="${clip.name}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-speed">Speed</label>
        <input type="range" class="property-slider" id="${idPrefix}-speed"
               min="0.25" max="4" step="0.25" value="${clip.speed || 1}">
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">
          <span id="${idPrefix}-speed-value">${clip.speed || 1}x</span>
        </div>
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-volume">Volume ${defaultTag(clip.volume !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-volume"
               min="0" max="2" step="0.01" value="${clipVolume}">
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">
          <span id="${idPrefix}-volume-value">${Math.round(clipVolume * 100)}%</span>
        </div>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-muted"
               ${clip.muted ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-muted">Mute Audio</label>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-visible"
               ${clip.visible !== false ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-visible">Visible</label>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-reversed"
               ${clip.reversed ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-reversed">Reversed</label>
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-color">Color</label>
        <input type="color" class="color-picker" id="${idPrefix}-color" value="${clip.color || '#4a9eff'}">
      </div>

      <h3 class="property-section-title">Video Filters</h3>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-brightness">Brightness ${defaultTag(videoOverrides.brightness !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-brightness"
               min="-1" max="1" step="0.05" value="${resolvedVideoFilters.brightness}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-contrast">Contrast ${defaultTag(videoOverrides.contrast !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-contrast"
               min="0" max="4" step="0.05" value="${resolvedVideoFilters.contrast}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-saturation">Saturation ${defaultTag(videoOverrides.saturation !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-saturation"
               min="0" max="3" step="0.05" value="${resolvedVideoFilters.saturation}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-hue">Hue ${defaultTag(videoOverrides.hue !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-hue"
               min="-180" max="180" step="1" value="${resolvedVideoFilters.hue}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-gamma">Gamma ${defaultTag(videoOverrides.gamma !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-gamma"
               min="0.1" max="10" step="0.1" value="${resolvedVideoFilters.gamma}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-rotate">Rotate ${defaultTag(videoOverrides.rotate !== undefined)}</label>
        <select class="property-input" id="${idPrefix}-rotate">
          <option value="0" ${resolvedVideoFilters.rotate === 0 ? 'selected' : ''}>0°</option>
          <option value="90" ${resolvedVideoFilters.rotate === 90 ? 'selected' : ''}>90°</option>
          <option value="180" ${resolvedVideoFilters.rotate === 180 ? 'selected' : ''}>180°</option>
          <option value="270" ${resolvedVideoFilters.rotate === 270 ? 'selected' : ''}>270°</option>
        </select>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-flip-h"
               ${resolvedVideoFilters.flipH ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-flip-h">Flip Horizontal ${defaultTag(videoOverrides.flipH !== undefined)}</label>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-flip-v"
               ${resolvedVideoFilters.flipV ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-flip-v">Flip Vertical ${defaultTag(videoOverrides.flipV !== undefined)}</label>
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-blur">Blur ${defaultTag(videoOverrides.blur !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-blur"
               min="0" max="10" step="0.5" value="${resolvedVideoFilters.blur}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-sharpen">Sharpen ${defaultTag(videoOverrides.sharpen !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-sharpen"
               min="0" max="10" step="0.5" value="${resolvedVideoFilters.sharpen}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-denoise">Denoise ${defaultTag(videoOverrides.denoise !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-denoise"
               min="0" max="10" step="0.5" value="${resolvedVideoFilters.denoise}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-fade-in">Fade In (s) ${defaultTag(videoOverrides.fadeIn !== undefined)}</label>
        <input type="number" class="property-input" id="${idPrefix}-fade-in"
               min="0" step="0.1" value="${resolvedVideoFilters.fadeIn}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-fade-out">Fade Out (s) ${defaultTag(videoOverrides.fadeOut !== undefined)}</label>
        <input type="number" class="property-input" id="${idPrefix}-fade-out"
               min="0" step="0.1" value="${resolvedVideoFilters.fadeOut}">
      </div>
      <div class="property-group">
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-video-reset">
          Reset Video Overrides
        </button>
      </div>

      <h3 class="property-section-title">Audio Filters</h3>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-bass">Bass (dB) ${defaultTag(audioOverrides.bass !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-bass"
               min="-20" max="20" step="1" value="${resolvedAudioFilters.bass}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-treble">Treble (dB) ${defaultTag(audioOverrides.treble !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-treble"
               min="-20" max="20" step="1" value="${resolvedAudioFilters.treble}">
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-normalize"
               ${resolvedAudioFilters.normalize ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-normalize">Normalize ${defaultTag(audioOverrides.normalize !== undefined)}</label>
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-pan">Pan ${defaultTag(audioOverrides.pan !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-pan"
               min="-1" max="1" step="0.05" value="${resolvedAudioFilters.pan}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-pitch">Pitch (semitones) ${defaultTag(audioOverrides.pitch !== undefined)}</label>
        <input type="range" class="property-slider" id="${idPrefix}-pitch"
               min="-12" max="12" step="1" value="${resolvedAudioFilters.pitch}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-audio-fade-in">Fade In (s) ${defaultTag(audioOverrides.fadeIn !== undefined)}</label>
        <input type="number" class="property-input" id="${idPrefix}-audio-fade-in"
               min="0" step="0.1" value="${resolvedAudioFilters.fadeIn}">
      </div>
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-audio-fade-out">Fade Out (s) ${defaultTag(audioOverrides.fadeOut !== undefined)}</label>
        <input type="number" class="property-input" id="${idPrefix}-audio-fade-out"
               min="0" step="0.1" value="${resolvedAudioFilters.fadeOut}">
      </div>
      <div class="property-group">
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-audio-reset">
          Reset Audio Overrides
        </button>
      </div>

      <div class="property-group">
        <button class="btn btn-secondary" id="${idPrefix}-delete" style="width: 100%;">
          Delete Clip
        </button>
      </div>
    `;
    }

    const builderSentenceValue = escapeHtml(this.builderState.sentence || '');
    const builderHasResults = this.builderState.segments.length > 0;
    const builderMissingCount = this.builderState.missingCount || 0;
    const builderCanBuild = hasTranscript && Boolean(this.builderState.sentence.trim());
    const builderCanCopy = builderHasResults && builderMissingCount === 0;
    const builderCanClear = Boolean(this.builderState.sentence);
    const builderSummaryMarkup = !hasTranscript
      ? '<div class="builder-empty">Load a transcript to build sentences.</div>'
      : (builderHasResults
        ? `<div class="builder-summary">Segments: ${this.builderState.segments.length}${builderMissingCount ? ` (missing ${builderMissingCount})` : ''}</div>`
        : '<div class="builder-empty">Enter a sentence and click Build Options.</div>');
    const builderResultsMarkup = hasTranscript
      ? renderSpeechBuilderResults(this.builderState.segments, this.builderState.selections)
      : '';

    const builderMarkup = `
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-builder-input">Sentence</label>
        <textarea class="property-input builder-input" id="${idPrefix}-builder-input"
                  rows="3" placeholder="Type a sentence...">${builderSentenceValue}</textarea>
      </div>
      <div class="property-group builder-actions">
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-builder-build" ${builderCanBuild ? '' : 'disabled'}>
          Build Options
        </button>
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-builder-clear" ${builderCanClear ? '' : 'disabled'}>
          Clear
        </button>
        <button class="btn btn-primary btn-sm" id="${idPrefix}-builder-copy" ${builderCanCopy ? '' : 'disabled'}>
          Copy to Clipboard
        </button>
      </div>
      <div class="property-group">
        ${builderSummaryMarkup}
      </div>
      <div class="property-group">
        <div class="builder-results" id="${idPrefix}-builder-results">
          ${builderResultsMarkup}
        </div>
      </div>
    `;

    const transcriptMarkup = `
      <h3 class="property-section-title">Transcript</h3>
      <div class="property-group">
        <div class="property-help">${transcriptSummary}</div>
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-transcript-load" ${canLoadTranscript ? '' : 'disabled'}>
          Load Transcript
        </button>
        <button class="btn btn-secondary btn-sm" id="${idPrefix}-transcript-clear" ${hasTranscript ? '' : 'disabled'}>
          Clear Transcript
        </button>
        <input type="file" id="${idPrefix}-transcript-file" accept=".txt" hidden
               aria-label="Transcript file">
      </div>
      <div class="transcript-tabs" role="tablist">
        <button type="button"
                class="transcript-tab${activeTranscriptTab === 'search' ? ' is-active' : ''}"
                data-transcript-tab="search"
                role="tab"
                aria-selected="${activeTranscriptTab === 'search'}"
                aria-controls="${idPrefix}-transcript-panel-search">
          Search
        </button>
        <button type="button"
                class="transcript-tab${activeTranscriptTab === 'builder' ? ' is-active' : ''}"
                data-transcript-tab="builder"
                role="tab"
                aria-selected="${activeTranscriptTab === 'builder'}"
                aria-controls="${idPrefix}-transcript-panel-builder">
          Speech Builder
        </button>
      </div>
      <div class="transcript-tab-panel${activeTranscriptTab === 'search' ? ' is-active' : ''}"
           id="${idPrefix}-transcript-panel-search" data-transcript-panel="search" role="tabpanel">
        <div class="property-group">
          <input type="text" class="property-input" id="${idPrefix}-transcript-search"
                 placeholder="Search words..." ${searchDisabled}>
        </div>
        <div class="property-group">
          <div class="transcript-results" id="${idPrefix}-transcript-results"></div>
          <div class="transcript-pagination" id="${idPrefix}-transcript-pagination" hidden>
            <button type="button" class="btn btn-secondary btn-sm transcript-prev">Prev</button>
            <span class="transcript-page">Page 1 of 1</span>
            <button type="button" class="btn btn-secondary btn-sm transcript-next">Next</button>
          </div>
        </div>
      </div>
      <div class="transcript-tab-panel${activeTranscriptTab === 'builder' ? ' is-active' : ''}"
           id="${idPrefix}-transcript-panel-builder" data-transcript-panel="builder" role="tabpanel">
        ${builderMarkup}
      </div>
    `;

    if (clip) {
      propertiesContent.innerHTML = `
        <div class="properties-tabs" role="tablist">
          <button type="button"
                  class="properties-tab${activeTab === 'properties' ? ' is-active' : ''}"
                  data-tab="properties"
                  role="tab"
                  aria-selected="${activeTab === 'properties'}"
                  aria-controls="${propertiesPanelId}">
            Properties
          </button>
          <button type="button"
                  class="properties-tab${activeTab === 'transcript' ? ' is-active' : ''}"
                  data-tab="transcript"
                  role="tab"
                  aria-selected="${activeTab === 'transcript'}"
                  aria-controls="${transcriptPanelId}">
            Transcript
          </button>
        </div>
        <div class="properties-tab-panel${activeTab === 'properties' ? ' is-active' : ''}"
             id="${propertiesPanelId}" data-tab-panel="properties" role="tabpanel">
          ${propertiesMarkup}
        </div>
        <div class="properties-tab-panel${activeTab === 'transcript' ? ' is-active' : ''}"
             id="${transcriptPanelId}" data-tab-panel="transcript" role="tabpanel">
          ${transcriptMarkup}
        </div>
      `;

      const tabButtons = propertiesContent.querySelectorAll('.properties-tab');
      const tabPanels = propertiesContent.querySelectorAll('.properties-tab-panel');
      const setActiveTab = (tabId) => {
        this.activeTab = tabId;
        tabButtons.forEach((button) => {
          const isActive = button.dataset.tab === tabId;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        tabPanels.forEach((panel) => {
          const isActive = panel.dataset.tabPanel === tabId;
          panel.classList.toggle('is-active', isActive);
        });
      };
      tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
          setActiveTab(button.dataset.tab);
        });
      });
      setActiveTab(activeTab);
    } else {
      const mediaName = clipMedia ? escapeHtml(clipMedia.name) : 'Media';
      propertiesContent.innerHTML = `
        <div class="properties-header">Media: ${mediaName}</div>
        ${transcriptMarkup}
      `;
    }

    const transcriptTabButtons = propertiesContent.querySelectorAll('.transcript-tab');
    const transcriptTabPanels = propertiesContent.querySelectorAll('.transcript-tab-panel');
    if (transcriptTabButtons.length > 0) {
      const setTranscriptTab = (tabId) => {
        this.transcriptTab = tabId === 'builder' ? 'builder' : 'search';
        transcriptTabButtons.forEach((button) => {
          const isActive = button.dataset.transcriptTab === this.transcriptTab;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        transcriptTabPanels.forEach((panel) => {
          const isActive = panel.dataset.transcriptPanel === this.transcriptTab;
          panel.classList.toggle('is-active', isActive);
        });
      };
      transcriptTabButtons.forEach((button) => {
        button.addEventListener('click', () => {
          setTranscriptTab(button.dataset.transcriptTab);
        });
      });
      setTranscriptTab(this.transcriptTab);
    }

    if (clip) {
      // Add event listeners for property changes
      document.getElementById(`${idPrefix}-name`).addEventListener('input', (e) => {
        editor.state.dispatch(actions.updateClip(clip.id, { name: e.target.value }));
      });

      document.getElementById(`${idPrefix}-speed`).addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        document.getElementById(`${idPrefix}-speed-value`).textContent = `${speed}x`;
        editor.state.dispatch(actions.setClipSpeed(clip.id, speed));
      });

      document.getElementById(`${idPrefix}-volume`).addEventListener('input', (e) => {
        const volume = parseFloat(e.target.value);
        document.getElementById(`${idPrefix}-volume-value`).textContent = `${Math.round(volume * 100)}%`;
        editor.state.dispatch(actions.updateClip(clip.id, { volume }));
      });

      document.getElementById(`${idPrefix}-muted`).addEventListener('change', (e) => {
        editor.state.dispatch(actions.updateClip(clip.id, { muted: e.target.checked }));
      });

      document.getElementById(`${idPrefix}-visible`).addEventListener('change', (e) => {
        editor.state.dispatch(actions.updateClip(clip.id, { visible: e.target.checked }));
      });

      document.getElementById(`${idPrefix}-reversed`).addEventListener('change', () => {
        editor.state.dispatch(actions.reverseClip(clip.id));
      });

      document.getElementById(`${idPrefix}-color`).addEventListener('input', (e) => {
        editor.state.dispatch(actions.updateClip(clip.id, { color: e.target.value }));
      });

      const videoBindings = [
        [`${idPrefix}-brightness`, 'brightness'],
        [`${idPrefix}-contrast`, 'contrast'],
        [`${idPrefix}-saturation`, 'saturation'],
        [`${idPrefix}-hue`, 'hue'],
        [`${idPrefix}-gamma`, 'gamma'],
        [`${idPrefix}-blur`, 'blur'],
        [`${idPrefix}-sharpen`, 'sharpen'],
        [`${idPrefix}-denoise`, 'denoise'],
        [`${idPrefix}-fade-in`, 'fadeIn'],
        [`${idPrefix}-fade-out`, 'fadeOut'],
      ];

      videoBindings.forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          if (Number.isNaN(value)) return;
          editor.state.dispatch(actions.updateClipVideoFilters(clip.id, { [key]: value }));
        });
      });

      const rotateInput = document.getElementById(`${idPrefix}-rotate`);
      if (rotateInput) {
        rotateInput.addEventListener('change', (e) => {
          const value = parseInt(e.target.value, 10);
          if (Number.isNaN(value)) return;
          editor.state.dispatch(actions.updateClipVideoFilters(clip.id, { rotate: value }));
        });
      }

      const flipHInput = document.getElementById(`${idPrefix}-flip-h`);
      if (flipHInput) {
        flipHInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateClipVideoFilters(clip.id, { flipH: e.target.checked }));
        });
      }

      const flipVInput = document.getElementById(`${idPrefix}-flip-v`);
      if (flipVInput) {
        flipVInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateClipVideoFilters(clip.id, { flipV: e.target.checked }));
        });
      }

      const videoResetBtn = document.getElementById(`${idPrefix}-video-reset`);
      if (videoResetBtn) {
        videoResetBtn.addEventListener('click', () => {
          editor.state.dispatch(actions.clearClipVideoFilters(clip.id));
          this.render(editor.state.getState());
        });
      }

      const audioBindings = [
        [`${idPrefix}-bass`, 'bass'],
        [`${idPrefix}-treble`, 'treble'],
        [`${idPrefix}-pan`, 'pan'],
        [`${idPrefix}-pitch`, 'pitch'],
        [`${idPrefix}-audio-fade-in`, 'fadeIn'],
        [`${idPrefix}-audio-fade-out`, 'fadeOut'],
      ];

      audioBindings.forEach(([id, key]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          if (Number.isNaN(value)) return;
          editor.state.dispatch(actions.updateClipAudioFilters(clip.id, { [key]: value }));
        });
      });

      const normalizeInput = document.getElementById(`${idPrefix}-normalize`);
      if (normalizeInput) {
        normalizeInput.addEventListener('change', (e) => {
          editor.state.dispatch(actions.updateClipAudioFilters(clip.id, { normalize: e.target.checked }));
        });
      }

      const audioResetBtn = document.getElementById(`${idPrefix}-audio-reset`);
      if (audioResetBtn) {
        audioResetBtn.addEventListener('click', () => {
          editor.state.dispatch(actions.clearClipAudioFilters(clip.id));
          editor.state.dispatch(actions.updateClip(clip.id, { volume: undefined }));
          this.render(editor.state.getState());
        });
      }
    }

    const transcriptLoadBtn = document.getElementById(`${idPrefix}-transcript-load`);
    const transcriptClearBtn = document.getElementById(`${idPrefix}-transcript-clear`);
    const transcriptFileInput = document.getElementById(`${idPrefix}-transcript-file`);
    if (transcriptLoadBtn && transcriptFileInput && clipMedia) {
      transcriptLoadBtn.addEventListener('click', () => {
        transcriptFileInput.click();
      });
      transcriptFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (!file) return;
        try {
          const text = await file.text();
          const cues = parseWhisperTranscript(text);
          if (!cues.length) {
            editor.updateStatus('Transcript not recognized');
            return;
          }
          editor.state.dispatch(actions.updateMedia(clipMedia.id, {
            transcript: {
              format: 'whisper',
              cues,
              sourceName: file.name,
              loadedAt: Date.now(),
            },
          }));
          editor.updateStatus(`Loaded transcript (${cues.length} cues)`);
          this.render(editor.state.getState());
        } catch (error) {
          console.error('Failed to load transcript:', error);
          editor.updateStatus('Failed to load transcript');
        } finally {
          e.target.value = '';
        }
      });
    }

    if (transcriptClearBtn && clipMedia) {
      transcriptClearBtn.addEventListener('click', () => {
        editor.state.dispatch(actions.updateMedia(clipMedia.id, { transcript: undefined }));
        this.render(editor.state.getState());
      });
    }

    const transcriptSearchInput = document.getElementById(`${idPrefix}-transcript-search`);
    const transcriptResultsEl = document.getElementById(`${idPrefix}-transcript-results`);
    const transcriptPagination = document.getElementById(`${idPrefix}-transcript-pagination`);
    let transcriptPage = 0;
    const renderTranscript = () => {
      const result = renderTranscriptResults(
        clip,
        mediaTranscript,
        transcriptSearchInput ? transcriptSearchInput.value : '',
        transcriptResultsEl,
        transcriptPagination,
        transcriptPage
      );
      transcriptPage = result.page;
    };
    const resolveClipForSourceTime = (sourceTime) => {
      if (!clipMedia || !Number.isFinite(sourceTime)) return null;
      const currentState = editor.state.getState();
      let baseClip = null;
      if (clip) {
        baseClip = currentState.clips.find(c => c.id === clip.id) || clip;
        const range = getClipSourceRange(baseClip);
        if (sourceTime >= range.start && sourceTime <= range.end) {
          return { clip: baseClip, range };
        }
      }
      const matchingClip = currentState.clips.find((candidate) => {
        if (candidate.mediaId !== clipMedia.id) return false;
        const candidateRange = getClipSourceRange(candidate);
        return sourceTime >= candidateRange.start && sourceTime <= candidateRange.end;
      });
      if (matchingClip) {
        return { clip: matchingClip, range: getClipSourceRange(matchingClip) };
      }
      if (baseClip) {
        return { clip: baseClip, range: getClipSourceRange(baseClip) };
      }
      return null;
    };
    const seekToSourceTime = (sourceTime) => {
      const resolved = resolveClipForSourceTime(sourceTime);
      if (!resolved) return;
      const time = mapSourceTimeToClipTime(resolved.clip, sourceTime, resolved.range);
      editor.timeline.scrollToTime(time);
      editor.state.dispatch(actions.setPlayhead(time), false);
    };
    if (transcriptSearchInput) {
      transcriptSearchInput.addEventListener('input', () => {
        transcriptPage = 0;
        renderTranscript();
      });
    }
    if (transcriptResultsEl) {
      transcriptResultsEl.addEventListener('click', (e) => {
        const button = e.target.closest('.transcript-result');
        if (!button) return;
        const storedSourceTime = Number(button.dataset.sourceTime);
        if (!Number.isFinite(storedSourceTime)) return;
        seekToSourceTime(storedSourceTime);
      });
    }
    if (transcriptPagination) {
      transcriptPagination.addEventListener('click', (e) => {
        if (e.target.closest('.transcript-prev')) {
          transcriptPage -= 1;
          renderTranscript();
          return;
        }
        if (e.target.closest('.transcript-next')) {
          transcriptPage += 1;
          renderTranscript();
        }
      });
    }
    renderTranscript();

    const builderInput = document.getElementById(`${idPrefix}-builder-input`);
    const builderBuildBtn = document.getElementById(`${idPrefix}-builder-build`);
    const builderClearBtn = document.getElementById(`${idPrefix}-builder-clear`);
    const builderCopyBtn = document.getElementById(`${idPrefix}-builder-copy`);
    const builderResultsEl = document.getElementById(`${idPrefix}-builder-results`);
    if (builderInput) {
      builderInput.addEventListener('input', (e) => {
        this.builderState.sentence = e.target.value;
        if (builderBuildBtn) {
          builderBuildBtn.disabled = !hasTranscript || !this.builderState.sentence.trim();
        }
        if (builderCopyBtn) {
          builderCopyBtn.disabled = true;
        }
        if (builderClearBtn) {
          builderClearBtn.disabled = !this.builderState.sentence;
        }
      });
    }
    if (builderBuildBtn) {
      builderBuildBtn.addEventListener('click', () => {
        if (!hasTranscript) return;
        const result = buildSpeechSegments(this.builderState.sentence, mediaTranscript);
        this.builderState.segments = result.segments;
        this.builderState.missingCount = result.missingCount;
        this.builderState.selections = {};
        result.segments.forEach((segment, index) => {
          if (segment.options && segment.options.length > 0) {
            this.builderState.selections[index] = 0;
          }
        });
        this.render(editor.state.getState());
      });
    }
    if (builderClearBtn) {
      builderClearBtn.addEventListener('click', () => {
        this.builderState.sentence = '';
        this.builderState.segments = [];
        this.builderState.selections = {};
        this.builderState.missingCount = 0;
        this.render(editor.state.getState());
      });
    }
    if (builderResultsEl) {
      builderResultsEl.addEventListener('click', (e) => {
        const optionButton = e.target.closest('.builder-option');
        if (!optionButton) return;
        const segmentIndex = parseInt(optionButton.dataset.segmentIndex, 10);
        const optionIndex = parseInt(optionButton.dataset.optionIndex, 10);
        if (!Number.isFinite(segmentIndex) || !Number.isFinite(optionIndex)) return;
        this.builderState.selections[segmentIndex] = optionIndex;
        const segmentButtons = builderResultsEl.querySelectorAll(
          `.builder-option[data-segment-index="${segmentIndex}"]`
        );
        segmentButtons.forEach((button) => {
          button.classList.toggle('is-selected', button === optionButton);
          button.setAttribute('aria-pressed', button === optionButton ? 'true' : 'false');
        });

        const segment = this.builderState.segments[segmentIndex];
        if (!segment || !Array.isArray(segment.options)) return;
        const option = segment.options[optionIndex];
        if (!option || !Number.isFinite(option.start)) return;
        seekToSourceTime(option.start);
      });
    }
    if (builderCopyBtn) {
      builderCopyBtn.addEventListener('click', () => {
        if (!builderHasResults || builderMissingCount > 0) return;
        const mediaId = clip ? clip.mediaId : (clipMedia ? clipMedia.id : null);
        if (!mediaId) return;
        const trackId = clip ? clip.trackId : 0;
        const baseName = clip ? clip.name : (clipMedia ? clipMedia.name : 'Media');
        const baseColor = clip ? clip.color : '#4a9eff';
        let insertTime = 0;
        let inserted = 0;
        const clipsToCopy = [];
        this.builderState.segments.forEach((segment, index) => {
          const options = segment.options || [];
          if (options.length === 0) return;
          const selectedIndex = this.builderState.selections[index] ?? 0;
          const option = options[selectedIndex] || options[0];
          const duration = Math.max(0, option.end - option.start);
          if (duration <= 0) return;
          clipsToCopy.push({
            name: segment.label || baseName,
            mediaId,
            trackId,
            start: insertTime,
            duration,
            trimStart: option.start,
            color: baseColor,
          });
          insertTime += duration;
          inserted += 1;
        });
        if (inserted > 0) {
          window._ytpClipboard = { clips: clipsToCopy };
          editor.updateStatus(`Copied ${inserted} builder clip${inserted === 1 ? '' : 's'} to clipboard`);
        }
      });
    }

    if (clip) {
      document.getElementById(`${idPrefix}-delete`).addEventListener('click', () => {
        editor.state.dispatch(actions.removeClip(clip.id));
      });

      decorateSliders();
    }
  }
}
