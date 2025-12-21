/**
 * @fileoverview Media library and upload manager
 */

import * as actions from '../core/actions.js';

export class MediaManager {
  /**
   * @param {object} editor
   */
  constructor(editor) {
    this.editor = editor;
  }

  /**
   * Handle file upload
   * @param {Event} e
   */
  async handleFileUpload(e) {
    const files = Array.from(e.target.files || []);

    for (const file of files) {
      this.editor.updateStatus(`Loading ${file.name}...`);

      // Get video metadata
      const metadata = await this.getVideoMetadata(file);

      if (!this.editor.mediaFiles) this.editor.mediaFiles = new Map();
      const isAudioOnly = file.type.startsWith('audio/');
      const isVideoType = file.type.startsWith('video/');

      const missingMatch = this.findMissingMediaMatch(file, metadata);
      if (missingMatch) {
        const mediaId = missingMatch.id;
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
        // Add to media library
        const mediaId = crypto.randomUUID();
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
          uploadedAt: Date.now(),
        }));

        this.editor.updateStatus(`Loaded ${file.name}`);
      }
    }

    // Clear file input
    e.target.value = '';
  }

  /**
   * Find a missing media entry that matches an uploaded file
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
      mediaList.innerHTML = '<p class="empty-message">No media files yet</p>';
      return;
    }

    state.mediaLibrary.forEach(media => {
      const isMissing = !this.editor.mediaFiles || !this.editor.mediaFiles.has(media.id);
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

    if (!this.editor.mediaFiles) this.editor.mediaFiles = new Map();
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
      color: '#4a9eff',
    }));

    this.editor.updateStatus(`Added ${media.name} to timeline`);
  }
}
