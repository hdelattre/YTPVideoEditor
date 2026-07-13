/**
 * @fileoverview Media library and import manager
 */

import * as actions from '../core/actions.js';
import { createId } from '../utils/id.js';
import { MediaVisualGenerator } from './MediaVisualGenerator.js';

const MAX_CACHED_THUMBNAILS_PER_SOURCE = 256;
const MAX_THUMBNAIL_REQUEST_BATCH = 24;
const THUMBNAIL_TIME_QUANTUM_MS = 100;
const MEDIA_TYPE_BY_EXTENSION = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
};

export class MediaManager {
  /**
   * @param {object} editor
   */
  constructor(editor) {
    this.editor = editor;
    this.visualGenerator = new MediaVisualGenerator();
    this.analysisQueue = Promise.resolve();
    this.analysisGeneration = 0;
    this.analysisTokens = new Map();
    this.thumbnailRequestStates = new Map();
    this.thumbnailRefinementQueue = Promise.resolve();
  }

  /** Resolve a usable media MIME type when clipboard files omit File.type. */
  getMediaType(file) {
    const type = String(file && file.type ? file.type : '').toLowerCase();
    if (type.startsWith('video/') || type.startsWith('audio/')) return type;
    const extension = String(file && file.name ? file.name : '')
      .split('.')
      .pop()
      .toLowerCase();
    return MEDIA_TYPE_BY_EXTENSION[extension] || '';
  }

  /** Return whether a clipboard file belongs to the importer's media formats. */
  isImportableMediaFile(file) {
    return Boolean(file && this.getMediaType(file));
  }

  /** Classify a file consistently for metadata, playback, and derived visuals. */
  getFileMediaKind(file) {
    const type = this.getMediaType(file);
    return {
      type,
      isAudioOnly: type.startsWith('audio/'),
      isVideoType: type.startsWith('video/'),
    };
  }

  /** Release any closable derived frames promptly instead of waiting for garbage collection. */
  disposeMediaVisual(visual) {
    const frames = visual && visual.thumbnails && visual.thumbnails.frames;
    if (Array.isArray(frames)) {
      frames.forEach((frame) => {
        if (frame && typeof frame.close === 'function') frame.close();
      });
    }
  }

  /**
   * Queue local visual generation without blocking import or running heavy decodes in parallel.
   * @param {string} mediaId
   * @param {File} file
   * @param {{duration:number, hasAudio:boolean|null, hasVideo:boolean}} metadata
   */
  scheduleMediaVisualGeneration(mediaId, file, metadata) {
    if (!this.editor.mediaVisuals) this.editor.mediaVisuals = new Map();
    const fingerprint = `${file.name}:${file.size}:${file.lastModified || 0}:${metadata.duration || 0}`;
    const existing = this.editor.mediaVisuals.get(mediaId);
    if (existing && existing.fingerprint === fingerprint && existing.status === 'ready') return;
    if (existing) this.disposeMediaVisual(existing);
    this.thumbnailRequestStates.delete(mediaId);

    const generation = this.analysisGeneration;
    const token = Symbol(mediaId);
    this.analysisTokens.set(mediaId, token);
    this.editor.mediaVisuals.set(mediaId, {
      fingerprint,
      status: 'queued',
      version: 0,
      thumbnails: null,
      waveform: null,
    });

    const publish = (updates) => {
      if (generation !== this.analysisGeneration) return false;
      if (this.analysisTokens.get(mediaId) !== token) return false;
      const current = this.editor.mediaVisuals.get(mediaId) || { fingerprint };
      const visualChanged = Object.prototype.hasOwnProperty.call(updates, 'thumbnails')
        || Object.prototype.hasOwnProperty.call(updates, 'waveform');
      this.editor.mediaVisuals.set(mediaId, {
        ...current,
        ...updates,
        fingerprint,
        version: (current.version || 0) + (visualChanged ? 1 : 0),
      });
      if (visualChanged && this.editor.timeline) {
        this.editor.timeline.render(this.editor.state.getState());
      }
      return true;
    };

    const analyze = async () => {
      if (!publish({ status: 'processing' })) return;
      const isAudioFile = this.getFileMediaKind(file).isAudioOnly;
      const shouldGenerateThumbnails = metadata.hasVideo && !isAudioFile;
      // A video with confirmed or unknown audio gets a waveform attempt. Only a reliable
      // negative signal skips decoding, avoiding false negatives on browsers without track APIs.
      const shouldGenerateWaveform = isAudioFile || metadata.hasAudio !== false;

      if (shouldGenerateThumbnails) {
        try {
          const thumbnails = await this.visualGenerator.generateThumbnails(
            file,
            metadata,
            () => generation === this.analysisGeneration
              && this.analysisTokens.get(mediaId) === token
          );
          if (thumbnails && !publish({ thumbnails })) {
            this.disposeMediaVisual({ thumbnails });
            return;
          }
        } catch (error) {
          console.warn(`Could not generate thumbnails for ${file.name}:`, error);
        }
      }

      if (generation !== this.analysisGeneration || this.analysisTokens.get(mediaId) !== token) {
        return;
      }

      if (shouldGenerateWaveform) {
        try {
          const waveform = await this.visualGenerator.generateWaveform(file);
          if (waveform && !publish({ waveform })) return;
        } catch (error) {
          // Some browsers cannot pass a video's audio track through decodeAudioData.
          console.warn(`Could not generate waveform for ${file.name}:`, error);
        }
      }

      publish({ status: 'ready' });
    };

    this.analysisQueue = this.analysisQueue
      .catch(() => {})
      .then(analyze);
  }

  /** Normalize nearby viewport requests so repeated renders share one capture. */
  getThumbnailTimeKey(timeMs) {
    return Math.round(timeMs / THUMBNAIL_TIME_QUANTUM_MS) * THUMBNAIL_TIME_QUANTUM_MS;
  }

  /** Preserve exact captured positions independently from request deduplication buckets. */
  getThumbnailCacheKey(timeMs) {
    return String(Math.round(timeMs * 1000) / 1000);
  }

  /** Create per-source refinement bookkeeping without reopening a decoder. */
  getThumbnailRequestState(mediaId, visual, thumbnails) {
    let requestState = this.thumbnailRequestStates.get(mediaId);
    if (requestState && requestState.fingerprint === visual.fingerprint) return requestState;

    requestState = {
      fingerprint: visual.fingerprint,
      desired: new Map(),
      pending: new Map(),
      failedKeys: new Set(),
      cacheOrder: (thumbnails.sampleTimesMs || []).map(
        timeMs => this.getThumbnailCacheKey(timeMs)
      ),
      revision: 0,
      processing: false,
    };
    this.thumbnailRequestStates.set(mediaId, requestState);
    return requestState;
  }

  /**
   * Replace queued refinement work with the latest complete viewport request set.
   * Duplicate cuts share one set, and superseded zoom/scroll positions are discarded.
   * @param {Map<string, number[]>} requestsByMedia
   */
  updateVisibleThumbnailRequests(requestsByMedia) {
    const visibleRequests = requestsByMedia instanceof Map ? requestsByMedia : new Map();

    this.thumbnailRequestStates.forEach((requestState, mediaId) => {
      if (visibleRequests.has(mediaId) || requestState.desired.size === 0) return;
      requestState.revision += 1;
      requestState.desired = new Map();
      requestState.pending = new Map();
    });

    visibleRequests.forEach((timesMs, mediaId) => {
      if (!Array.isArray(timesMs)) return;
      const visual = this.editor.mediaVisuals && this.editor.mediaVisuals.get(mediaId);
      const thumbnails = visual && visual.thumbnails;
      const file = this.editor.mediaFiles && this.editor.mediaFiles.get(mediaId);
      if (!thumbnails || !file) return;

      const requestState = this.getThumbnailRequestState(mediaId, visual, thumbnails);
      const durationMs = Math.max(0, Number(thumbnails.durationMs) || 0);
      const cachedTimes = Array.isArray(thumbnails.sampleTimesMs)
        ? thumbnails.sampleTimesMs
        : [];
      const desired = new Map();
      timesMs.forEach((requestedTimeMs) => {
        if (!Number.isFinite(requestedTimeMs)) return;
        const timeMs = Math.max(0, Math.min(durationMs, requestedTimeMs));
        const key = this.getThumbnailTimeKey(timeMs);
        if (desired.has(key)
            || requestState.failedKeys.has(key)
            || cachedTimes.some(
              cachedTime => Math.abs(cachedTime - timeMs) <= THUMBNAIL_TIME_QUANTUM_MS
            )) return;
        desired.set(key, timeMs);
      });

      let requestsChanged = desired.size !== requestState.desired.size;
      if (!requestsChanged) {
        for (const key of desired.keys()) {
          if (!requestState.desired.has(key)) {
            requestsChanged = true;
            break;
          }
        }
      }
      if (requestsChanged) {
        requestState.revision += 1;
        requestState.desired = desired;
        requestState.pending = new Map(desired);
      }

      if (requestState.pending.size > 0 && !requestState.processing) {
        this.enqueueThumbnailRequestProcessing(mediaId, requestState);
      }
    });
  }

  /** Run only one viewport-refinement decoder at a time across all sources. */
  enqueueThumbnailRequestProcessing(mediaId, requestState) {
    if (requestState.processing) return;
    requestState.processing = true;
    this.thumbnailRefinementQueue = this.thumbnailRefinementQueue
      .catch(() => {})
      .then(() => this.processThumbnailRequests(mediaId, requestState));
  }

  /** Capture pending visible timestamps through one reusable decoder session. */
  async processThumbnailRequests(mediaId, requestState) {
    const generation = this.analysisGeneration;
    const file = this.editor.mediaFiles && this.editor.mediaFiles.get(mediaId);
    const media = this.editor.state.getState().mediaLibrary.find(item => item.id === mediaId);
    let session = null;
    let currentBatch = [];

    try {
      if (!file || !media || requestState.pending.size === 0) {
        requestState.pending.clear();
        return;
      }
      session = await this.visualGenerator.createThumbnailSession(file, {
        duration: media.duration,
      });
      if (!session) {
        requestState.desired.forEach((_, key) => requestState.failedKeys.add(key));
        requestState.desired.clear();
        requestState.pending.clear();
        return;
      }

      while (requestState.pending.size > 0) {
        if (generation !== this.analysisGeneration
            || this.thumbnailRequestStates.get(mediaId) !== requestState) break;
        const batchRevision = requestState.revision;
        currentBatch = Array.from(requestState.pending.entries())
          .slice(0, MAX_THUMBNAIL_REQUEST_BATCH);
        currentBatch.forEach(([key]) => requestState.pending.delete(key));
        const result = await session.captureTimes(
          currentBatch.map(([, timeMs]) => timeMs),
          () => generation === this.analysisGeneration
            && this.thumbnailRequestStates.get(mediaId) === requestState
            && requestState.revision === batchRevision
        );
        if (generation !== this.analysisGeneration
            || this.thumbnailRequestStates.get(mediaId) !== requestState) {
          this.disposeMediaVisual({ thumbnails: result });
          break;
        }
        if (Array.isArray(result.failedTimesMs)) {
          result.failedTimesMs.forEach((timeMs) => {
            requestState.failedKeys.add(this.getThumbnailTimeKey(timeMs));
          });
        }
        this.mergeThumbnailFrames(mediaId, result, requestState);
        currentBatch = [];
      }
    } catch (error) {
      currentBatch.forEach(([key]) => requestState.failedKeys.add(key));
      requestState.desired.clear();
      requestState.pending.clear();
      console.warn(`Could not refine thumbnails for ${media ? media.name : mediaId}:`, error);
    } finally {
      if (session) session.close();
      requestState.processing = false;
      if (generation === this.analysisGeneration
          && this.thumbnailRequestStates.get(mediaId) === requestState
          && requestState.pending.size > 0) {
        this.enqueueThumbnailRequestProcessing(mediaId, requestState);
      }
    }
  }

  /** Merge newly captured timestamps and evict the oldest cached frames over the cap. */
  mergeThumbnailFrames(mediaId, result, requestState) {
    if (!result || !result.frames || result.frames.length === 0) return;
    const visual = this.editor.mediaVisuals.get(mediaId);
    if (!visual || !visual.thumbnails) {
      this.disposeMediaVisual({ thumbnails: result });
      return;
    }

    const thumbnails = visual.thumbnails;
    const samples = new Map();
    thumbnails.sampleTimesMs.forEach((timeMs, index) => {
      samples.set(this.getThumbnailCacheKey(timeMs), {
        timeMs,
        frame: thumbnails.frames[index],
      });
    });

    result.sampleTimesMs.forEach((timeMs, index) => {
      const key = this.getThumbnailCacheKey(timeMs);
      if (samples.has(key)) {
        const duplicate = result.frames[index];
        if (duplicate && typeof duplicate.close === 'function') duplicate.close();
        return;
      }
      samples.set(key, { timeMs, frame: result.frames[index] });
      requestState.cacheOrder.push(key);
    });

    while (samples.size > MAX_CACHED_THUMBNAILS_PER_SOURCE
        && requestState.cacheOrder.length > 0) {
      const oldestKey = requestState.cacheOrder.shift();
      const evicted = samples.get(oldestKey);
      if (!evicted) continue;
      if (evicted.frame && typeof evicted.frame.close === 'function') evicted.frame.close();
      samples.delete(oldestKey);
    }

    const sortedSamples = Array.from(samples.values()).sort((a, b) => a.timeMs - b.timeMs);
    this.editor.mediaVisuals.set(mediaId, {
      ...visual,
      version: (visual.version || 0) + 1,
      thumbnails: {
        ...thumbnails,
        frames: sortedSamples.map(sample => sample.frame),
        sampleTimesMs: sortedSamples.map(sample => sample.timeMs),
      },
    });
    if (this.editor.timeline) {
      this.editor.timeline.render(this.editor.state.getState());
    }
  }

  /** Cancel queued analysis and release session-only derived visuals. */
  clearMediaVisuals() {
    this.analysisGeneration += 1;
    this.analysisTokens.clear();
    this.thumbnailRequestStates.clear();
    this.analysisQueue = Promise.resolve();
    if (this.editor.mediaVisuals) {
      this.editor.mediaVisuals.forEach(visual => this.disposeMediaVisual(visual));
      this.editor.mediaVisuals.clear();
    }
    if (this.editor.timeline) {
      this.editor.timeline.render(this.editor.state.getState());
    }
  }

  /**
   * Return duration mismatch details, ignoring harmless metadata drift.
   * @param {number} expectedMs
   * @param {number} actualMs
   * @returns {{expectedMs: number, actualMs: number, differenceMs: number}|null}
   */
  getDurationMismatch(expectedMs, actualMs) {
    if (!Number.isFinite(expectedMs) || expectedMs <= 0) return null;
    if (!Number.isFinite(actualMs) || actualMs <= 0) return null;
    const differenceMs = Math.abs(expectedMs - actualMs);
    const toleranceMs = Math.max(500, Math.min(2000, expectedMs * 0.002));
    return differenceMs > toleranceMs
      ? { expectedMs, actualMs, differenceMs }
      : null;
  }

  /**
   * Format a media duration for comparison UI.
   * @param {number} durationMs
   * @returns {string}
   */
  formatDuration(durationMs) {
    const totalSeconds = Math.max(0, durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const secondsText = seconds.toFixed(2).padStart(5, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
      : `${minutes}:${secondsText}`;
  }

  /**
   * Show the in-app duration mismatch decision.
   * @param {import('../core/types.js').Media} expectedMedia
   * @param {File} file
   * @param {{duration: number}} metadata
   * @param {{allowImportAsNew?: boolean}} [options]
   * @returns {Promise<'use'|'new'|'cancel'>}
   */
  showDurationMismatch(expectedMedia, file, metadata, options = {}) {
    const modal = document.getElementById('mediaMismatchModal');
    const message = document.getElementById('mediaMismatchMessage');
    const expected = document.getElementById('mediaMismatchExpected');
    const actual = document.getElementById('mediaMismatchActual');
    const useBtn = document.getElementById('mediaMismatchUseBtn');
    const newBtn = document.getElementById('mediaMismatchNewBtn');
    const cancelBtn = document.getElementById('mediaMismatchCancelBtn');
    const closeBtn = document.getElementById('mediaMismatchCloseBtn');
    if (!modal || !message || !expected || !actual || !useBtn || !newBtn || !cancelBtn || !closeBtn) {
      return Promise.resolve('cancel');
    }

    message.textContent = `${file.name} is a different length from the saved source ${expectedMedia.name}.`;
    expected.textContent = this.formatDuration(expectedMedia.duration);
    actual.textContent = this.formatDuration(metadata.duration);
    newBtn.hidden = !options.allowImportAsNew;
    modal.style.display = 'flex';
    useBtn.focus();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (choice) => {
        if (settled) return;
        settled = true;
        modal.style.display = 'none';
        useBtn.onclick = null;
        newBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        modal.onclick = null;
        document.removeEventListener('keydown', onKeyDown);
        resolve(choice);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') finish('cancel');
      };
      useBtn.onclick = () => finish('use');
      newBtn.onclick = () => finish('new');
      cancelBtn.onclick = () => finish('cancel');
      closeBtn.onclick = () => finish('cancel');
      modal.onclick = (event) => {
        if (event.target === modal) finish('cancel');
      };
      document.addEventListener('keydown', onKeyDown);
    });
  }

  /**
   * Handle file import
   * @param {Event} e
   */
  async handleFileImport(e) {
    const files = Array.from(e.target.files || []);
    try {
      await this.importFiles(files);
    } finally {
      // Selecting the same file again should still fire change after a failure.
      e.target.value = '';
    }
  }

  /**
   * Import media files through the shared file picker/clipboard pipeline.
   * @param {File[]} files
   * @returns {Promise<import('../core/types.js').Media[]>}
   */
  async importFiles(files) {
    const importedMedia = [];

    for (const file of files) {
      this.editor.updateStatus(`Loading ${file.name}...`);

      // Get video metadata
      const metadata = await this.getVideoMetadata(file);

      if (!this.editor.mediaFiles) this.editor.mediaFiles = new Map();
      const { type: mediaType, isAudioOnly, isVideoType } = this.getFileMediaKind(file);

      let missingMatch = this.findMissingMediaMatch(file, metadata);
      const sameNameMissing = missingMatch || this.findMissingMediaNameMatch(file);
      const mismatch = sameNameMissing
        ? this.getDurationMismatch(sameNameMissing.duration, metadata.duration)
        : null;
      if (sameNameMissing && mismatch) {
        const choice = await this.showDurationMismatch(sameNameMissing, file, metadata, {
          allowImportAsNew: true,
        });
        if (choice === 'cancel') continue;
        missingMatch = choice === 'use' ? sameNameMissing : null;
      }
      if (missingMatch) {
        const mediaId = missingMatch.id;
        this.editor.playbackCache.revokeObjectUrl(mediaId);
        this.editor.mediaFiles.set(mediaId, file);
        this.editor.mediaInfo.set(mediaId, {
          hasAudio: metadata.hasAudio,
          hasVideo: metadata.hasVideo,
          isAudioOnly,
          isVideoType,
        });
        this.editor.state.dispatch(actions.updateMedia(mediaId, {
          name: file.name,
          type: mediaType,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        }));
        this.scheduleMediaVisualGeneration(mediaId, file, metadata);
        const updatedMedia = this.editor.state.getState().mediaLibrary
          .find(media => media.id === mediaId);
        if (updatedMedia) importedMedia.push(updatedMedia);
        this.editor.updateStatus(`Relinked ${file.name}`);
      } else {
        const existingMatch = this.findExistingMediaMatch(file, metadata);
        if (existingMatch) {
          this.editor.updateStatus(`${file.name} is already loaded`);
          importedMedia.push(existingMatch);
          continue;
        }
        // Add to media library
        const mediaId = createId();
        // Ensure render sees the file as present on the first state update.
        this.editor.mediaFiles.set(mediaId, file);
        this.editor.mediaInfo.set(mediaId, {
          hasAudio: metadata.hasAudio,
          hasVideo: metadata.hasVideo,
          isAudioOnly,
          isVideoType,
        });
        const media = {
          id: mediaId,
          hash: mediaId, // For now, use ID as hash
          name: file.name,
          type: mediaType,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        };
        this.editor.state.dispatch(actions.addMedia(media));
        this.scheduleMediaVisualGeneration(mediaId, file, metadata);
        importedMedia.push(media);

        this.editor.updateStatus(`Loaded ${file.name}`);
      }
    }

    return importedMedia;
  }

  /**
   * Find a missing media entry that matches an imported file
   * @param {File} file
   * @param {{duration: number, width: number, height: number}} metadata
   * @returns {import('../core/types.js').Media|null}
   */
  findMissingMediaMatch(file, metadata) {
    const state = this.editor.state.getState();
    if (!state.mediaLibrary || state.mediaLibrary.length === 0) return null;
    const mediaType = this.getMediaType(file);

    let best = null;
    let bestScore = -1;

    state.mediaLibrary.forEach((media) => {
      if (this.editor.mediaFiles && this.editor.mediaFiles.has(media.id)) return;
      if (media.name !== file.name) return;

      const sizeMatch = media.size === file.size;
      const durationMatch = media.duration && metadata.duration
        ? Math.abs(media.duration - metadata.duration) < 100
        : false;
      if (!sizeMatch && !durationMatch) return;

      let score = 3;
      if (sizeMatch) score += 2;
      if (durationMatch) score += 1;
      if (media.type && media.type === mediaType) score += 1;
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
   * Find an unloaded saved source with the same filename, even when metadata differs.
   * @param {File} file
   * @returns {import('../core/types.js').Media|null}
   */
  findMissingMediaNameMatch(file) {
    const state = this.editor.state.getState();
    if (!state.mediaLibrary || state.mediaLibrary.length === 0) return null;
    return state.mediaLibrary.find((media) => {
      const isLoaded = this.editor.mediaFiles && this.editor.mediaFiles.has(media.id);
      return !isLoaded && media.name === file.name;
    }) || null;
  }

  /**
   * Find an existing loaded media entry that matches an imported file
   * @param {File} file
   * @param {{duration: number, width: number, height: number}} metadata
   * @returns {import('../core/types.js').Media|null}
   */
  findExistingMediaMatch(file, metadata) {
    const state = this.editor.state.getState();
    if (!state.mediaLibrary || state.mediaLibrary.length === 0) return null;
    if (!this.editor.mediaFiles) return null;

    const duration = Number.isFinite(metadata.duration) && metadata.duration > 0
      ? metadata.duration
      : null;
    const mediaType = this.getMediaType(file);

    return state.mediaLibrary.find((media) => {
      if (!this.editor.mediaFiles.has(media.id)) return false;
      if (media.name !== file.name) return false;
      if (media.size !== file.size) return false;
      if (media.type !== mediaType) return false;
      if (duration !== null && Number.isFinite(media.duration) && media.duration > 0) {
        return Math.abs(media.duration - duration) < 100;
      }
      return true;
    }) || null;
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
      const { isAudioOnly, isVideoType } = this.getFileMediaKind(file);

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
   * Render media library
   * @param {import('../core/types.js').EditorState} state
   */
  renderMediaLibrary(state) {
    const mediaList = document.getElementById('mediaList');
    if (!mediaList) return;
    const isEmpty = !state.mediaLibrary || state.mediaLibrary.length === 0;
    const importButton = document.getElementById('importBtn');
    const mobileMediaButton = document.getElementById('mobileMediaPanelBtn');
    importButton?.classList.toggle('is-first-step', isEmpty);
    mobileMediaButton?.classList.toggle('is-first-step', isEmpty);
    const importLabel = importButton?.querySelector('span');
    if (importLabel) importLabel.textContent = isEmpty ? 'Import your first clip' : 'Import media';
    if (mobileMediaButton) {
      const mobileLabel = isEmpty ? 'Open media to import your first clip' : 'Media library';
      mobileMediaButton.title = mobileLabel;
      mobileMediaButton.setAttribute('aria-label', mobileLabel);
    }
    mediaList.innerHTML = '';

    if (isEmpty) {
      mediaList.innerHTML = `
        <div class="empty-state empty-state-media">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h6l2 2h8v10H4v-12Z"/><path d="M9 13h6M12 10v6"/></svg>
          <p>Import a video or audio file to start editing.</p>
        </div>
      `;
      return;
    }

    state.mediaLibrary.forEach(media => {
      const isMissing = !this.editor.mediaFiles || !this.editor.mediaFiles.has(media.id);
      const isSelected = !isMissing && state.selectedMediaId === media.id;
      const item = document.createElement('div');
      item.className = `media-item${isMissing ? ' missing' : ''}${isSelected ? ' selected' : ''}`;
      item.draggable = !isMissing;
      if (isMissing) {
        item.title = 'File missing - click to relink';
      }

      const header = document.createElement('div');
      header.className = 'media-item-header';

      const typeIcon = document.createElement('span');
      const isAudio = Boolean(media.type && media.type.startsWith('audio/'));
      typeIcon.className = `media-item-type ${isAudio ? 'is-audio' : 'is-video'}`;
      typeIcon.innerHTML = isAudio
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h2l1.5-5 3 10 2.5-8 2 6 1-3h2"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>';
      header.appendChild(typeIcon);

      const details = document.createElement('div');
      details.className = 'media-item-details';
      header.appendChild(details);

      const name = document.createElement('div');
      name.className = 'media-item-name';
      name.textContent = media.name;
      details.appendChild(name);

      if (isMissing) {
        const badge = document.createElement('span');
        badge.className = 'media-item-missing';
        badge.textContent = 'Missing';
        header.appendChild(badge);
      } else {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-icon btn-sm media-item-add mobile-only';
        addBtn.textContent = '+';
        addBtn.title = 'Add to timeline';
        addBtn.setAttribute('aria-label', `Add ${media.name} to timeline`);
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addMediaToTimeline(media);
        });
        header.appendChild(addBtn);
      }

      const info = document.createElement('div');
      info.className = 'media-item-info';
      const durationSec = Math.round(media.duration / 1000);
      const durationMinutes = Math.floor(durationSec / 60);
      const durationRemainder = String(durationSec % 60).padStart(2, '0');
      const sizeMB = (media.size / 1024 / 1024).toFixed(2);
      const mediaKind = isAudio
        ? 'Audio'
        : (media.width && media.height ? `${media.width}×${media.height}` : 'Video');
      info.textContent = `${durationMinutes}:${durationRemainder} · ${mediaKind} · ${sizeMB} MB`;
      details.appendChild(info);

      item.appendChild(header);

      // Double-click to add to timeline
      if (!isMissing) {
        item.addEventListener('dblclick', () => {
          this.addMediaToTimeline(media);
        });
      }

      if (isMissing) {
        item.addEventListener('click', () => {
          this.requestMediaReassociate(media);
          this.editor.state.dispatch(actions.selectMedia(null));
        });
      } else {
        item.addEventListener('click', () => {
          this.editor.state.dispatch(actions.selectMedia(media.id));
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
   * @param {import('../core/types.js').Media} media
   */
  requestMediaReassociate(media) {
    if (!this.editor.reassociateInput) return;
    this.editor.pendingReassociateMediaId = media.id;
    this.editor.reassociateInput.value = '';
    this.editor.reassociateInput.click();
  }

  /**
   * Handle relinked media file selection
   * @param {Event} e
   */
  async handleReassociateFile(e) {
    const file = e.target.files && e.target.files[0];
    const mediaId = this.editor.pendingReassociateMediaId;
    this.editor.pendingReassociateMediaId = null;

    if (!file || !mediaId) {
      return;
    }

    this.editor.updateStatus(`Relinking ${file.name}...`);
    const metadata = await this.getVideoMetadata(file);
    const expectedMedia = this.editor.state.getState().mediaLibrary.find(media => media.id === mediaId);
    const mismatch = expectedMedia
      ? this.getDurationMismatch(expectedMedia.duration, metadata.duration)
      : null;
    if (expectedMedia && mismatch) {
      const choice = await this.showDurationMismatch(expectedMedia, file, metadata);
      if (choice !== 'use') {
        this.editor.updateStatus(`Relink cancelled for ${expectedMedia.name}`);
        e.target.value = '';
        return;
      }
    }

    if (!this.editor.mediaFiles) this.editor.mediaFiles = new Map();
    this.editor.playbackCache.revokeObjectUrl(mediaId);
    this.editor.mediaFiles.set(mediaId, file);

    const { type: mediaType, isAudioOnly, isVideoType } = this.getFileMediaKind(file);
    this.editor.mediaInfo.set(mediaId, {
      hasAudio: metadata.hasAudio,
      hasVideo: metadata.hasVideo,
      isAudioOnly,
      isVideoType,
    });

    this.editor.state.dispatch(actions.updateMedia(mediaId, {
      name: file.name,
      type: mediaType,
      size: file.size,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
    }));
    this.scheduleMediaVisualGeneration(mediaId, file, metadata);

    this.editor.updateStatus(`Relinked ${file.name}`);
    e.target.value = '';
  }

  /**
   * Add media to timeline
   * @param {import('../core/types.js').Media} media
   * @param {{start?: number, trackId?: number|string, quiet?: boolean}} [options]
   * @returns {boolean}
   */
  addMediaToTimeline(media, options = {}) {
    const state = this.editor.state.getState();
    const requestedTrack = options.trackId === undefined
      ? null
      : state.tracks.find(track => track.id === options.trackId);
    const targetTrack = requestedTrack
      || state.tracks.find(track => !track.locked && track.visible !== false);
    if (!targetTrack || targetTrack.locked || targetTrack.visible === false) return false;
    const start = Number.isFinite(options.start) ? Math.max(0, options.start) : state.playhead;

    this.editor.state.dispatch(actions.addClip({
      name: media.name,
      mediaId: media.id,
      trackId: targetTrack.id,
      start,
      duration: media.duration,
      color: '#3f7182',
    }));

    if (!options.quiet) this.editor.updateStatus(`Added ${media.name} to timeline`);
    return true;
  }

  /** Import pasted files and lay their clips out sequentially from the playhead. */
  async addPastedFilesToTimeline(files) {
    const mediaItems = await this.importFiles(files);
    if (mediaItems.length === 0) return 0;

    const state = this.editor.state.getState();
    const targetTrack = state.tracks.find(track => !track.locked && track.visible !== false);
    if (!targetTrack) {
      this.editor.updateStatus('Unlock or show a track before pasting media');
      return 0;
    }

    let insertTime = state.playhead;
    let added = 0;
    mediaItems.forEach((media) => {
      const didAdd = this.addMediaToTimeline(media, {
        start: insertTime,
        trackId: targetTrack.id,
        quiet: true,
      });
      if (!didAdd) return;
      added += 1;
      const duration = Number(media.duration);
      if (Number.isFinite(duration) && duration > 0) insertTime += duration;
    });

    if (added > 0) {
      this.editor.updateStatus(`Pasted ${added} media clip${added === 1 ? '' : 's'} to timeline`);
    }
    return added;
  }
}
