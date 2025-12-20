/**
 * @fileoverview Main application bootstrap
 * Initializes the YTP Video Editor
 */

import { StateManager } from './core/state.js';
import { KeyboardManager } from './utils/keyboard.js';
import { Timeline } from './ui/Timeline.js';
import * as actions from './core/actions.js';
import { formatTime } from './utils/time.js';
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './core/constants.js';

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
    this.projectCancelBtn = document.getElementById('projectCancelBtn');

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
    document.getElementById('saveBtn').addEventListener('click', () => this.saveProject());
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

      // Add to media library
      const mediaId = crypto.randomUUID();
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

      // Store file reference (in a simple map for now, IndexedDB later)
      if (!this.mediaFiles) this.mediaFiles = new Map();
      this.mediaFiles.set(mediaId, file);
      this.mediaInfo.set(mediaId, {
        hasAudio: metadata.hasAudio,
        hasVideo: metadata.hasVideo,
      });

      this.updateStatus(`Loaded ${file.name}`);
    }

    // Clear file input
    e.target.value = '';
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

      video.onloadedmetadata = () => {
        let hasAudio = null;
        if (isAudioOnly) {
          hasAudio = true;
        } else if (typeof video.mozHasAudio === 'boolean') {
          hasAudio = video.mozHasAudio;
        } else if (video.audioTracks && video.audioTracks.length > 0) {
          hasAudio = true;
        }

        const hasVideo = !isAudioOnly && video.videoWidth > 0 && video.videoHeight > 0;

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
          hasVideo: !isAudioOnly,
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

    // Update properties panel if clip is selected
    this.renderPropertiesPanel(state);
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
      const item = document.createElement('div');
      item.className = 'media-item';
      item.draggable = true;

      const name = document.createElement('div');
      name.className = 'media-item-name';
      name.textContent = media.name;

      const info = document.createElement('div');
      info.className = 'media-item-info';
      const durationSec = Math.round(media.duration / 1000);
      const sizeMB = (media.size / 1024 / 1024).toFixed(2);
      info.textContent = `${durationSec}s · ${media.width}x${media.height} · ${sizeMB}MB`;

      item.appendChild(name);
      item.appendChild(info);

      // Double-click to add to timeline
      item.addEventListener('dblclick', () => {
        this.addMediaToTimeline(media);
      });

      // Drag and drop support
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('mediaId', media.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      mediaList.appendChild(item);
    });
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

    if (!state.selectedClipId) {
      propertiesContent.innerHTML = '<p class="empty-message">Select a clip to edit properties</p>';
      return;
    }

    const clip = state.clips.find(c => c.id === state.selectedClipId);
    if (!clip) return;

    propertiesContent.innerHTML = `
      <div class="property-group">
        <label class="property-label">Name</label>
        <input type="text" class="property-input" id="clipName" value="${clip.name}">
      </div>
      <div class="property-group">
        <label class="property-label">Speed</label>
        <input type="range" class="property-slider" id="clipSpeed"
               min="0.25" max="4" step="0.25" value="${clip.speed || 1}">
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">
          <span id="speedValue">${clip.speed || 1}x</span>
        </div>
      </div>
      <div class="property-group">
        <label class="property-label">Volume</label>
        <input type="range" class="property-slider" id="clipVolume"
               min="0" max="1" step="0.01" value="${clip.volume !== undefined ? clip.volume : 1}">
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">
          <span id="volumeValue">${Math.round((clip.volume !== undefined ? clip.volume : 1) * 100)}%</span>
        </div>
      </div>
      <div class="property-group">
        <label class="property-label">
          <input type="checkbox" class="property-checkbox" id="clipMuted"
                 ${clip.muted ? 'checked' : ''}>
          Mute Audio
        </label>
      </div>
      <div class="property-group">
        <label class="property-label">
          <input type="checkbox" class="property-checkbox" id="clipReversed"
                 ${clip.reversed ? 'checked' : ''}>
          Reversed
        </label>
      </div>
      <div class="property-group">
        <label class="property-label">Color</label>
        <input type="color" class="color-picker" id="clipColor" value="${clip.color || '#4a9eff'}">
      </div>
      <div class="property-group">
        <button class="btn btn-secondary" id="deleteClipBtn" style="width: 100%;">
          Delete Clip
        </button>
      </div>
    `;

    // Add event listeners for property changes
    document.getElementById('clipName').addEventListener('input', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { name: e.target.value }));
    });

    document.getElementById('clipSpeed').addEventListener('input', (e) => {
      const speed = parseFloat(e.target.value);
      document.getElementById('speedValue').textContent = `${speed}x`;
      this.state.dispatch(actions.setClipSpeed(clip.id, speed));
    });

    document.getElementById('clipVolume').addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value);
      document.getElementById('volumeValue').textContent = `${Math.round(volume * 100)}%`;
      this.state.dispatch(actions.updateClip(clip.id, { volume }));
    });

    document.getElementById('clipMuted').addEventListener('change', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { muted: e.target.checked }));
    });

    document.getElementById('clipReversed').addEventListener('change', (e) => {
      this.state.dispatch(actions.reverseClip(clip.id));
    });

    document.getElementById('clipColor').addEventListener('input', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { color: e.target.value }));
    });

    document.getElementById('deleteClipBtn').addEventListener('click', () => {
      this.state.dispatch(actions.removeClip(clip.id));
    });
  }

  /**
   * Update time display
   * @param {number} timeMs
   */
  updateTimeDisplay(timeMs) {
    const timeDisplay = document.getElementById('timeDisplay');
    timeDisplay.textContent = formatTime(timeMs);
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
      this.state.loadFromJSON(saved);
      this.clearMediaCaches();
      this.hideExportCommand();
      this.updateStatus('Project loaded (reimport media files to preview)');
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
  }

  /**
   * Show project modal
   */
  showProjectModal() {
    if (!this.projectModal) return;

    const hasSaved = Boolean(localStorage.getItem('ytp-editor-project'));
    if (this.projectModalMessage) {
      this.projectModalMessage.textContent = hasSaved
        ? 'Start a new project or load the last saved project.'
        : 'No saved project found. Start a new project?';
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
      audioProbeStart: null,
    };

    if (info.hasVideo === null) {
      info.hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
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
   * Build an ffmpeg command that renders the timeline
   * @param {import('./core/types.js').EditorState} state
   * @returns {string|null}
   */
  buildFfmpegExportCommand(state) {
    const segments = this.getTopmostSegments(state);
    if (segments.length === 0) return null;

    this.exportAudioWarning = false;

    const mediaById = new Map(state.mediaLibrary.map(media => [media.id, media]));
    const inputList = [];
    const mediaIndexById = new Map();

    segments.forEach(segment => {
      if (!segment.clip) return;
      const media = mediaById.get(segment.clip.mediaId);
      if (!media) return;
      if (!mediaIndexById.has(media.id)) {
        mediaIndexById.set(media.id, inputList.length);
        inputList.push(media);
      }
    });

    if (inputList.length === 0) return null;

    const { width, height } = this.getExportResolution(state);
    const fps = 30;
    const filterParts = [];
    const segmentLabels = [];
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

    segments.forEach((segment, index) => {
      const vLabel = `v${index}`;
      const aLabel = `a${index}`;
      const durationMs = segment.end - segment.start;
      if (durationMs <= 0) return;

      if (segment.clip) {
        const media = mediaById.get(segment.clip.mediaId);
        if (!media) return;

        const inputIndex = mediaIndexById.get(media.id);
        const trimOffsetMs = segment.start - segment.clip.start;
        const sourceStartMs = (segment.clip.trimStart || 0) + trimOffsetMs;
        const startSec = this.formatSeconds(sourceStartMs);
        const endSec = this.formatSeconds(sourceStartMs + durationMs);
        const mediaInfo = this.mediaInfo ? this.mediaInfo.get(media.id) : null;
        const isAudioOnly = media.type && media.type.startsWith('audio/');
        const hasVideo = mediaInfo ? mediaInfo.hasVideo !== false : !isAudioOnly;
        let hasAudio = false;
        if (mediaInfo && mediaInfo.hasAudio !== null && mediaInfo.hasAudio !== undefined) {
          hasAudio = mediaInfo.hasAudio === true;
        } else if (isAudioOnly) {
          hasAudio = true;
        } else {
          this.exportAudioWarning = true;
        }

        if (hasVideo) {
          filterParts.push(
            `[${inputIndex}:v]trim=start=${startSec}:end=${endSec},` +
            `setpts=PTS-STARTPTS,${scaleFilter},format=yuv420p[${vLabel}]`
          );
        } else {
          const durationSec = this.formatSeconds(durationMs);
          filterParts.push(
            `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
            `format=yuv420p[${vLabel}]`
          );
        }

        if (hasAudio) {
          filterParts.push(
            `[${inputIndex}:a]atrim=start=${startSec}:end=${endSec},` +
            `asetpts=PTS-STARTPTS[${aLabel}]`
          );
        } else {
          const durationSec = this.formatSeconds(durationMs);
          filterParts.push(
            `anullsrc=channel_layout=stereo:sample_rate=44100:d=${durationSec}[${aLabel}]`
          );
        }
      } else {
        const durationSec = this.formatSeconds(durationMs);
        filterParts.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${durationSec},` +
          `format=yuv420p[${vLabel}]`
        );
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100:d=${durationSec}[${aLabel}]`
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

    return `ffmpeg ${inputs} -filter_complex "${filterComplex}" ` +
      `-map "[outv]" -map "[outa]" -movflags +faststart -y output.mp4`;
  }

  /**
   * Build topmost-visible segments for the timeline
   * @param {import('./core/types.js').EditorState} state
   * @returns {Array<{clip: import('./core/types.js').Clip|null, start: number, end: number}>}
   */
  getTopmostSegments(state) {
    const clips = state.clips;
    if (clips.length === 0) return [];

    const boundaries = new Set([0]);
    clips.forEach(clip => {
      boundaries.add(clip.start);
      boundaries.add(clip.start + clip.duration);
    });

    const times = Array.from(boundaries).sort((a, b) => a - b);
    const segments = [];

    for (let i = 0; i < times.length - 1; i++) {
      const start = times[i];
      const end = times[i + 1];
      if (end <= start) continue;

      const active = clips.filter(
        clip => start >= clip.start && start < clip.start + clip.duration
      );
      if (active.length === 0) {
        segments.push({ clip: null, start, end });
        continue;
      }

      let topmost = active[0];
      for (const clip of active) {
        if (clip.trackId < topmost.trackId) {
          topmost = clip;
        }
      }

      segments.push({ clip: topmost, start, end });
    }

    const merged = [];
    for (const segment of segments) {
      const last = merged[merged.length - 1];
      const sameClip = last && (
        (last.clip && segment.clip && last.clip.id === segment.clip.id) ||
        (!last.clip && !segment.clip)
      );
      if (sameClip) {
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

    // Clear canvas
    const width = this.previewCanvas.width;
    const height = this.previewCanvas.height;
    this.previewCtx.fillStyle = '#000';
    this.previewCtx.fillRect(0, 0, width, height);

    // Find topmost clip active at current playhead
    const activeClips = state.clips
      .filter(clip => playhead >= clip.start && playhead < clip.start + clip.duration);

    let topmostClip = null;
    for (const clip of activeClips) {
      if (!topmostClip || clip.trackId < topmostClip.trackId) {
        topmostClip = clip;
      }
    }

    const activeMediaIds = new Set();

    if (topmostClip) {
      const media = state.mediaLibrary.find(m => m.id === topmostClip.mediaId);

      if (media && this.mediaFiles && this.mediaFiles.has(media.id)) {
        const file = this.mediaFiles.get(media.id);

        // Get or create video element for this media
        if (!this.videoElements.has(media.id)) {
          const video = document.createElement('video');
          video.src = URL.createObjectURL(file);
          video.muted = false; // Enable audio
          video.preload = 'auto';
          video.volume = this.masterVolume;
          this.videoElements.set(media.id, video);
        }

        const video = this.videoElements.get(media.id);
        activeMediaIds.add(media.id);
        this.updateMediaInfoFromVideo(media.id, video);

        // Calculate time within clip (in seconds)
        const clipTime = (playhead - topmostClip.start + topmostClip.trimStart) / 1000;

        // Apply clip volume and mute settings (topmost clip gets audio)
        const clipVolume = topmostClip.volume !== undefined ? topmostClip.volume : 1.0;
        const isMuted = topmostClip.muted || false;
        const targetVolume = isMuted ? 0 : (clipVolume * this.masterVolume);
        video.volume = targetVolume;
        video.muted = targetVolume === 0;

        // Handle playback vs scrubbing
        if (state.isPlaying) {
          // During playback, play the video
          const timeDiff = Math.abs(video.currentTime - clipTime);
          if (timeDiff > 0.1) {
            video.currentTime = clipTime;
          }
          if (video.paused) {
            video.currentTime = clipTime;
            video.play().catch(() => {}); // Ignore autoplay errors
          }
        } else {
          // During scrubbing, pause and seek
          if (!video.paused) {
            video.pause();
          }

          // Only seek if difference is significant (more than 0.05 seconds)
          const timeDiff = Math.abs(video.currentTime - clipTime);
          if (timeDiff > 0.05) {
            // Throttle seeks - only seek if we haven't seeked recently
            const now = Date.now();
            if (!this.lastSeekTime || now - this.lastSeekTime > 50) {
              video.currentTime = clipTime;
              this.lastSeekTime = now;
            }
          }
        }

        // Draw video frame on canvas (only if ready)
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          // Calculate aspect-fit scaling
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = width / height;

          let drawWidth, drawHeight, drawX, drawY;

          if (videoAspect > canvasAspect) {
            // Video is wider
            drawWidth = width;
            drawHeight = width / videoAspect;
            drawX = 0;
            drawY = (height - drawHeight) / 2;
          } else {
            // Video is taller
            drawHeight = height;
            drawWidth = height * videoAspect;
            drawX = (width - drawWidth) / 2;
            drawY = 0;
          }

          // Draw the topmost clip's frame
          this.previewCtx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        }
      }
    } else {
      // No active clips, show placeholder
      this.previewCtx.fillStyle = '#666';
      this.previewCtx.font = '24px sans-serif';
      this.previewCtx.textAlign = 'center';
      this.previewCtx.textBaseline = 'middle';
      this.previewCtx.fillText('No clips at playhead', width / 2, height / 2);
    }

    // Pause any media that is not active to respect clip bounds
    if (this.videoElements) {
      this.videoElements.forEach((video, mediaId) => {
        if (!activeMediaIds.has(mediaId) && !video.paused) {
          video.pause();
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
