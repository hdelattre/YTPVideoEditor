/**
 * @fileoverview Media library and import manager
 */

import * as actions from '../core/actions.js';
import { createId } from '../utils/id.js';

export class MediaManager {
  /**
   * @param {object} editor
   */
  constructor(editor) {
    this.editor = editor;
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

    for (const file of files) {
      this.editor.updateStatus(`Loading ${file.name}...`);

      // Get video metadata
      const metadata = await this.getVideoMetadata(file);

      if (!this.editor.mediaFiles) this.editor.mediaFiles = new Map();
      const isAudioOnly = file.type.startsWith('audio/');
      const isVideoType = file.type.startsWith('video/');

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
          type: file.type,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        }));
        this.editor.updateStatus(`Relinked ${file.name}`);
      } else {
        const existingMatch = this.findExistingMediaMatch(file, metadata);
        if (existingMatch) {
          this.editor.updateStatus(`${file.name} is already loaded`);
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
        this.editor.state.dispatch(actions.addMedia({
          id: mediaId,
          hash: mediaId, // For now, use ID as hash
          name: file.name,
          type: file.type,
          size: file.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
        }));

        this.editor.updateStatus(`Loaded ${file.name}`);
      }
    }

    // Clear file input
    e.target.value = '';
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

    return state.mediaLibrary.find((media) => {
      if (!this.editor.mediaFiles.has(media.id)) return false;
      if (media.name !== file.name) return false;
      if (media.size !== file.size) return false;
      if (media.type !== file.type) return false;
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
   * Render media library
   * @param {import('../core/types.js').EditorState} state
   */
  renderMediaLibrary(state) {
    const mediaList = document.getElementById('mediaList');
    if (!mediaList) return;
    mediaList.innerHTML = '';

    if (state.mediaLibrary.length === 0) {
      mediaList.innerHTML = `
        <div class="empty-state empty-state-media">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h6l2 2h8v10H4v-12Z"/><path d="M9 13h6M12 10v6"/></svg>
          <p>Your imported video and audio will appear here.</p>
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

    const isAudioOnly = file.type.startsWith('audio/');
    const isVideoType = file.type.startsWith('video/');
    this.editor.mediaInfo.set(mediaId, {
      hasAudio: metadata.hasAudio,
      hasVideo: metadata.hasVideo,
      isAudioOnly,
      isVideoType,
    });

    this.editor.state.dispatch(actions.updateMedia(mediaId, {
      name: file.name,
      type: file.type,
      size: file.size,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
    }));

    this.editor.updateStatus(`Relinked ${file.name}`);
    e.target.value = '';
  }

  /**
   * Add media to timeline
   * @param {import('../core/types.js').Media} media
   */
  addMediaToTimeline(media) {
    const state = this.editor.state.getState();

    // Add clip at playhead position on first track
    this.editor.state.dispatch(actions.addClip({
      name: media.name,
      mediaId: media.id,
      trackId: 0,
      start: state.playhead,
      duration: media.duration,
      color: '#586fc9',
    }));

    this.editor.updateStatus(`Added ${media.name} to timeline`);
  }
}
