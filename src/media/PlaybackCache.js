/**
 * @fileoverview Playback cache for blob URLs and hidden media elements
 */

export class PlaybackCache {
  /**
   * @param {{ videoElements: Map<string, HTMLVideoElement>, audioElements: Map<string, HTMLVideoElement> }} params
   */
  constructor({ videoElements, audioElements }) {
    this.videoElements = videoElements;
    this.audioElements = audioElements;
    this.objectUrls = new Map();
  }

  /**
   * Get or create a blob URL for a media file
   * @param {string} mediaId
   * @param {File} file
   * @returns {string}
   */
  getObjectUrl(mediaId, file) {
    const existing = this.objectUrls.get(mediaId);
    if (existing) {
      return existing;
    }
    const url = URL.createObjectURL(file);
    this.objectUrls.set(mediaId, url);
    return url;
  }

  /**
   * Revoke a blob URL and reset cached media elements
   * @param {string} mediaId
   */
  revokeObjectUrl(mediaId) {
    const url = this.objectUrls.get(mediaId);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(mediaId);
    }

    if (this.videoElements && this.videoElements.has(mediaId)) {
      const video = this.videoElements.get(mediaId);
      try {
        video.pause();
      } catch (error) {
        // Ignore video pause errors
      }
      video.removeAttribute('src');
      video.load();
      this.videoElements.delete(mediaId);
    }

    if (this.audioElements && this.audioElements.has(mediaId)) {
      const audio = this.audioElements.get(mediaId);
      try {
        audio.pause();
      } catch (error) {
        // Ignore audio pause errors
      }
      audio.removeAttribute('src');
      audio.load();
      this.audioElements.delete(mediaId);
    }
  }

  /**
   * Clear all cached URLs and media elements
   */
  clearAll() {
    this.objectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.objectUrls.clear();

    if (this.videoElements) {
      this.videoElements.forEach((video) => {
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
      this.audioElements.forEach((audio) => {
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
  }
}
