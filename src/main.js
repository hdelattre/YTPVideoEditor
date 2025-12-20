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
    this.reassociateInput = document.createElement('input');
    this.reassociateInput.type = 'file';
    this.reassociateInput.accept = 'video/*,audio/*';
    this.reassociateInput.hidden = true;
    document.body.appendChild(this.reassociateInput);

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
      const isAudioOnly = file.type.startsWith('audio/');
      const isVideoType = file.type.startsWith('video/');
      this.mediaInfo.set(mediaId, {
        hasAudio: metadata.hasAudio,
        hasVideo: metadata.hasVideo,
        isAudioOnly,
        isVideoType,
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
    const selectedIds = Array.isArray(state.selectedClipIds) && state.selectedClipIds.length > 0
      ? state.selectedClipIds
      : (state.selectedClipId ? [state.selectedClipId] : []);

    if (selectedIds.length === 0) {
      return { clip: null, signature: null };
    }

    const selectedClips = state.clips.filter(c => selectedIds.includes(c.id));
    if (selectedClips.length === 0) {
      return { clip: null, signature: null };
    }

    if (selectedClips.length === 1) {
      const clip = selectedClips[0];
      const signature = [
        clip.id,
        clip.name,
        clip.speed,
        clip.volume,
        clip.muted,
        clip.reversed,
        clip.color,
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
        clip.color,
      ].join(':'))
      .join('|');

    return { clip: null, signature };
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

    if (selectedIds.length === 0) {
      propertiesContent.innerHTML = '<p class="empty-message">Select a clip to edit properties</p>';
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
      const volumeValue = firstClip.volume !== undefined ? firstClip.volume : 1;
      const colorValue = firstClip.color || '#4a9eff';
      const muteMixed = !allSame(clip => Boolean(clip.muted));
      const reverseMixed = !allSame(clip => Boolean(clip.reversed));
      const speedMixed = !allSame(clip => clip.speed || 1);
      const volumeMixed = !allSame(clip => clip.volume !== undefined ? clip.volume : 1);
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
                 min="0" max="1" step="0.01" value="${volumeValue}">
          <div style="text-align: center; font-size: 12px; margin-top: 4px;">
            <span id="multi-volume-value">${Math.round(volumeValue * 100)}%</span>
          </div>
        </div>
        <div class="property-group">
          <input type="checkbox" class="property-checkbox" id="multi-muted">
          <label class="property-label" for="multi-muted">Mute Audio ${mixedTag(muteMixed)}</label>
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
      const reverseInput = document.getElementById('multi-reversed');

      if (muteInput) {
        muteInput.checked = selectedClips.every(clip => Boolean(clip.muted));
        muteInput.indeterminate = muteMixed;
        muteInput.addEventListener('change', (e) => {
          muteInput.indeterminate = false;
          this.state.dispatch(actions.updateClips(selectedIds, { muted: e.target.checked }));
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

      return;
    }

    const clip = state.clips.find(c => c.id === selectedIds[0]);
    if (!clip) return;

    const idPrefix = `clip-${clip.id}`;

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
        <label class="property-label" for="${idPrefix}-volume">Volume</label>
        <input type="range" class="property-slider" id="${idPrefix}-volume"
               min="0" max="1" step="0.01" value="${clip.volume !== undefined ? clip.volume : 1}">
        <div style="text-align: center; font-size: 12px; margin-top: 4px;">
          <span id="${idPrefix}-volume-value">${Math.round((clip.volume !== undefined ? clip.volume : 1) * 100)}%</span>
        </div>
      </div>
      <div class="property-group">
        <input type="checkbox" class="property-checkbox" id="${idPrefix}-muted"
               ${clip.muted ? 'checked' : ''}>
        <label class="property-label" for="${idPrefix}-muted">Mute Audio</label>
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

    document.getElementById(`${idPrefix}-reversed`).addEventListener('change', (e) => {
      this.state.dispatch(actions.reverseClip(clip.id));
    });

    document.getElementById(`${idPrefix}-color`).addEventListener('input', (e) => {
      this.state.dispatch(actions.updateClip(clip.id, { color: e.target.value }));
    });

    document.getElementById(`${idPrefix}-delete`).addEventListener('click', () => {
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
      this.state.loadFromJSON(saved);
      this.clearMediaCaches();
      this.hideExportCommand();
      this.pendingReassociateMediaId = null;
      this.lastPreviewVideoClipId = null;
      this.lastPreviewAudioClipId = null;
      this.lastPropertiesClipId = null;
      this.lastPropertiesSignature = null;
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

        const reverseVideo = segment.clip.reversed ? ',reverse' : '';
        const reverseAudio = segment.clip.reversed ? ',areverse' : '';

        if (hasVideo) {
          filterParts.push(
            `[${inputIndex}:v]trim=start=${startSec}:end=${endSec},` +
            `setpts=PTS-STARTPTS${reverseVideo},${scaleFilter},format=yuv420p[${vLabel}]`
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
            `asetpts=PTS-STARTPTS${reverseAudio}[${aLabel}]`
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
    const now = performance.now();

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
      let sourceOffset = clip.reversed ? (clipDuration - clipOffset) : clipOffset;
      if (clip.reversed && sourceOffset >= clipDuration) {
        sourceOffset = Math.max(0, clipDuration - 1);
      }
      sourceOffset = Math.max(0, Math.min(clipDuration, sourceOffset));
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
        video.muted = false; // Enable audio
        video.preload = 'auto';
        video.volume = this.masterVolume;
        this.videoElements.set(media.id, video);
      }
      const video = this.videoElements.get(media.id);
      this.updateMediaInfoFromVideo(media.id, video);
      return video;
    };

    const activeMediaIds = new Set();
    const shouldResync = this.hasExternalSeek === true;
    let didDrawFrame = false;

    const topmostAudioClip = getTopmostClip(activeClips);
    const videoCandidates = activeClips.filter((clip) => {
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
      const video = getVideoForMedia(audioClipMedia);
      const audioFile = this.mediaFiles.get(audioClipMedia.id);
      activeMediaIds.add(audioClipMedia.id);

      const clipTime = getClipTime(topmostAudioClip);
      const clipVolume = topmostAudioClip.volume !== undefined ? topmostAudioClip.volume : 1.0;
      const isMuted = topmostAudioClip.muted || false;
      const isReversed = topmostAudioClip.reversed === true;
      const targetVolume = isMuted ? 0 : (clipVolume * this.masterVolume);
      const clipChanged = this.lastPreviewAudioClipId !== topmostAudioClip.id;
      const shouldSeek = shouldResync || clipChanged || video.paused;

      video.volume = targetVolume;
      video.muted = targetVolume === 0 || isReversed;

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
            video.currentTime = clipTime;
          }
          if (video.paused) {
            video.play().catch(() => {}); // Ignore autoplay errors
          }
        }
      } else {
        this.stopReverseAudio();
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

      this.lastPreviewAudioClipId = topmostAudioClip.id;
    } else {
      this.stopReverseAudio();
      this.lastPreviewAudioClipId = null;
    }

    if (topmostVideoClip && videoClipMedia) {
      const video = getVideoForMedia(videoClipMedia);
      activeMediaIds.add(videoClipMedia.id);

      const clipTime = getClipTime(topmostVideoClip);
      const isReversed = topmostVideoClip.reversed === true;
      const clipChanged = this.lastPreviewVideoClipId !== topmostVideoClip.id;
      const shouldSeek = shouldResync || clipChanged || video.paused;

      if (!audioClipMedia || audioClipMedia.id !== videoClipMedia.id) {
        video.volume = 0;
        video.muted = true;
      }

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
