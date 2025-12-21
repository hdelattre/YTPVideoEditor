/**
 * @fileoverview Main application bootstrap
 * Initializes the YTP Video Editor
 */

import { StateManager } from './core/state.js';
import { KeyboardManager } from './utils/keyboard.js';
import { Timeline } from './ui/Timeline.js';
import * as actions from './core/actions.js';
import { formatTime } from './utils/time.js';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  EXPORT_PRESETS,
  createDefaultExportSettings,
  createDefaultFilters,
} from './core/constants.js';

/**
 * Main application class
 */
class YTPEditor {
  constructor() {
    // Initialize state
    this.state = new StateManager();
    this.wasPlaying = false;
    this.isPlaybackLoopActive = false;
    this.isPlayheadUpdateFromPlayback = false;
    this.lastPlayhead = 0;
    this.mediaInfo = new Map();
    this.lastPreviewVideoClipId = null;
    this.lastPreviewAudioClipId = null;
    this.lastReverseSeekTime = 0;
    this.previewFrameBuffer = document.createElement('canvas');
    this.previewFrameCtx = this.previewFrameBuffer.getContext('2d');
    this.hasPreviewFrame = false;
    this.audioContext = null;
    this.decodedAudio = new Map();
    this.reverseAudioNode = null;
    this.reverseAudioGain = null;
    this.reverseAudioClipId = null;
    this.pendingReassociateMediaId = null;
    this.hasExternalSeek = false;
    this.lastPropertiesClipId = null;
    this.lastPropertiesSignature = null;

    // Initialize keyboard shortcuts
    this.keyboard = new KeyboardManager(this.state);

    // Initialize UI components
    this.initializeUI();

    // Setup event listeners
    this.setupEventListeners();

    // Subscribe to state changes
    this.state.subscribe((state) => this.onStateChange(state));

    console.log('YTP Editor initialized');
    this.updateStatus('Ready - Upload media to get started');
    this.loadProject();
  }

  /**
   * Initialize UI components
   */
  initializeUI() {
    // Initialize timeline
    const timelineContainer = document.getElementById('timelineContainer');
    this.timeline = new Timeline(timelineContainer, this.state);

    // Initialize preview canvas
    this.previewCanvas = document.getElementById('previewCanvas');
    this.previewCtx = this.previewCanvas.getContext('2d');
    this.resizePreview();

    // Create hidden video elements for playback
    this.videoElements = new Map();
    this.audioElements = new Map();
    this.masterVolume = 1.0;

    // Export command UI
    this.exportCommandBar = document.getElementById('exportCommandBar');
    this.exportCommandInput = document.getElementById('exportCommandInput');
    this.exportCommandCopyBtn = document.getElementById('exportCommandCopyBtn');
    this.exportCommandCloseBtn = document.getElementById('exportCommandCloseBtn');
    this.projectModal = document.getElementById('projectModal');
    this.projectModalMessage = document.getElementById('projectModalMessage');
    this.projectModalCloseBtn = document.getElementById('projectModalCloseBtn');
    this.projectNewBtn = document.getElementById('projectNewBtn');
    this.projectLoadBtn = document.getElementById('projectLoadBtn');
    this.projectImportBtn = document.getElementById('projectImportBtn');
    this.projectImportInput = document.getElementById('projectImportInput');
    this.projectCancelBtn = document.getElementById('projectCancelBtn');
    this.saveModal = document.getElementById('saveModal');
    this.saveModalMessage = document.getElementById('saveModalMessage');
    this.saveModalCloseBtn = document.getElementById('saveModalCloseBtn');
    this.saveLocalBtn = document.getElementById('saveLocalBtn');
    this.saveExportBtn = document.getElementById('saveExportBtn');
    this.saveCancelBtn = document.getElementById('saveCancelBtn');
    this.reassociateInput = document.createElement('input');
    this.reassociateInput.type = 'file';
    this.reassociateInput.accept = 'video/*,audio/*';
    this.reassociateInput.hidden = true;
    document.body.appendChild(this.reassociateInput);

    this.setupRangeVisuals(document);

    // Start preview render loop
    this.renderPreview();
  }

  /**
   * Setup event listeners for UI controls
   */
  setupEventListeners() {
    // File upload
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    // Playback controls
    document.getElementById('playBtn').addEventListener('click', () => this.play());
    document.getElementById('pauseBtn').addEventListener('click', () => this.pause());

    // Toolbar controls
    document.getElementById('undoBtn').addEventListener('click', () => this.state.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.state.redo());
    document.getElementById('newProjectBtn').addEventListener('click', () => this.showProjectModal());
    document.getElementById('saveBtn').addEventListener('click', () => this.showSaveModal());
    document.getElementById('exportBtn').addEventListener('click', () => this.exportVideo());
    document.getElementById('addTrackBtn').addEventListener('click', () => this.addTrack());

    // Zoom controls
    document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
    document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());

    if (this.exportCommandCopyBtn) {
      this.exportCommandCopyBtn.addEventListener('click', () => {
        if (this.exportCommandInput && this.exportCommandInput.value) {
          this.copyExportCommand(this.exportCommandInput.value);
        }
      });
    }

    if (this.exportCommandCloseBtn) {
      this.exportCommandCloseBtn.addEventListener('click', () => {
        this.hideExportCommand();
      });
    }

    if (this.projectModalCloseBtn) {
      this.projectModalCloseBtn.addEventListener('click', () => this.hideProjectModal());
    }

    if (this.projectNewBtn) {
      this.projectNewBtn.addEventListener('click', () => {
        this.newProject();
        this.hideProjectModal();
      });
    }

    if (this.projectLoadBtn) {
      this.projectLoadBtn.addEventListener('click', () => {
        this.loadProject();
        this.hideProjectModal();
      });
    }

    if (this.projectImportBtn) {
      this.projectImportBtn.addEventListener('click', () => {
        if (this.projectImportInput) {
          this.projectImportInput.value = '';
          this.projectImportInput.click();
        }
      });
    }

    if (this.projectCancelBtn) {
      this.projectCancelBtn.addEventListener('click', () => this.hideProjectModal());
    }

    if (this.projectModal) {
      this.projectModal.addEventListener('click', (e) => {
        if (e.target === this.projectModal) {
          this.hideProjectModal();
        }
      });
    }

    if (this.projectImportInput) {
      this.projectImportInput.addEventListener('change', (e) => this.handleProjectImport(e));
    }

    if (this.saveModalCloseBtn) {
      this.saveModalCloseBtn.addEventListener('click', () => this.hideSaveModal());
    }

    if (this.saveLocalBtn) {
      this.saveLocalBtn.addEventListener('click', () => {
        this.saveProject();
        this.hideSaveModal();
      });
    }

    if (this.saveExportBtn) {
      this.saveExportBtn.addEventListener('click', () => {
        this.exportProject();
        this.hideSaveModal();
      });
    }

    if (this.saveCancelBtn) {
      this.saveCancelBtn.addEventListener('click', () => this.hideSaveModal());
    }

    if (this.saveModal) {
      this.saveModal.addEventListener('click', (e) => {
        if (e.target === this.saveModal) {
          this.hideSaveModal();
        }
      });
    }

    if (this.reassociateInput) {
      this.reassociateInput.addEventListener('change', (e) => this.handleReassociateFile(e));
    }

    // Volume control
    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.addEventListener('input', (e) => {
      this.masterVolume = e.target.value / 100;
    });

    // Window resize
    window.addEventListener('resize', () => this.resizePreview());

    // Help modal
    document.addEventListener('keydown', (e) => {
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        this.showHelp();
      }
    });
  }

  /**
   * Handle file upload
   * @param {Event} e
   */
  async handleFileUpload(e) {
    const files = Array.from(e.target.files);

    for (const file of files) {
      this.updateStatus(`Loading ${file.name}...`);

      // Get video metadata
      const metadata = await this.getVideoMetadata(file);

      if (!this.mediaFiles) this.mediaFiles = new Map();
      const isAudioOnly = file.type.startsWith('audio/');
      const isVideoType = file.type.startsWith('video/');

      const missingMatch = this.findMissingMediaMatch(file, metadata);
      if (missingMatch) {
        const mediaId = missingMatch.id;
        this.mediaFiles.set(mediaId, file);
        this.mediaInfo.set(mediaId, {
          hasAudio: metadata.hasAudio,
          hasVideo: metadata.hasVideo,
          isAudioOnly,
          isVideoType,
        });
        this.state.dispatch(actions.updateMedia(mediaId, {
          name: file.name,
          type: file.type,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        }));
        this.updateStatus(`Relinked ${file.name}`);
      } else {
        // Add to media library
        const mediaId = crypto.randomUUID();
        // Ensure render sees the file as present on the first state update.
        this.mediaFiles.set(mediaId, file);
        this.mediaInfo.set(mediaId, {
          hasAudio: metadata.hasAudio,
          hasVideo: metadata.hasVideo,
          isAudioOnly,
          isVideoType,
        });
        this.state.dispatch(actions.addMedia({
          id: mediaId,
          hash: mediaId, // For now, use ID as hash
          name: file.name,
          type: file.type,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          uploadedAt: Date.now(),
        }));

        this.updateStatus(`Loaded ${file.name}`);
      }
    }

    // Clear file input
    e.target.value = '';
  }

  /**
   * Find a missing media entry that matches an uploaded file
   * @param {File} file
   * @param {{duration: number, width: number, height: number}} metadata
   * @returns {import('./core/types.js').Media|null}
   */
  findMissingMediaMatch(file, metadata) {
    const state = this.state.getState();
    if (!state.mediaLibrary || state.mediaLibrary.length === 0) return null;

    let best = null;
    let bestScore = -1;

    state.mediaLibrary.forEach((media) => {
      if (this.mediaFiles && this.mediaFiles.has(media.id)) return;
      if (media.name !== file.name) return;

      const sizeMatch = media.size === file.size;
      const durationMatch = media.duration && metadata.duration
        ? Math.abs(media.duration - metadata.duration) < 100
        : false;
      if (!sizeMatch && !durationMatch) return;

      let score = 3;
      if (sizeMatch) score += 2;
      if (durationMatch) score += 1;
      if (media.type && media.type === file.type) score += 1;
      if (media.width && metadata.width && media.width === metadata.width) score += 1;
      if (media.height && metadata.height && media.height === metadata.height) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = media;
      }
    });

    return best;
  }

  /**
   * Get video metadata
   * @param {File} file
   * @returns {Promise<{duration: number, width: number, height: number, hasAudio: boolean|null, hasVideo: boolean}>}
   */
  async getVideoMetadata(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const isAudioOnly = file.type.startsWith('audio/');
      const isVideoType = file.type.startsWith('video/');

      video.onloadedmetadata = () => {
        let hasAudio = null;
        if (isAudioOnly) {
          hasAudio = true;
        } else if (typeof video.mozHasAudio === 'boolean') {
          hasAudio = video.mozHasAudio;
        } else if (video.audioTracks && video.audioTracks.length > 0) {
          hasAudio = true;
        }

        const hasVideo = isVideoType || (!isAudioOnly && video.videoWidth > 0 && video.videoHeight > 0);

        resolve({
          duration: video.duration * 1000, // Convert to ms
          width: video.videoWidth,
          height: video.videoHeight,
          hasAudio,
          hasVideo,
        });
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => {
        // If video fails to load, return defaults
        resolve({
          duration: 0,
          width: 1920,
          height: 1080,
          hasAudio: isAudioOnly ? true : null,
          hasVideo: isVideoType || !isAudioOnly,
        });
        URL.revokeObjectURL(video.src);
      };

      video.src = URL.createObjectURL(file);
    });
  }

  /**
   * Handle state changes
   * @param {import('./core/types.js').EditorState} state
   */
  onStateChange(state) {
    // Sync playback loop with state changes (e.g., keyboard toggle)
    const wasPlaying = this.wasPlaying === true;
    const playheadChanged = state.playhead !== this.lastPlayhead;
    const isPlaybackTick = this.isPlayheadUpdateFromPlayback === true;
    if (state.isPlaying && !wasPlaying) {
      this.startPlaybackFromState(state);
    } else if (!state.isPlaying && wasPlaying) {
      this.isPlaybackLoopActive = false;
    }
    if (state.isPlaying && playheadChanged && !isPlaybackTick) {
      // User or UI seek while playing; realign playback loop.
      this.hasExternalSeek = true;
      this.startPlaybackFromState(state);
    }
    this.wasPlaying = state.isPlaying;
    this.lastPlayhead = state.playhead;
    this.isPlayheadUpdateFromPlayback = false;

    // Update time display
    this.updateTimeDisplay(state.playhead);

    // Update undo/redo buttons
    document.getElementById('undoBtn').disabled = !this.state.canUndo();
    document.getElementById('redoBtn').disabled = !this.state.canRedo();

    // Update zoom display
    const zoomPercent = Math.round(Math.pow(2, state.zoom) * 100);
    document.getElementById('zoomLevel').textContent = `${zoomPercent}%`;

    // Update play/pause buttons
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    if (state.isPlaying) {
      playBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
    } else {
      playBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
    }

    // Enable export if there are clips
    document.getElementById('exportBtn').disabled = state.clips.length === 0;

    // Update media library UI
    this.renderMediaLibrary(state);

    // Update properties panel only when selected clip changes or when not actively editing
    const { signature: selectedSignature } = this.getSelectedClipSignature(state);
    const propertiesContent = document.getElementById('propertiesContent');
    const isEditing = propertiesContent && propertiesContent.contains(document.activeElement);
    const clipChanged = state.selectedClipId !== this.lastPropertiesClipId;
    const shouldRenderProperties = clipChanged || (!isEditing && selectedSignature !== this.lastPropertiesSignature);

    if (shouldRenderProperties) {
      this.renderPropertiesPanel(state);
      this.lastPropertiesClipId = state.selectedClipId;
      this.lastPropertiesSignature = selectedSignature;
    }
  }

  /**
   * Build a stable signature for selected clip properties
   * @param {import('./core/types.js').EditorState} state
   * @returns {{clip: import('./core/types.js').Clip|null, signature: string|null}}
   */
  getSelectedClipSignature(state) {
    const defaultFilters = this.getDefaultFilters(state);
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);

    if (selectedIds.length === 0) {
      const exportSettings = this.getExportSettings(state);
      const signature = [
        JSON.stringify(exportSettings),
        JSON.stringify(defaultFilters),
      ].join('|');
      return { clip: null, signature };
    }

    const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));
    if (selectedClips.length === 0) {
      return { clip: null, signature: null };
    }

    if (selectedClips.length === 1) {
      const clip = selectedClips[0];
      const media = state.mediaLibrary.find(m => m.id === clip.mediaId);
      const transcript = media && media.transcript ? media.transcript : null;
      const transcriptSignature = transcript
        ? `${transcript.loadedAt || 0}:${transcript.cues ? transcript.cues.length : 0}`
        : '';
      const signature = [
        clip.id,
        clip.name,
        clip.speed,
        clip.volume,
        clip.muted,
        clip.reversed,
        clip.visible !== false,
        clip.color,
        JSON.stringify(clip.videoFilters || {}),
        JSON.stringify(clip.audioFilters || {}),
        transcriptSignature,
        JSON.stringify(defaultFilters),
      ].join('|');
      return { clip, signature };
    }

    const signature = selectedClips
      .map(clip => [
        clip.id,
        clip.name,
        clip.speed,
        clip.volume,
        clip.muted,
        clip.reversed,
        clip.visible !== false,
        clip.color,
        JSON.stringify(clip.videoFilters || {}),
        JSON.stringify(clip.audioFilters || {}),
        JSON.stringify(defaultFilters),
      ].join(':'))
      .join('|');

    return { clip: null, signature };
  }

  /**
   * Get export settings with defaults
   * @param {import('./core/types.js').EditorState} state
   * @returns {import('./core/types.js').ExportSettings}
   */
  getExportSettings(state) {
    const defaults = createDefaultExportSettings();
    return {
      ...defaults,
      ...(state.exportSettings || {}),
    };
  }

  /**
   * Find a matching export preset id for current settings
   * @param {import('./core/types.js').ExportSettings} exportSettings
   * @returns {string}
   */
  getExportPresetMatch(exportSettings) {
    if (!Array.isArray(EXPORT_PRESETS)) return '';
    for (const preset of EXPORT_PRESETS) {
      if (this.exportSettingsMatchPreset(exportSettings, preset.settings)) {
        return preset.id;
      }
    }
    return '';
  }

  /**
   * Check if export settings match a preset
   * @param {import('./core/types.js').ExportSettings} exportSettings
   * @param {object} presetSettings
   * @returns {boolean}
   */
  exportSettingsMatchPreset(exportSettings, presetSettings) {
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
   * Get global default filters with defaults applied
   * @param {import('./core/types.js').EditorState} state
   * @returns {import('./core/types.js').DefaultFilters}
   */
  getDefaultFilters(state) {
    const defaults = createDefaultFilters();
    const current = state.defaultFilters || {};
    return {
      video: { ...defaults.video, ...(current.video || {}) },
      audio: { ...defaults.audio, ...(current.audio || {}) },
    };
  }

  /**
   * Resolve per-clip video filters against defaults
   * @param {import('./core/types.js').Clip} clip
   * @param {import('./core/types.js').DefaultFilters} defaults
   * @returns {import('./core/types.js').ClipVideoFilters}
   */
  resolveVideoFilters(clip, defaults) {
    return {
      ...defaults.video,
      ...(clip.videoFilters || {}),
    };
  }

  /**
   * Resolve per-clip audio filters against defaults
   * @param {import('./core/types.js').Clip} clip
   * @param {import('./core/types.js').DefaultFilters} defaults
   * @returns {import('./core/types.js').ClipAudioFilters}
   */
  resolveAudioFilters(clip, defaults) {
    return {
      ...defaults.audio,
      ...(clip.audioFilters || {}),
    };
  }

  /**
   * Resolve clip volume using defaults
   * @param {import('./core/types.js').Clip} clip
   * @param {import('./core/types.js').DefaultFilters} defaults
   * @returns {number}
   */
  resolveClipVolume(clip, defaults) {
    if (clip.volume !== undefined) {
      return clip.volume;
    }
    if (clip.audioFilters && clip.audioFilters.volume !== undefined) {
      return clip.audioFilters.volume;
    }
    return defaults.audio.volume !== undefined ? defaults.audio.volume : 1;
  }

  /**
   * Render media library
   * @param {import('./core/types.js').EditorState} state
   */
  renderMediaLibrary(state) {
    const mediaList = document.getElementById('mediaList');
    mediaList.innerHTML = '';

    if (state.mediaLibrary.length === 0) {
      mediaList.innerHTML = '<p class="empty-message">No media files yet</p>';
      return;
    }

    state.mediaLibrary.forEach(media => {
      const isMissing = !this.mediaFiles || !this.mediaFiles.has(media.id);
      const item = document.createElement('div');
      item.className = `media-item${isMissing ? ' missing' : ''}`;
      item.draggable = !isMissing;
      if (isMissing) {
        item.title = 'File missing - click to relink';
      }

      const header = document.createElement('div');
      header.className = 'media-item-header';

      const name = document.createElement('div');
      name.className = 'media-item-name';
      name.textContent = media.name;
      header.appendChild(name);

      if (isMissing) {
        const badge = document.createElement('span');
        badge.className = 'media-item-missing';
        badge.textContent = 'Missing';
        header.appendChild(badge);
      }

      const info = document.createElement('div');
      info.className = 'media-item-info';
      const durationSec = Math.round(media.duration / 1000);
      const sizeMB = (media.size / 1024 / 1024).toFixed(2);
      info.textContent = `${durationSec}s · ${media.width}x${media.height} · ${sizeMB}MB`;

      item.appendChild(header);
      item.appendChild(info);

      // Double-click to add to timeline
      if (!isMissing) {
        item.addEventListener('dblclick', () => {
          this.addMediaToTimeline(media);
        });
      }

      if (isMissing) {
        item.addEventListener('click', () => {
          this.requestMediaReassociate(media);
        });
      }

      // Drag and drop support
      if (!isMissing) {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('mediaId', media.id);
          e.dataTransfer.effectAllowed = 'copy';
        });
      }

      mediaList.appendChild(item);
    });
  }

  /**
   * Prompt user to relink missing media
   * @param {import('./core/types.js').Media} media
   */
  requestMediaReassociate(media) {
    if (!this.reassociateInput) return;
    this.pendingReassociateMediaId = media.id;
    this.reassociateInput.value = '';
    this.reassociateInput.click();
  }

  /**
   * Handle relinked media file selection
   * @param {Event} e
   */
  async handleReassociateFile(e) {
    const file = e.target.files && e.target.files[0];
    const mediaId = this.pendingReassociateMediaId;
    this.pendingReassociateMediaId = null;

    if (!file || !mediaId) {
      return;
    }

    this.updateStatus(`Relinking ${file.name}...`);
    const metadata = await this.getVideoMetadata(file);

    if (!this.mediaFiles) this.mediaFiles = new Map();
    this.mediaFiles.set(mediaId, file);

    const isAudioOnly = file.type.startsWith('audio/');
    const isVideoType = file.type.startsWith('video/');
    this.mediaInfo.set(mediaId, {
      hasAudio: metadata.hasAudio,
      hasVideo: metadata.hasVideo,
      isAudioOnly,
      isVideoType,
    });

    this.state.dispatch(actions.updateMedia(mediaId, {
      name: file.name,
      type: file.type,
      size: file.size,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
    }));

    this.updateStatus(`Relinked ${file.name}`);
    e.target.value = '';
  }

  /**
   * Add media to timeline
   * @param {import('./core/types.js').Media} media
   */
  addMediaToTimeline(media) {
    const state = this.state.getState();

    // Add clip at playhead position on first track
    this.state.dispatch(actions.addClip({
      name: media.name,
      mediaId: media.id,
      trackId: 0,
      start: state.playhead,
      duration: media.duration,
      color: '#4a9eff',
    }));

    this.updateStatus(`Added ${media.name} to timeline`);
  }

  /**
   * Render properties panel for selected clip
   * @param {import('./core/types.js').EditorState} state
   */
  renderPropertiesPanel(state) {
    const propertiesContent = document.getElementById('propertiesContent');

    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);

    const defaultFilters = this.getDefaultFilters(state);
    const exportSettings = this.getExportSettings(state);

    if (selectedIds.length === 0) {
      const baseDefaults = createDefaultFilters();
      const resolutionIsAuto = exportSettings.resolution === 'auto';
      const resolvedResolution = resolutionIsAuto
        ? this.getExportResolution(state)
        : exportSettings.resolution;
      const widthValue = resolvedResolution && resolvedResolution.width ? resolvedResolution.width : 1280;
      const heightValue = resolvedResolution && resolvedResolution.height ? resolvedResolution.height : 720;
      const rangeStartMs = Number.isFinite(exportSettings.rangeStart)
        ? Math.max(0, exportSettings.rangeStart)
        : 0;
      const rangeEndMs = Number.isFinite(exportSettings.rangeEnd)
        ? Math.max(0, exportSettings.rangeEnd)
        : null;
      const rangeStartValue = this.formatSeconds(rangeStartMs);
      const rangeEndValue = rangeEndMs !== null ? this.formatSeconds(rangeEndMs) : '';
      const presetMatchId = this.getExportPresetMatch(exportSettings);
      const presetOptions = Array.isArray(EXPORT_PRESETS)
        ? EXPORT_PRESETS.map((preset) => (
          `<option value="${preset.id}" ${presetMatchId === preset.id ? 'selected' : ''}>${preset.label}</option>`
        )).join('')
        : '';

      propertiesContent.innerHTML = `
        <h3 class="property-section-title">Project Settings</h3>
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
          <div class="property-row">
            <input type="number" class="property-input" id="project-resolution-width"
                   aria-label="Resolution width"
                   min="320" value="${widthValue}">
            <span class="property-row-separator">x</span>
            <input type="number" class="property-input" id="project-resolution-height"
                   aria-label="Resolution height"
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
          this.state.dispatch(actions.updateExportSettings({ resolution: 'auto' }));
        } else {
          const width = parseInt(resolutionWidth.value, 10) || widthValue;
          const height = parseInt(resolutionHeight.value, 10) || heightValue;
          this.state.dispatch(actions.updateExportSettings({ resolution: { width, height } }));
        }
        toggleResolutionInputs();
      });

      const updateResolution = () => {
        if (resolutionMode.value === 'auto') return;
        const width = parseInt(resolutionWidth.value, 10) || widthValue;
        const height = parseInt(resolutionHeight.value, 10) || heightValue;
        this.state.dispatch(actions.updateExportSettings({ resolution: { width, height } }));
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
          this.state.dispatch(actions.updateExportSettings({ ...preset.settings }));
          this.updateStatus(`Applied preset: ${preset.label}`);
          this.renderPropertiesPanel(this.state.getState());
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
          this.state.dispatch(actions.updateExportSettings(buildUpdate(value)));
        };
        if (input.tagName === 'SELECT') {
          input.addEventListener('change', handler);
        } else {
          input.addEventListener('input', handler);
        }
      });

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
          this.state.dispatch(actions.updateExportSettings({
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
          this.state.dispatch(actions.updateDefaultFilters('video', { [key]: value }));
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
          this.state.dispatch(actions.updateDefaultFilters('video', { flipH: e.target.checked }));
        });
      }

      const flipVInput = document.getElementById('project-video-flip-v');
      if (flipVInput) {
        flipVInput.addEventListener('change', (e) => {
          this.state.dispatch(actions.updateDefaultFilters('video', { flipV: e.target.checked }));
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
          this.state.dispatch(actions.updateDefaultFilters('audio', { [key]: value }));
        });
      });

      const normalizeInput = document.getElementById('project-audio-normalize');
      if (normalizeInput) {
        normalizeInput.addEventListener('change', (e) => {
          this.state.dispatch(actions.updateDefaultFilters('audio', { normalize: e.target.checked }));
        });
      }

      this.decoratePropertySliders(propertiesContent);
      return;
    }

    if (selectedIds.length > 1) {
      const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));
      if (selectedClips.length === 0) {
        propertiesContent.innerHTML = '<p class="empty-message">Select a clip to edit properties</p>';
        return;
      }

      const mixedTag = (isMixed) => isMixed ? '<span class="property-mixed">Mixed</span>' : '';
      const firstClip = selectedClips[0];
      const allSame = (getValue) => selectedClips.every(clip => getValue(clip) === getValue(firstClip));

      const speedValue = firstClip.speed || 1;
      const volumeValue = this.resolveClipVolume(firstClip, defaultFilters);
      const colorValue = firstClip.color || '#4a9eff';
      const muteMixed = !allSame(clip => Boolean(clip.muted));
      const visibleMixed = !allSame(clip => clip.visible !== false);
      const reverseMixed = !allSame(clip => Boolean(clip.reversed));
      const speedMixed = !allSame(clip => clip.speed || 1);
      const volumeMixed = !allSame(clip => this.resolveClipVolume(clip, defaultFilters));
      const colorMixed = !allSame(clip => clip.color || '#4a9eff');

      propertiesContent.innerHTML = `
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
          this.state.dispatch(actions.updateClips(selectedIds, { muted: e.target.checked }));
        });
      }

      if (visibleInput) {
        visibleInput.checked = selectedClips.every(clip => clip.visible !== false);
        visibleInput.indeterminate = visibleMixed;
        visibleInput.addEventListener('change', (e) => {
          visibleInput.indeterminate = false;
          this.state.dispatch(actions.updateClips(selectedIds, { visible: e.target.checked }));
        });
      }

      if (reverseInput) {
        reverseInput.checked = selectedClips.every(clip => Boolean(clip.reversed));
        reverseInput.indeterminate = reverseMixed;
        reverseInput.addEventListener('change', (e) => {
          reverseInput.indeterminate = false;
          this.state.dispatch(actions.updateClips(selectedIds, { reversed: e.target.checked }));
        });
      }

      document.getElementById('multi-speed').addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        document.getElementById('multi-speed-value').textContent = `${speed}x`;
        this.state.dispatch(actions.setClipsSpeed(selectedIds, speed));
      });

      document.getElementById('multi-volume').addEventListener('input', (e) => {
        const volume = parseFloat(e.target.value);
        document.getElementById('multi-volume-value').textContent = `${Math.round(volume * 100)}%`;
        this.state.dispatch(actions.updateClips(selectedIds, { volume }));
      });

      document.getElementById('multi-color').addEventListener('input', (e) => {
        this.state.dispatch(actions.updateClips(selectedIds, { color: e.target.value }));
      });

      document.getElementById('multi-delete').addEventListener('click', () => {
        this.state.dispatch(actions.removeClips(selectedIds));
      });

      this.decoratePropertySliders(propertiesContent);
      return;
    }

    const clip = state.clips.find(c => c.id === selectedIds[0]);
    if (!clip) return;

    const idPrefix = `clip-${clip.id}`;
    const videoOverrides = clip.videoFilters || {};
    const audioOverrides = clip.audioFilters || {};
    const resolvedVideoFilters = this.resolveVideoFilters(clip, defaultFilters);
    const resolvedAudioFilters = this.resolveAudioFilters(clip, defaultFilters);
    const clipVolume = this.resolveClipVolume(clip, defaultFilters);
    const defaultTag = (hasOverride) => hasOverride ? '' : '<span class="property-default">Default</span>';
    const clipMedia = state.mediaLibrary.find(m => m.id === clip.mediaId) || null;
    const mediaTranscript = clipMedia && clipMedia.transcript ? clipMedia.transcript : null;
    const canLoadTranscript = Boolean(clipMedia);
    const transcriptSummary = mediaTranscript && Array.isArray(mediaTranscript.cues)
      ? `${mediaTranscript.cues.length} cues${mediaTranscript.sourceName ? ` - ${mediaTranscript.sourceName}` : ''}`
      : 'No transcript loaded';
    const hasTranscript = Boolean(mediaTranscript && Array.isArray(mediaTranscript.cues));
    const searchDisabled = hasTranscript ? '' : 'disabled';

    propertiesContent.innerHTML = `
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
      <div class="property-group">
        <label class="property-label" for="${idPrefix}-transcript-search">Search Transcript</label>
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

      <div class="property-group">
        <button class="btn btn-secondary" id="${idPrefix}-delete" style="width: 100%;">
          Delete Clip
        </button>
      </div>
    `;

    // Add event listeners for property changes
    document.getElementById(`${idPrefix}-name`).addEventListener('input', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { name: e.target.value }));
    });

    document.getElementById(`${idPrefix}-speed`).addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value);
      document.getElementById(`${idPrefix}-speed-value`).textContent = `${speed}x`;
      this.state.dispatch(actions.setClipSpeed(clip.id, speed));
    });

    document.getElementById(`${idPrefix}-volume`).addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value);
      document.getElementById(`${idPrefix}-volume-value`).textContent = `${Math.round(volume * 100)}%`;
      this.state.dispatch(actions.updateClip(clip.id, { volume }));
    });

    document.getElementById(`${idPrefix}-muted`).addEventListener('change', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { muted: e.target.checked }));
    });

    document.getElementById(`${idPrefix}-visible`).addEventListener('change', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { visible: e.target.checked }));
    });

    document.getElementById(`${idPrefix}-reversed`).addEventListener('change', (e) => {
      this.state.dispatch(actions.reverseClip(clip.id));
    });

    document.getElementById(`${idPrefix}-color`).addEventListener('input', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { color: e.target.value }));
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
        this.state.dispatch(actions.updateClipVideoFilters(clip.id, { [key]: value }));
      });
    });

    const rotateInput = document.getElementById(`${idPrefix}-rotate`);
    if (rotateInput) {
      rotateInput.addEventListener('change', (e) => {
        const value = parseInt(e.target.value, 10);
        if (Number.isNaN(value)) return;
        this.state.dispatch(actions.updateClipVideoFilters(clip.id, { rotate: value }));
      });
    }

    const flipHInput = document.getElementById(`${idPrefix}-flip-h`);
    if (flipHInput) {
      flipHInput.addEventListener('change', (e) => {
        this.state.dispatch(actions.updateClipVideoFilters(clip.id, { flipH: e.target.checked }));
      });
    }

    const flipVInput = document.getElementById(`${idPrefix}-flip-v`);
    if (flipVInput) {
      flipVInput.addEventListener('change', (e) => {
        this.state.dispatch(actions.updateClipVideoFilters(clip.id, { flipV: e.target.checked }));
      });
    }

    const videoResetBtn = document.getElementById(`${idPrefix}-video-reset`);
    if (videoResetBtn) {
      videoResetBtn.addEventListener('click', () => {
        this.state.dispatch(actions.clearClipVideoFilters(clip.id));
        this.renderPropertiesPanel(this.state.getState());
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
        this.state.dispatch(actions.updateClipAudioFilters(clip.id, { [key]: value }));
      });
    });

    const normalizeInput = document.getElementById(`${idPrefix}-normalize`);
    if (normalizeInput) {
      normalizeInput.addEventListener('change', (e) => {
        this.state.dispatch(actions.updateClipAudioFilters(clip.id, { normalize: e.target.checked }));
      });
    }

    const audioResetBtn = document.getElementById(`${idPrefix}-audio-reset`);
    if (audioResetBtn) {
      audioResetBtn.addEventListener('click', () => {
        this.state.dispatch(actions.clearClipAudioFilters(clip.id));
        this.state.dispatch(actions.updateClip(clip.id, { volume: undefined }));
        this.renderPropertiesPanel(this.state.getState());
      });
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
          const cues = this.parseWhisperTranscript(text);
          if (!cues.length) {
            this.updateStatus('Transcript not recognized');
            return;
          }
          this.state.dispatch(actions.updateMedia(clipMedia.id, {
            transcript: {
              format: 'whisper',
              cues,
              sourceName: file.name,
              loadedAt: Date.now(),
            },
          }));
          this.updateStatus(`Loaded transcript (${cues.length} cues)`);
          this.renderPropertiesPanel(this.state.getState());
        } catch (error) {
          console.error('Failed to load transcript:', error);
          this.updateStatus('Failed to load transcript');
        } finally {
          e.target.value = '';
        }
      });
    }

    if (transcriptClearBtn && clipMedia) {
      transcriptClearBtn.addEventListener('click', () => {
        this.state.dispatch(actions.updateMedia(clipMedia.id, { transcript: undefined }));
        this.renderPropertiesPanel(this.state.getState());
      });
    }

    const transcriptSearchInput = document.getElementById(`${idPrefix}-transcript-search`);
    const transcriptResults = document.getElementById(`${idPrefix}-transcript-results`);
    const transcriptPagination = document.getElementById(`${idPrefix}-transcript-pagination`);
    let transcriptPage = 0;
    const renderTranscriptResults = () => {
      const result = this.renderTranscriptResults(
        clip,
        mediaTranscript,
        transcriptSearchInput ? transcriptSearchInput.value : '',
        transcriptResults,
        transcriptPagination,
        transcriptPage
      );
      transcriptPage = result.page;
    };
    if (transcriptSearchInput) {
      transcriptSearchInput.addEventListener('input', () => {
        transcriptPage = 0;
        renderTranscriptResults();
      });
    }
    if (transcriptResults) {
      transcriptResults.addEventListener('click', (e) => {
        const button = e.target.closest('.transcript-result');
        if (!button) return;
        const time = Number(button.dataset.clipTime);
        if (!Number.isFinite(time)) return;
        this.state.dispatch(actions.setPlayhead(time), false);
      });
    }
    if (transcriptPagination) {
      transcriptPagination.addEventListener('click', (e) => {
        if (e.target.closest('.transcript-prev')) {
          transcriptPage -= 1;
          renderTranscriptResults();
          return;
        }
        if (e.target.closest('.transcript-next')) {
          transcriptPage += 1;
          renderTranscriptResults();
        }
      });
    }
    renderTranscriptResults();

    document.getElementById(`${idPrefix}-delete`).addEventListener('click', () => {
      this.state.dispatch(actions.removeClip(clip.id));
    });

    this.decoratePropertySliders(propertiesContent);
  }

  /**
   * Update time display
   * @param {number} timeMs
   */
  updateTimeDisplay(timeMs) {
    const timeDisplay = document.getElementById('timeDisplay');
    const seconds = (timeMs / 1000).toFixed(2);
    timeDisplay.textContent = `${formatTime(timeMs)} (${seconds}s)`;
  }

  /**
   * Start playback
   */
  play() {
    const state = this.state.getState();

    if (state.isPlaying) return;

    this.state.dispatch(actions.setPlaying(true), false);
  }

  /**
   * Pause playback
   */
  pause() {
    this.state.dispatch(actions.setPlaying(false), false);
  }

  /**
   * Start playback loop from current state without re-dispatching play
   * @param {import('./core/types.js').EditorState} state
   */
  startPlaybackFromState(state) {
    this.playbackStartTime = Date.now();
    this.playbackStartPosition = state.playhead;
    if (!this.isPlaybackLoopActive) {
      this.isPlaybackLoopActive = true;
      this.playbackLoop();
    }
  }

  /**
   * Playback loop
   */
  playbackLoop() {
    const state = this.state.getState();

    if (!state.isPlaying) {
      this.isPlaybackLoopActive = false;
      return;
    }

    const elapsed = Date.now() - this.playbackStartTime;
    const newPlayhead = this.playbackStartPosition + elapsed;

    this.isPlayheadUpdateFromPlayback = true;
    this.state.dispatch(actions.setPlayhead(newPlayhead), false);

    // Continue loop
    requestAnimationFrame(() => this.playbackLoop());
  }

  /**
   * Zoom in
   */
  zoomIn() {
    const currentZoom = this.state.getState().zoom;
    this.state.dispatch(actions.setZoom(Math.min(MAX_ZOOM, currentZoom + ZOOM_STEP)), false);
  }

  /**
   * Zoom out
   */
  zoomOut() {
    const currentZoom = this.state.getState().zoom;
    this.state.dispatch(actions.setZoom(Math.max(MIN_ZOOM, currentZoom - ZOOM_STEP)), false);
  }

  /**
   * Add a new track
   */
  addTrack() {
    const trackCount = this.state.getState().tracks.length;
    this.state.dispatch(actions.addTrack(`Track ${trackCount + 1}`));
  }

  /**
   * Start a new project (clears current state)
   */
  newProject() {
    this.state.reset();
    this.clearMediaCaches();
    this.hideExportCommand();
    this.wasPlaying = false;
    this.isPlaybackLoopActive = false;
    this.isPlayheadUpdateFromPlayback = false;
    this.lastPlayhead = 0;
    this.pendingReassociateMediaId = null;
    this.lastPreviewVideoClipId = null;
    this.lastPreviewAudioClipId = null;
    this.lastPropertiesClipId = null;
    this.lastPropertiesSignature = null;
    this.updateStatus('New project created (unsaved)');
  }

  /**
   * Save project to LocalStorage
   */
  saveProject() {
    try {
      const json = this.state.toJSON();
      localStorage.setItem('ytp-editor-project', json);
      this.updateStatus('Project saved');

      setTimeout(() => {
        this.updateStatus('Ready');
      }, 2000);
    } catch (error) {
      console.error('Failed to save project:', error);
      this.updateStatus('Failed to save project');
    }
  }

  /**
   * Load project from LocalStorage (metadata only; media files must be reimported)
   */
  loadProject() {
    const saved = localStorage.getItem('ytp-editor-project');
    if (!saved) return;

    try {
      this.applyLoadedProject(saved, 'Project loaded (reimport media files to preview)');
    } catch (error) {
      console.error('Failed to load project:', error);
      this.updateStatus('Failed to load project');
    }
  }

  /**
   * Clear media caches and video elements
   */
  clearMediaCaches() {
    if (this.mediaFiles) {
      this.mediaFiles.clear();
    }

    if (this.mediaInfo) {
      this.mediaInfo.clear();
    }

    if (this.videoElements) {
      this.videoElements.forEach(video => {
        try {
          video.pause();
        } catch (error) {
          // Ignore video pause errors
        }
        video.removeAttribute('src');
        video.load();
      });
      this.videoElements.clear();
    }

    if (this.audioElements) {
      this.audioElements.forEach(audio => {
        try {
          audio.pause();
        } catch (error) {
          // Ignore audio pause errors
        }
        audio.removeAttribute('src');
        audio.load();
      });
      this.audioElements.clear();
    }

    if (this.decodedAudio) {
      this.decodedAudio.clear();
    }
    this.stopReverseAudio();
  }

  /**
   * Show project modal
   */
  showProjectModal() {
    if (!this.projectModal) return;

    const hasSaved = Boolean(localStorage.getItem('ytp-editor-project'));
    if (this.projectModalMessage) {
      this.projectModalMessage.textContent = hasSaved
        ? 'Start a new project, load the last saved project, or import a JSON file.'
        : 'No saved project found. Start a new project or import a JSON file?';
    }
    if (this.projectLoadBtn) {
      this.projectLoadBtn.disabled = !hasSaved;
    }

    this.projectModal.style.display = 'flex';
  }

  /**
   * Hide project modal
   */
  hideProjectModal() {
    if (this.projectModal) {
      this.projectModal.style.display = 'none';
    }
  }

  /**
   * Show save modal
   */
  showSaveModal() {
    if (!this.saveModal) return;
    if (this.saveModalMessage) {
      this.saveModalMessage.textContent = 'Save to browser storage or export a JSON backup (media files are not included).';
    }
    this.saveModal.style.display = 'flex';
  }

  /**
   * Hide save modal
   */
  hideSaveModal() {
    if (this.saveModal) {
      this.saveModal.style.display = 'none';
    }
  }

  /**
   * Export project JSON to a file
   */
  exportProject() {
    try {
      const json = this.state.toJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `ytp-project-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.updateStatus('Project exported (media files not included)');
    } catch (error) {
      console.error('Failed to export project:', error);
      this.updateStatus('Failed to export project');
    }
  }

  /**
   * Handle project import file selection
   * @param {Event} e
   */
  async handleProjectImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const json = await file.text();
      this.applyLoadedProject(json, 'Project imported (reimport media files to preview)');
      localStorage.setItem('ytp-editor-project', json);
      this.hideProjectModal();
    } catch (error) {
      console.error('Failed to import project:', error);
      this.updateStatus('Failed to import project');
    } finally {
      e.target.value = '';
    }
  }

  /**
   * Apply loaded project JSON and reset runtime caches
   * @param {string} json
   * @param {string} statusMessage
   */
  applyLoadedProject(json, statusMessage) {
    this.state.loadFromJSON(json);
    this.clearMediaCaches();
    this.hideExportCommand();
    this.pendingReassociateMediaId = null;
    this.lastPreviewVideoClipId = null;
    this.lastPreviewAudioClipId = null;
    this.lastPropertiesClipId = null;
    this.lastPropertiesSignature = null;
    this.updateStatus(statusMessage);
  }

  /**
   * Export video by copying an ffmpeg command
   */
  exportVideo() {
    const state = this.state.getState();
    const command = this.buildFfmpegExportCommand(state);
    if (!command) {
      this.updateStatus('Nothing to export');
      return;
    }

    const warningMessage = this.exportAudioWarning
      ? 'FFmpeg command ready (some audio tracks undetected; preview those clips to detect)'
      : null;
    this.copyExportCommand(command, warningMessage);
  }

  /**
   * Copy ffmpeg command to clipboard
   * @param {string} command
   */
  copyExportCommand(command, warningMessage = null) {
    this.showExportCommand(command);

    if (document.hasFocus && !document.hasFocus()) {
      this.updateStatus(warningMessage || 'FFmpeg command ready to copy');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(command)
        .then(() => {
          this.updateStatus(warningMessage || 'FFmpeg command copied to clipboard');
        })
        .catch(() => {
          this.updateStatus(warningMessage || 'FFmpeg command ready to copy');
        });
    } else {
      this.updateStatus(warningMessage || 'FFmpeg command ready to copy');
    }
  }

  /**
   * Show export command bar
   * @param {string} command
   */
  showExportCommand(command) {
    if (this.exportCommandInput) {
      this.exportCommandInput.value = command;
    }
    if (this.exportCommandBar) {
      this.exportCommandBar.hidden = false;
    }
  }

  /**
   * Hide export command bar
   */
  hideExportCommand() {
    if (this.exportCommandBar) {
      this.exportCommandBar.hidden = true;
    }
  }

  /**
   * Update media info based on a video element
   * @param {string} mediaId
   * @param {HTMLVideoElement} video
   */
  updateMediaInfoFromVideo(mediaId, video) {
    const info = this.mediaInfo.get(mediaId) || {
      hasAudio: null,
      hasVideo: null,
      isAudioOnly: false,
      isVideoType: false,
      audioProbeStart: null,
    };

    if (info.hasVideo !== true) {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        info.hasVideo = true;
      } else if (info.isAudioOnly) {
        info.hasVideo = false;
      } else if (info.isVideoType) {
        info.hasVideo = true;
      }
    }

    if (info.hasAudio !== true && info.hasAudio !== false) {
      if (typeof video.mozHasAudio === 'boolean') {
        info.hasAudio = video.mozHasAudio;
      } else if (video.audioTracks && video.audioTracks.length > 0) {
        info.hasAudio = true;
      } else if (typeof video.captureStream === 'function') {
        try {
          const tracks = video.captureStream().getAudioTracks();
          if (tracks && tracks.length > 0) {
            info.hasAudio = true;
          }
        } catch (error) {
          // Ignore capture stream errors and fall back to probe.
        }
      }

      if (typeof video.webkitAudioDecodedByteCount === 'number') {
        if (video.webkitAudioDecodedByteCount > 0) {
          info.hasAudio = true;
        } else if (!video.paused && video.currentTime > 0.2) {
          if (!info.audioProbeStart) {
            info.audioProbeStart = Date.now();
          } else if (Date.now() - info.audioProbeStart > 800) {
            info.hasAudio = false;
          }
        }
      }
    }

    this.mediaInfo.set(mediaId, info);
  }

  /**
   * Ensure an AudioContext exists and is running
   */
  ensureAudioContext() {
    if (!this.audioContext) {
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextImpl) return null;
      this.audioContext = new AudioContextImpl();
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    return this.audioContext;
  }

  /**
   * Decode audio data for a media file (async, cached)
   * @param {string} mediaId
   * @param {File} file
   */
  ensureDecodedAudio(mediaId, file) {
    if (!file || !this.decodedAudio) return;
    const existing = this.decodedAudio.get(mediaId);
    if (existing && (existing.status === 'loading' || existing.status === 'ready')) {
      return;
    }

    const audioContext = this.ensureAudioContext();
    if (!audioContext) return;

    this.decodedAudio.set(mediaId, { status: 'loading' });

    file.arrayBuffer()
      .then((buffer) => audioContext.decodeAudioData(buffer))
      .then((audioBuffer) => {
        const reversedBuffer = this.reverseAudioBuffer(audioBuffer);
        this.decodedAudio.set(mediaId, {
          status: 'ready',
          buffer: audioBuffer,
          reversedBuffer,
        });
      })
      .catch((error) => {
        console.warn('Failed to decode audio for reverse preview:', error);
        this.decodedAudio.set(mediaId, { status: 'error' });
      });
  }

  /**
   * Create a reversed AudioBuffer
   * @param {AudioBuffer} buffer
   * @returns {AudioBuffer}
   */
  reverseAudioBuffer(buffer) {
    const audioContext = this.ensureAudioContext();
    if (!audioContext) return buffer;

    const reversed = audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const input = buffer.getChannelData(channel);
      const output = reversed.getChannelData(channel);
      for (let i = 0, j = input.length - 1; i < input.length; i++, j--) {
        output[i] = input[j];
      }
    }

    return reversed;
  }

  /**
   * Stop reverse audio playback
   */
  stopReverseAudio() {
    if (this.reverseAudioNode) {
      try {
        this.reverseAudioNode.stop();
      } catch (error) {
        // Ignore stop errors
      }
      this.reverseAudioNode.disconnect();
      this.reverseAudioNode = null;
    }

    if (this.reverseAudioGain) {
      this.reverseAudioGain.disconnect();
      this.reverseAudioGain = null;
    }

    this.reverseAudioClipId = null;
  }

  /**
   * Sync reverse audio playback for a clip
   * @param {import('./core/types.js').Clip} clip
   * @param {import('./core/types.js').Media} media
   * @param {File} file
   * @param {number} clipTime
   * @param {boolean} shouldSeek
   * @param {number} gainValue
   */
  syncReverseAudio(clip, media, file, clipTime, shouldSeek, gainValue) {
    const audioContext = this.ensureAudioContext();
    if (!audioContext) return;

    this.ensureDecodedAudio(media.id, file);
    const entry = this.decodedAudio.get(media.id);
    if (!entry || entry.status !== 'ready' || !entry.reversedBuffer) {
      return;
    }

    const buffer = entry.reversedBuffer;
    const durationSec = clip.duration / 1000;
    const reverseStart = Math.max(0, buffer.duration - clipTime);
    const remaining = Math.min(durationSec, buffer.duration - reverseStart);

    if (remaining <= 0) {
      this.stopReverseAudio();
      return;
    }

    const clipChanged = this.reverseAudioClipId !== clip.id;
    const shouldRestart = shouldSeek || clipChanged || !this.reverseAudioNode;

    if (shouldRestart) {
      this.stopReverseAudio();

      const source = audioContext.createBufferSource();
      const gainNode = audioContext.createGain();
      gainNode.gain.value = gainValue;

      source.buffer = buffer;
      source.connect(gainNode).connect(audioContext.destination);

      source.start(audioContext.currentTime, reverseStart, remaining);

      this.reverseAudioNode = source;
      this.reverseAudioGain = gainNode;
      this.reverseAudioClipId = clip.id;
    } else if (this.reverseAudioGain) {
      this.reverseAudioGain.gain.value = gainValue;
    }
  }

  /**
   * Build an ffmpeg command that renders the timeline
   * @param {import('./core/types.js').EditorState} state
   * @returns {string|null}
   */
  buildFfmpegExportCommand(state) {
    let segments = this.getTopmostSegments(state);
    if (segments.length === 0) return null;

    this.exportAudioWarning = false;
    const exportSettings = this.getExportSettings(state);
    const defaultFilters = this.getDefaultFilters(state);
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

    const mediaById = new Map(state.mediaLibrary.map(media => [media.id, media]));
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
      ? this.getExportResolution(state)
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
        const sourceWindow = this.getClipSourceWindow(videoClip, segment.start, durationMs);
        const startSec = sourceWindow.startSec;
        const endSec = sourceWindow.endSec;
        const mediaInfo = this.mediaInfo ? this.mediaInfo.get(media.id) : null;
        const isAudioOnly = media.type && media.type.startsWith('audio/');
        const hasVideo = mediaInfo ? mediaInfo.hasVideo !== false : !isAudioOnly;
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

          const vf = this.resolveVideoFilters(videoClip, defaultFilters);
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
          const durationSec = this.formatSeconds(durationMs);
          filterParts.push(
            `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
            `format=yuv420p,setsar=1[${vLabel}]`
          );
        }
      } else {
        const durationSec = this.formatSeconds(durationMs);
        filterParts.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
          `format=yuv420p,setsar=1[${vLabel}]`
        );
      }

      if (audioClip) {
        const media = mediaById.get(audioClip.mediaId);
        if (!media) return;

        const inputIndex = mediaIndexById.get(media.id);
        const sourceWindow = this.getClipSourceWindow(audioClip, segment.start, durationMs);
        const startSec = sourceWindow.startSec;
        const endSec = sourceWindow.endSec;
        const mediaInfo = this.mediaInfo ? this.mediaInfo.get(media.id) : null;
        const isAudioOnly = media.type && media.type.startsWith('audio/');
        const isVideoType = media.type && media.type.startsWith('video/');
        let hasAudio = false;
        if (mediaInfo && mediaInfo.hasAudio !== null && mediaInfo.hasAudio !== undefined) {
          hasAudio = mediaInfo.hasAudio === true;
        } else if (isAudioOnly) {
          hasAudio = true;
        } else if (isVideoType) {
          hasAudio = true;
          this.exportAudioWarning = true;
        } else {
          this.exportAudioWarning = true;
        }
        const audioFilters = [];

        if (hasAudio) {
          audioFilters.push(`atrim=start=${startSec}:end=${endSec}`);
          audioFilters.push('asetpts=PTS-STARTPTS');
          if (audioClip.reversed) {
            audioFilters.push('areverse');
            audioFilters.push('asetpts=PTS-STARTPTS');
          }

          const af = this.resolveAudioFilters(audioClip, defaultFilters);
          const pitchSemitones = af.pitch || 0;
          const pitchRatio = Math.pow(2, pitchSemitones / 12);
          const speed = sourceWindow.speed || 1;
          const tempo = speed / pitchRatio;

          if (pitchSemitones !== 0) {
            const rate = (sampleRate * pitchRatio).toFixed(2).replace(/\.?0+$/, '');
            audioFilters.push(`asetrate=${rate}`);
          }

          this.buildAtempoFilters(tempo).forEach(filter => audioFilters.push(filter));

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

          const volume = audioClip.muted ? 0 : this.resolveClipVolume(audioClip, defaultFilters);
          if (volume !== 1) {
            audioFilters.push(`volume=${volume}`);
          }

          filterParts.push(
            `[${inputIndex}:a]${audioFilters.join(',')}[${aLabel}]`
          );
        } else {
          const durationSec = this.formatSeconds(durationMs);
          filterParts.push(
            `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:d=${durationSec}[${aLabel}]`
          );
        }
      } else {
        const durationSec = this.formatSeconds(durationMs);
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
      .map(media => `-i "${this.escapeShellArg(media.name)}"`)
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

    return `ffmpeg ${inputs} -filter_complex "${filterComplex}" ` +
      `-map "[outv]" -map "[outa]" ` +
      `${videoFlags.join(' ')} ${audioFlags.join(' ')}` +
      `${movFlags} -y output.${outputFormat}`;
  }

  /**
   * Build topmost-visible segments for the timeline
   * @param {import('./core/types.js').EditorState} state
   * @returns {Array<{audioClip: import('./core/types.js').Clip|null, videoClip: import('./core/types.js').Clip|null, start: number, end: number}>}
   */
  getTopmostSegments(state) {
    const clips = state.clips;
    if (clips.length === 0) return [];

    const mediaById = new Map(state.mediaLibrary.map(media => [media.id, media]));
    const hasVideoForClip = (clip) => {
      const media = mediaById.get(clip.mediaId);
      if (!media) return false;
      const mediaInfo = this.mediaInfo ? this.mediaInfo.get(media.id) : null;
      const isAudioOnly = media.type && media.type.startsWith('audio/');
      const isVideoType = media.type && media.type.startsWith('video/');
      if (mediaInfo) {
        if (mediaInfo.hasVideo === true) return true;
        if (mediaInfo.hasVideo === false) return false;
        return mediaInfo.isVideoType || isVideoType || !isAudioOnly;
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
   * Pick an export resolution based on loaded media
   * @param {import('./core/types.js').EditorState} state
   * @returns {{width: number, height: number}}
   */
  getExportResolution(state) {
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
   * Format milliseconds as seconds with ffmpeg-friendly precision
   * @param {number} ms
   * @returns {string}
   */
  formatSeconds(ms) {
    return (ms / 1000).toFixed(3).replace(/\.?0+$/, '');
  }

  /**
   * Escape text for safe HTML rendering
   * @param {string} value
   * @returns {string}
   */
  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Update a range input's visual fill
   * @param {HTMLInputElement} input
   */
  updateRangeVisual(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    input.style.setProperty('--range-percent', `${Math.max(0, Math.min(100, percent))}%`);
  }

  /**
   * Attach visual updates for range inputs
   * @param {ParentNode} root
   */
  setupRangeVisuals(root = document) {
    const inputs = root.querySelectorAll('input[type="range"]');
    inputs.forEach((input) => {
      this.updateRangeVisual(input);
      if (input.dataset.rangeVisualBound === 'true') return;
      input.dataset.rangeVisualBound = 'true';
      input.addEventListener('input', () => this.updateRangeVisual(input));
    });
  }

  /**
   * Add min/max labels for property sliders
   * @param {HTMLElement|null} container
   */
  decoratePropertySliders(container) {
    if (!container) return;
    const sliders = container.querySelectorAll('input.property-slider');
    sliders.forEach((input) => {
      this.updateRangeVisual(input);
      if (!input.dataset.rangeVisualBound) {
        input.dataset.rangeVisualBound = 'true';
        input.addEventListener('input', () => this.updateRangeVisual(input));
      }

      const min = input.min !== '' ? input.min : '0';
      const max = input.max !== '' ? input.max : '100';
      const next = input.nextElementSibling;
      const valueDisplay = next && next.querySelector && next.querySelector('span[id$="-value"]') ? next : null;
      const insertAfter = valueDisplay || input;
      const existing = insertAfter.nextElementSibling;
      if (!existing || !existing.classList.contains('slider-range')) {
        const rangeEl = document.createElement('div');
        rangeEl.className = 'slider-range';
        rangeEl.innerHTML = `<span>${this.escapeHtml(min)}</span><span>${this.escapeHtml(max)}</span>`;
        insertAfter.insertAdjacentElement('afterend', rangeEl);
      }

      const section = input.dataset.filterSection;
      const key = input.dataset.filterKey;
      const defaultValue = input.dataset.defaultValue;
      if (!section || !key || defaultValue === undefined) return;
      if (input.dataset.resetBound === 'true') return;

      const group = input.closest('.property-group');
      if (!group) return;
      const label = group.querySelector('.property-label');
      if (!label) return;

      let labelRow = group.querySelector('.property-label-row');
      if (!labelRow) {
        labelRow = document.createElement('div');
        labelRow.className = 'property-label-row';
        label.parentNode.insertBefore(labelRow, label);
        labelRow.appendChild(label);
      }

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'property-reset';
      resetBtn.textContent = 'Reset';
      const labelText = label.textContent.trim() || 'setting';
      resetBtn.setAttribute('aria-label', `Reset ${labelText}`);
      resetBtn.addEventListener('click', () => {
        const value = parseFloat(defaultValue);
        if (Number.isNaN(value)) return;
        input.value = String(value);
        this.updateRangeVisual(input);
        this.state.dispatch(actions.updateDefaultFilters(section, { [key]: value }));
      });
      labelRow.appendChild(resetBtn);
      input.dataset.resetBound = 'true';
    });
  }

  /**
   * Get source range for a clip in milliseconds
   * @param {import('./core/types.js').Clip} clip
   * @returns {{start: number, end: number, speed: number, sourceLength: number}}
   */
  getClipSourceRange(clip) {
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
   * @param {import('./core/types.js').Clip} clip
   * @param {number} sourceMs
   * @param {{start: number, end: number, speed: number, sourceLength: number}} range
   * @returns {number}
   */
  mapSourceTimeToClipTime(clip, sourceMs, range) {
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
   * Render transcript search results for a clip
   * @param {import('./core/types.js').Clip} clip
   * @param {import('./core/types.js').Transcript|null} transcript
   * @param {string} query
   * @param {HTMLElement|null} container
   */
  renderTranscriptResults(clip, transcript, query, container, pagination, page = 0) {
    if (!container) return { page: 0, pageCount: 0, total: 0 };
    if (!transcript || !Array.isArray(transcript.cues) || transcript.cues.length === 0) {
      container.innerHTML = '<div class="transcript-empty">Load a transcript to search.</div>';
      if (pagination) {
        pagination.hidden = true;
      }
      return { page: 0, pageCount: 0, total: 0 };
    }

    const search = query ? query.trim().toLowerCase() : '';
    const range = this.getClipSourceRange(clip);
    const matches = [];

    transcript.cues.forEach((cue) => {
      if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return;
      if (cue.end <= range.start || cue.start >= range.end) return;
      if (search && (!cue.text || !cue.text.toLowerCase().includes(search))) return;
      const clipTime = this.mapSourceTimeToClipTime(clip, cue.start, range);
      matches.push({ clipTime, text: cue.text || '' });
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
      `<button type="button" class="transcript-result" data-clip-time="${item.clipTime}">
        <span class="transcript-time">${formatTime(item.clipTime)}</span>
        <span class="transcript-text">${this.escapeHtml(item.text)}</span>
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
  parseWhisperTranscript(text) {
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

  /**
   * Compute source trim window for a timeline segment
   * @param {import('./core/types.js').Clip} clip
   * @param {number} segmentStart
   * @param {number} durationMs
   * @returns {{startSec: string, endSec: string, speed: number}}
   */
  getClipSourceWindow(clip, segmentStart, durationMs) {
    const clipSpeed = clip.speed || 1;
    const segmentOffsetMs = segmentStart - clip.start;
    const sourceDurationMs = durationMs * clipSpeed;
    const trimStart = clip.trimStart || 0;

    if (clip.reversed) {
      const sourceLengthMs = clip.duration * clipSpeed;
      const reverseStart = sourceLengthMs - (segmentOffsetMs + durationMs) * clipSpeed;
      const sourceStartMs = trimStart + Math.max(0, reverseStart);
      return {
        startSec: this.formatSeconds(sourceStartMs),
        endSec: this.formatSeconds(sourceStartMs + sourceDurationMs),
        speed: clipSpeed,
      };
    }

    const sourceStartMs = trimStart + segmentOffsetMs * clipSpeed;
    return {
      startSec: this.formatSeconds(sourceStartMs),
      endSec: this.formatSeconds(sourceStartMs + sourceDurationMs),
      speed: clipSpeed,
    };
  }

  /**
   * Build chained atempo filters for a tempo value
   * @param {number} tempo
   * @returns {string[]}
   */
  buildAtempoFilters(tempo) {
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

  /**
   * Escape double quotes for shell usage
   * @param {string} value
   * @returns {string}
   */
  escapeShellArg(value) {
    return String(value).replace(/"/g, '\\"');
  }

  /**
   * Show help modal
   */
  showHelp() {
    const modal = document.getElementById('helpModal');
    modal.style.display = 'block';

    const closeBtn = modal.querySelector('.close-btn');
    closeBtn.onclick = () => modal.style.display = 'none';

    window.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  /**
   * Render preview canvas
   */
  renderPreview() {
    const state = this.state.getState();
    const playhead = state.playhead;
    const now = performance.now();
    const defaultFilters = this.getDefaultFilters(state);

    // Clear canvas
    const width = this.previewCanvas.width;
    const height = this.previewCanvas.height;
    this.previewCtx.fillStyle = '#000';
    this.previewCtx.fillRect(0, 0, width, height);

    // Find active clips at current playhead
    const activeClips = state.clips
      .filter(clip => playhead >= clip.start && playhead < clip.start + clip.duration);

    const getTopmostClip = (clips) => {
      let topmost = null;
      for (const clip of clips) {
        if (!topmost || clip.trackId < topmost.trackId) {
          topmost = clip;
        }
      }
      return topmost;
    };

    const getClipTime = (clip) => {
      const clipOffset = playhead - clip.start;
      const clipDuration = clip.duration;
      const trimStart = clip.trimStart || 0;
      const clipSpeed = clip.speed || 1;
      const sourceDuration = clipDuration * clipSpeed;
      let sourceOffset = clip.reversed
        ? (sourceDuration - clipOffset * clipSpeed)
        : (clipOffset * clipSpeed);
      if (clip.reversed && sourceOffset >= sourceDuration) {
        sourceOffset = Math.max(0, sourceDuration - 1);
      }
      sourceOffset = Math.max(0, Math.min(sourceDuration, sourceOffset));
      return (trimStart + sourceOffset) / 1000;
    };

    const getMediaForClip = (clip) => state.mediaLibrary.find(m => m.id === clip.mediaId) || null;

    const getLoadedMediaForClip = (clip) => {
      const media = getMediaForClip(clip);
      if (!media || !this.mediaFiles || !this.mediaFiles.has(media.id)) {
        return null;
      }
      return media;
    };

    const getVideoForMedia = (media) => {
      const file = this.mediaFiles.get(media.id);
      if (!this.videoElements.has(media.id)) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.preload = 'auto';
        video.volume = 0;
        this.videoElements.set(media.id, video);
      }
      const video = this.videoElements.get(media.id);
      this.updateMediaInfoFromVideo(media.id, video);
      return video;
    };

    const getAudioForMedia = (media) => {
      const file = this.mediaFiles.get(media.id);
      if (!this.audioElements.has(media.id)) {
        const audio = document.createElement('video');
        audio.src = URL.createObjectURL(file);
        audio.muted = false;
        audio.preload = 'auto';
        audio.volume = this.masterVolume;
        this.audioElements.set(media.id, audio);
      }
      return this.audioElements.get(media.id);
    };

    const activeVideoMediaIds = new Set();
    const activeAudioMediaIds = new Set();
    const shouldResync = this.hasExternalSeek === true;
    let didDrawFrame = false;

    const topmostAudioClip = getTopmostClip(activeClips);
    const videoCandidates = activeClips.filter((clip) => {
      if (clip.visible === false) return false;
      const media = getMediaForClip(clip);
      if (!media) return false;
      const mediaInfo = this.mediaInfo.get(media.id);
      const isAudioOnly = media.type && media.type.startsWith('audio/');
      const isVideoType = media.type && media.type.startsWith('video/');
      if (mediaInfo) {
        if (mediaInfo.hasVideo === true) return true;
        if (mediaInfo.hasVideo === false) return false;
        return mediaInfo.isVideoType || isVideoType || !isAudioOnly;
      }
      return isVideoType || !isAudioOnly;
    });
    const topmostVideoClip = getTopmostClip(videoCandidates);

    const audioClipMedia = topmostAudioClip ? getLoadedMediaForClip(topmostAudioClip) : null;
    const videoClipMedia = topmostVideoClip ? getLoadedMediaForClip(topmostVideoClip) : null;

    if (topmostAudioClip && audioClipMedia) {
      const audio = getAudioForMedia(audioClipMedia);
      const audioFile = this.mediaFiles.get(audioClipMedia.id);
      activeAudioMediaIds.add(audioClipMedia.id);

      const clipTime = getClipTime(topmostAudioClip);
      const clipVolume = this.resolveClipVolume(topmostAudioClip, defaultFilters);
      const isMuted = topmostAudioClip.muted || false;
      const isReversed = topmostAudioClip.reversed === true;
      const targetVolume = isMuted ? 0 : (clipVolume * this.masterVolume);
      const clipChanged = this.lastPreviewAudioClipId !== topmostAudioClip.id;
      const shouldSeek = shouldResync || clipChanged || audio.paused;

      audio.volume = targetVolume;
      audio.muted = targetVolume === 0 || isReversed;

      if (state.isPlaying) {
        if (isReversed) {
          if (!audio.paused) {
            audio.pause();
          }
          const timeDiff = Math.abs(audio.currentTime - clipTime);
          const allowSeek = shouldSeek || (now - this.lastReverseSeekTime > 30 && timeDiff > 0.03);
          if (allowSeek) {
            audio.currentTime = clipTime;
            this.lastReverseSeekTime = now;
          }
          this.syncReverseAudio(
            topmostAudioClip,
            audioClipMedia,
            audioFile,
            clipTime,
            shouldSeek,
            targetVolume
          );
        } else {
          this.stopReverseAudio();
          if (shouldSeek) {
            audio.currentTime = clipTime;
          }
          if (audio.paused) {
            audio.play().catch(() => {}); // Ignore autoplay errors
          }
        }
      } else {
        this.stopReverseAudio();
        if (!audio.paused) {
          audio.pause();
        }
        const timeDiff = Math.abs(audio.currentTime - clipTime);
        if (timeDiff > 0.05) {
          const now = Date.now();
          if (!this.lastSeekTime || now - this.lastSeekTime > 50) {
            audio.currentTime = clipTime;
            this.lastSeekTime = now;
          }
        }
      }

      this.lastPreviewAudioClipId = topmostAudioClip.id;
    } else {
      this.stopReverseAudio();
      this.lastPreviewAudioClipId = null;
    }

    if (topmostVideoClip && videoClipMedia) {
      const video = getVideoForMedia(videoClipMedia);
      activeVideoMediaIds.add(videoClipMedia.id);

      const clipTime = getClipTime(topmostVideoClip);
      const isReversed = topmostVideoClip.reversed === true;
      const clipChanged = this.lastPreviewVideoClipId !== topmostVideoClip.id;
      const shouldSeek = shouldResync || clipChanged || video.paused;

      video.volume = 0;
      video.muted = true;

      if (state.isPlaying) {
        if (isReversed) {
          if (!video.paused) {
            video.pause();
          }
          const timeDiff = Math.abs(video.currentTime - clipTime);
          const allowSeek = shouldSeek || (now - this.lastReverseSeekTime > 30 && timeDiff > 0.03);
          if (allowSeek) {
            video.currentTime = clipTime;
            this.lastReverseSeekTime = now;
          }
        } else {
          if (shouldSeek) {
            video.currentTime = clipTime;
          }
          if (video.paused) {
            video.play().catch(() => {}); // Ignore autoplay errors
          }
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
        const timeDiff = Math.abs(video.currentTime - clipTime);
        if (timeDiff > 0.05) {
          const now = Date.now();
          if (!this.lastSeekTime || now - this.lastSeekTime > 50) {
            video.currentTime = clipTime;
            this.lastSeekTime = now;
          }
        }
      }

      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = width / height;

        let drawWidth, drawHeight, drawX, drawY;

        if (videoAspect > canvasAspect) {
          drawWidth = width;
          drawHeight = width / videoAspect;
          drawX = 0;
          drawY = (height - drawHeight) / 2;
        } else {
          drawHeight = height;
          drawWidth = height * videoAspect;
          drawX = (width - drawWidth) / 2;
          drawY = 0;
        }

        this.previewCtx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        if (this.previewFrameCtx) {
          this.previewFrameCtx.clearRect(0, 0, width, height);
          this.previewFrameCtx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
          this.hasPreviewFrame = true;
        }
        didDrawFrame = true;
      }

      this.lastPreviewVideoClipId = topmostVideoClip.id;
    } else {
      this.lastPreviewVideoClipId = null;
    }

    if (!topmostVideoClip) {
      const message = topmostAudioClip ? 'Audio only at playhead' : 'No clips at playhead';
      this.previewCtx.fillStyle = '#666';
      this.previewCtx.font = '24px sans-serif';
      this.previewCtx.textAlign = 'center';
      this.previewCtx.textBaseline = 'middle';
      this.previewCtx.fillText(message, width / 2, height / 2);
    } else if (!videoClipMedia) {
      this.previewCtx.fillStyle = '#666';
      this.previewCtx.font = '20px sans-serif';
      this.previewCtx.textAlign = 'center';
      this.previewCtx.textBaseline = 'middle';
      this.previewCtx.fillText('Media not loaded (reimport file)', width / 2, height / 2);
    } else if (!didDrawFrame && this.hasPreviewFrame && this.previewFrameBuffer) {
      this.previewCtx.drawImage(this.previewFrameBuffer, 0, 0, width, height);
    }

    this.hasExternalSeek = false;

    // Pause any media that is not active to respect clip bounds
    if (this.videoElements) {
      this.videoElements.forEach((video, mediaId) => {
        if (!activeVideoMediaIds.has(mediaId) && !video.paused) {
          video.pause();
        }
      });
    }

    if (this.audioElements) {
      this.audioElements.forEach((audio, mediaId) => {
        if (!activeAudioMediaIds.has(mediaId) && !audio.paused) {
          audio.pause();
        }
      });
    }

    // Continue render loop
    requestAnimationFrame(() => this.renderPreview());
  }

  /**
   * Resize preview canvas
   */
  resizePreview() {
    const container = this.previewCanvas.parentElement;
    const rect = container.getBoundingClientRect();

    // Maintain 16:9 aspect ratio
    const aspectRatio = 16 / 9;
    let width = rect.width - 20; // padding
    let height = width / aspectRatio;

    if (height > rect.height - 20) {
      height = rect.height - 20;
      width = height * aspectRatio;
    }

    this.previewCanvas.width = width;
    this.previewCanvas.height = height;
    this.previewCanvas.style.width = width + 'px';
    this.previewCanvas.style.height = height + 'px';
    if (this.previewFrameBuffer) {
      this.previewFrameBuffer.width = width;
      this.previewFrameBuffer.height = height;
      this.hasPreviewFrame = false;
    }
  }

  /**
   * Update status bar text
   * @param {string} text
   */
  updateStatus(text) {
    document.getElementById('statusText').textContent = text;
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.ytpEditor = new YTPEditor();
  });
} else {
  window.ytpEditor = new YTPEditor();
}
