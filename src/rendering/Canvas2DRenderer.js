/**
 * @fileoverview Canvas 2D renderer implementation
 */

import { Renderer } from './Renderer.js';
import { COLORS } from '../core/constants.js';

/**
 * Canvas2D implementation of the Renderer interface
 */
export class Canvas2DRenderer extends Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    super(canvas);

    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true, // Hint for better performance
    });

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  /**
   * Draw a clip on the timeline
   * @param {import('../core/types.js').Clip} clip
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {boolean} selected
   */
  drawClip(clip, x, y, width, height, selected) {
    const ctx = this.ctx;

    // Draw clip background
    ctx.fillStyle = selected ? COLORS.clipSelected : (clip.color || COLORS.clipDefault);
    ctx.fillRect(x, y, width, height);

    // Draw clip border
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x, y, width, height);

    // Draw clip name
    ctx.fillStyle = COLORS.clipText;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'top';

    // Clip text to avoid overflow
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 4, y + 4, width - 8, height - 8);
    ctx.clip();

    ctx.fillText(clip.name, x + 6, y + 6);

    // Draw speed indicator if not 1.0
    if (clip.speed && clip.speed !== 1.0) {
      ctx.fillText(`${clip.speed}x`, x + 6, y + 22);
    }

    // Draw reverse indicator
    if (clip.reversed) {
      ctx.fillText('◄', x + width - 20, y + 6);
    }

    ctx.restore();

    // Draw trim handles if selected
    if (selected && width > 20) {
      ctx.fillStyle = '#ffffff';
      // Left handle
      ctx.fillRect(x, y, 3, height);
      // Right handle
      ctx.fillRect(x + width - 3, y, 3, height);
    }
  }

  /**
   * Draw audio waveform
   * @param {Float32Array} audioData
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {string} color
   */
  drawWaveform(audioData, x, y, width, height, color = COLORS.waveform) {
    if (!audioData || audioData.length === 0) return;

    const ctx = this.ctx;
    const samples = audioData.length;
    const step = Math.max(1, Math.ceil(samples / width));
    const amp = height / 2;
    const centerY = y + amp;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;

      // Find min/max in this bucket
      for (let j = 0; j < step; j++) {
        const index = Math.min(i * step + j, samples - 1);
        const datum = audioData[index] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      const yMin = centerY + amp * min;
      const yMax = centerY + amp * max;

      // Draw vertical line from min to max
      ctx.moveTo(x + i, yMin);
      ctx.lineTo(x + i, yMax);
    }

    ctx.stroke();
  }

  /**
   * Draw video thumbnail
   * @param {ImageBitmap|VideoFrame|HTMLVideoElement} frame
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  drawThumbnail(frame, x, y, width, height) {
    if (!frame) return;

    this.ctx.save();

    // Clip to bounds
    this.ctx.beginPath();
    this.ctx.rect(x, y, width, height);
    this.ctx.clip();

    // Calculate aspect ratio fit
    const frameWidth = frame.width || frame.videoWidth;
    const frameHeight = frame.height || frame.videoHeight;
    const scale = Math.min(width / frameWidth, height / frameHeight);
    const scaledWidth = frameWidth * scale;
    const scaledHeight = frameHeight * scale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    // Draw centered and scaled
    this.ctx.drawImage(
      frame,
      x + offsetX,
      y + offsetY,
      scaledWidth,
      scaledHeight
    );

    this.ctx.restore();
  }

  /**
   * Draw playhead indicator
   * @param {number} x
   * @param {number} height
   * @param {string} color
   */
  drawPlayhead(x, height, color = COLORS.playhead) {
    const ctx = this.ctx;

    // Draw playhead line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Draw playhead triangle at top
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 6, 10);
    ctx.lineTo(x + 6, 10);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw time ruler
   * @param {number} startTime - Start time in ms
   * @param {number} endTime - End time in ms
   * @param {number} pixelsPerMs - Pixels per millisecond
   * @param {number} height - Ruler height
   */
  drawTimeRuler(startTime, endTime, pixelsPerMs, height) {
    const ctx = this.ctx;

    // Draw background
    ctx.fillStyle = COLORS.timelineBackground;
    ctx.fillRect(0, 0, this.canvas.width, height);

    // Determine tick interval based on zoom
    const msPerPixel = 1 / pixelsPerMs;
    let tickInterval = 1000; // 1 second
    if (msPerPixel < 10) tickInterval = 100; // 100ms
    if (msPerPixel < 1) tickInterval = 10; // 10ms
    if (msPerPixel > 100) tickInterval = 10000; // 10 seconds
    if (msPerPixel > 1000) tickInterval = 60000; // 1 minute

    // Draw ticks
    ctx.strokeStyle = COLORS.rulerLine;
    ctx.fillStyle = COLORS.rulerText;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const startTick = Math.floor(startTime / tickInterval) * tickInterval;
    const endTick = Math.ceil(endTime / tickInterval) * tickInterval;

    for (let time = startTick; time <= endTick; time += tickInterval) {
      const x = (time - startTime) * pixelsPerMs;

      // Major tick every 5 intervals
      const isMajor = (time % (tickInterval * 5)) === 0;
      const tickHeight = isMajor ? height - 10 : height - 15;

      // Draw tick
      ctx.beginPath();
      ctx.moveTo(x, tickHeight);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw time label for major ticks
      if (isMajor) {
        const label = this.formatTime(time);
        ctx.fillText(label, x + 2, 2);
      }
    }
  }

  /**
   * Format time for display
   * @param {number} ms
   * @returns {string}
   */
  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((ms % 1000) / 10);

    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(2, '0')}`;
  }

  /**
   * Draw track background
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {boolean} alternate
   */
  drawTrackBackground(y, width, height, alternate) {
    this.ctx.fillStyle = alternate ? COLORS.trackBackground : COLORS.timelineBackground;
    this.ctx.fillRect(0, y, width, height);

    // Draw border
    this.ctx.strokeStyle = COLORS.trackBorder;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(0, y + height);
    this.ctx.lineTo(width, y + height);
    this.ctx.stroke();
  }

  /**
   * Clear the entire canvas
   */
  clear() {
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Resize canvas and renderer
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';

    this.ctx.scale(dpr, dpr);

    this.width = width;
    this.height = height;
  }

  /**
   * Save canvas state
   */
  save() {
    this.ctx.save();
  }

  /**
   * Restore canvas state
   */
  restore() {
    this.ctx.restore();
  }
}
