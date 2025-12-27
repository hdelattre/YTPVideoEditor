/**
 * @fileoverview Abstract Renderer interface
 * Allows swapping between Canvas2D and WebGL implementations
 */

/**
 * Abstract base class for renderers
 * Subclasses must implement all abstract methods
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    if (new.target === Renderer) {
      throw new Error('Cannot instantiate abstract class Renderer');
    }

    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  /**
   * Draw a clip on the timeline
   * @abstract
   * @param {import('../core/types.js').Clip} clip
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @param {boolean} selected - Is clip selected
   */
  drawClip(clip, x, y, width, height, selected) {
    throw new Error('drawClip must be implemented by subclass');
  }

  /**
   * Draw audio waveform
   * @abstract
   * @param {Float32Array} audioData - Audio samples
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   * @param {string} color - Waveform color
   */
  drawWaveform(audioData, x, y, width, height, color) {
    throw new Error('drawWaveform must be implemented by subclass');
  }

  /**
   * Draw video thumbnail/filmstrip
   * @abstract
   * @param {ImageBitmap|VideoFrame} frame
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  drawThumbnail(frame, x, y, width, height) {
    throw new Error('drawThumbnail must be implemented by subclass');
  }

  /**
   * Draw playhead indicator
   * @abstract
   * @param {number} x - X position
   * @param {number} height - Height of playhead line
   * @param {string} color - Playhead color
   */
  drawPlayhead(x, height, color) {
    throw new Error('drawPlayhead must be implemented by subclass');
  }

  /**
   * Draw time ruler
   * @abstract
   * @param {number} startTime - Start time in ms
   * @param {number} endTime - End time in ms
   * @param {number} pixelsPerMs - Pixels per millisecond
   * @param {number} height - Ruler height
   */
  drawTimeRuler(startTime, endTime, pixelsPerMs, height) {
    throw new Error('drawTimeRuler must be implemented by subclass');
  }

  /**
   * Draw track background
   * @abstract
   * @param {number} y - Y position
   * @param {number} width - Width
   * @param {number} height - Track height
   * @param {boolean} alternate - Use alternate color
   */
  drawTrackBackground(y, width, height, alternate) {
    throw new Error('drawTrackBackground must be implemented by subclass');
  }

  /**
   * Draw selection rectangle
   * @abstract
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  drawSelectionRect(x, y, width, height) {
    throw new Error('drawSelectionRect must be implemented by subclass');
  }

  /**
   * Clear the entire canvas
   * @abstract
   */
  clear() {
    throw new Error('clear must be implemented by subclass');
  }

  /**
   * Resize canvas and renderer
   * @abstract
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    throw new Error('resize must be implemented by subclass');
  }

  /**
   * Save canvas state
   * @abstract
   */
  save() {
    throw new Error('save must be implemented by subclass');
  }

  /**
   * Restore canvas state
   * @abstract
   */
  restore() {
    throw new Error('restore must be implemented by subclass');
  }
}
