/**
 * @fileoverview Main application bootstrap
 * Initializes the YTP Video Editor
 */

import { StateManager } from './core/state.js';
import { KeyboardManager } from './utils/keyboard.js';
import { Timeline } from './ui/Timeline.js';
import * as actions from './core/actions.js';
import { formatTime } from './utils/time.js';
import { setupRangeVisuals } from './ui/rangeVisuals.js';
import { PropertiesPanel } from './ui/properties.js';
import { buildFfmpegExportCommand } from './export/ffmpeg.js';
import { MediaManager } from './media/MediaManager.js';
import { PlaybackCache } from './media/PlaybackCache.js';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  createDefaultFilters,
} from './core/constants.js';
import { createDefaultExportSettings } from './export/settings.js';

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
    this.lastReverseAudioSeekTime = 0;
    this.lastReverseVideoClipTime = null;
    this.lastReverseVideoMediaId = null;
    this.previewFrameBuffer = document.createElement('canvas');
    this.previewFrameCtx = this.previewFrameBuffer.getContext('2d');
    this.hasPreviewFrame = false;
    this.audioContext = null;
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
    this.playbackCache = new PlaybackCache({
      videoElements: this.videoElements,
      audioElements: this.audioElements,
    });
    this.propertiesPanel = new PropertiesPanel(this);
    this.mediaManager = new MediaManager(this);

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

    setupRangeVisuals(document);

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
    fileInput.addEventListener('change', (e) => this.mediaManager.handleFileUpload(e));

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
      this.reassociateInput.addEventListener('change', (e) => this.mediaManager.handleReassociateFile(e));
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

    const resumeAudio = () => {
      this.ensureAudioContext();
    };
    document.addEventListener('pointerdown', resumeAudio);
    document.addEventListener('keydown', resumeAudio);
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
      this.ensureAudioContext();
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
    this.mediaManager.renderMediaLibrary(state);

    // Update properties panel only when selected clip changes or when not actively editing
    const { signature: selectedSignature } = this.getSelectedClipSignature(state);
    const propertiesContent = document.getElementById('propertiesContent');
    const isEditing = propertiesContent && propertiesContent.contains(document.activeElement);
    const clipChanged = state.selectedClipId !== this.lastPropertiesClipId;
    const shouldRenderProperties = clipChanged || (!isEditing && selectedSignature !== this.lastPropertiesSignature);

    if (shouldRenderProperties) {
      this.propertiesPanel.render(state);
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
        clip.duration,
        clip.trimStart,
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

    this.ensureAudioContext();
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

    if (this.playbackCache) {
      this.playbackCache.clearAll();
    }

    if (this.mediaInfo) {
      this.mediaInfo.clear();
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
    const result = buildFfmpegExportCommand(state, {
      exportSettings: this.getExportSettings(state),
      defaultFilters: this.getDefaultFilters(state),
      mediaInfo: this.mediaInfo,
      resolveVideoFilters: this.resolveVideoFilters.bind(this),
      resolveAudioFilters: this.resolveAudioFilters.bind(this),
      resolveClipVolume: this.resolveClipVolume.bind(this),
    });
    if (!result || !result.command) {
      this.updateStatus('Nothing to export');
      return;
    }

    const warningMessage = result.exportAudioWarning
      ? 'FFmpeg command ready (some audio tracks undetected; preview those clips to detect)'
      : null;
    this.copyExportCommand(result.command, warningMessage);
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
        video.src = this.playbackCache.getObjectUrl(media.id, file);
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
        audio.src = this.playbackCache.getObjectUrl(media.id, file);
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
      activeAudioMediaIds.add(audioClipMedia.id);

      const clipTime = getClipTime(topmostAudioClip);
      const clipVolume = this.resolveClipVolume(topmostAudioClip, defaultFilters);
      const isMuted = topmostAudioClip.muted || false;
      const isReversed = topmostAudioClip.reversed === true;
      const targetVolume = isMuted ? 0 : (clipVolume * this.masterVolume);
      const clipChanged = this.lastPreviewAudioClipId !== topmostAudioClip.id;
      const shouldSeek = shouldResync || clipChanged || (!isReversed && audio.paused);
      audio.volume = targetVolume;
      audio.muted = targetVolume === 0;

      if (state.isPlaying) {
        if (isReversed) {
          this.stopReverseAudio();
          audio.playbackRate = Math.max(0.25, Math.min(4, topmostAudioClip.speed || 1));
          if (audio.paused) {
            audio.play().catch(() => {});
          }
          const timeDiff = Math.abs(audio.currentTime - clipTime);
          if (shouldSeek || (timeDiff > 0.2 && now - this.lastReverseAudioSeekTime > 120)) {
            audio.currentTime = clipTime;
            this.lastReverseAudioSeekTime = now;
          }
        } else {
          this.stopReverseAudio();
          audio.playbackRate = Math.max(0.25, Math.min(4, topmostAudioClip.speed || 1));
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
        audio.playbackRate = 1;
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
      const shouldSeek = shouldResync || clipChanged || (!isReversed && video.paused);
      const targetRate = Math.max(0.25, Math.min(4, topmostVideoClip.speed || 1));

      video.volume = 0;
      video.muted = true;

      if (state.isPlaying) {
        if (isReversed) {
          video.playbackRate = 1;
          if (!video.paused) {
            video.pause();
          }
          const reverseMediaChanged = this.lastReverseVideoMediaId !== videoClipMedia.id;
          if (clipChanged || reverseMediaChanged) {
            this.lastReverseSeekTime = 0;
            this.lastReverseVideoClipTime = null;
            this.lastReverseVideoMediaId = videoClipMedia.id;
          }
          const lastClipTime = Number.isFinite(this.lastReverseVideoClipTime)
            ? this.lastReverseVideoClipTime
            : video.currentTime;
          const timeDiff = Math.abs(lastClipTime - clipTime);
          const minStep = 0.06;
          const minInterval = 80;
          const allowSeek = shouldSeek || reverseMediaChanged
            || (timeDiff > minStep && now - this.lastReverseSeekTime > minInterval);
          if (allowSeek && !video.seeking) {
            const safeClipTime = Number.isFinite(video.duration) && video.duration > 0
              ? Math.min(Math.max(0, clipTime), Math.max(0, video.duration - 0.001))
              : clipTime;
            video.currentTime = safeClipTime;
            this.lastReverseSeekTime = now;
            this.lastReverseVideoClipTime = clipTime;
          }
        } else {
          video.playbackRate = targetRate;
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
        video.playbackRate = 1;
        const timeDiff = Math.abs(video.currentTime - clipTime);
        if (timeDiff > 0.05) {
          const now = Date.now();
          if (!this.lastSeekTime || now - this.lastSeekTime > 50) {
            video.currentTime = clipTime;
            this.lastSeekTime = now;
          }
        }
      }

      if (video.readyState >= video.HAVE_CURRENT_DATA && !video.seeking) {
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
