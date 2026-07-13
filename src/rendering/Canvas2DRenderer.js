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
    const radius = Math.min(4, width / 2, height / 2);

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.clip();

    ctx.globalAlpha = selected ? 1 : 0.9;
    ctx.fillStyle = clip.color || COLORS.clipDefault;
    ctx.fillRect(x, y, width, height);

    // A dark lower layer keeps waveform and metadata legible on custom colors.
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y + 26, width, Math.max(0, height - 26));
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1), radius);
    } else {
      ctx.rect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    }
    ctx.strokeStyle = selected ? '#8db8d5' : 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw clip text and selection handles above thumbnails/waveforms.
   * @param {import('../core/types.js').Clip} clip
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {boolean} selected
   */
  drawClipLabel(clip, x, y, width, height, selected) {
    const ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 3, y + 3, Math.max(0, width - 6), Math.max(0, height - 6));
    ctx.clip();
    ctx.fillStyle = COLORS.clipText;
    ctx.font = '600 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 2;
    ctx.fillText(clip.name, x + 7, y + 7);
    ctx.shadowBlur = 0;

    if (clip.speed && clip.speed !== 1.0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.font = '500 9px "SFMono-Regular", Consolas, monospace';
      ctx.fillText(`${clip.speed}×`, x + 7, y + 30);
    }

    if (clip.reversed) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '10px sans-serif';
      ctx.fillText('◀', x + width - 18, y + 7);
    }

    ctx.restore();

    if (selected && width >= 16) {
      ctx.save();
      ctx.strokeStyle = 'rgba(238, 240, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 4, y + height / 2 - 6);
      ctx.lineTo(x + 4, y + height / 2 + 6);
      ctx.moveTo(x + width - 4, y + height / 2 - 6);
      ctx.lineTo(x + width - 4, y + height / 2 + 6);
      ctx.stroke();
      ctx.restore();
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
    ctx.fillRect(0, 0, this.width, height);

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
    ctx.font = '9px "SFMono-Regular", Consolas, monospace';
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
        ctx.fillText(label, x + 5, 5);
      }
    }

    ctx.strokeStyle = COLORS.trackBorder;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(this.width, height - 0.5);
    ctx.stroke();
  }

  /**
   * Draw vertical time guides through the track area.
   */
  drawTimeGrid(startTime, endTime, pixelsPerMs, top, bottom) {
    if (bottom <= top) return;
    const ctx = this.ctx;
    const msPerPixel = 1 / pixelsPerMs;
    let tickInterval = 1000;
    if (msPerPixel < 10) tickInterval = 100;
    if (msPerPixel < 1) tickInterval = 10;
    if (msPerPixel > 100) tickInterval = 10000;
    if (msPerPixel > 1000) tickInterval = 60000;

    const startTick = Math.floor(startTime / tickInterval) * tickInterval;
    const endTick = Math.ceil(endTime / tickInterval) * tickInterval;

    ctx.save();
    ctx.lineWidth = 1;
    for (let time = startTick; time <= endTick; time += tickInterval) {
      const x = Math.round((time - startTime) * pixelsPerMs) + 0.5;
      const isMajor = (time % (tickInterval * 5)) === 0;
      ctx.strokeStyle = isMajor ? COLORS.gridMajor : COLORS.gridMinor;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.restore();
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
    this.ctx.fillStyle = alternate ? COLORS.trackAlternate : COLORS.trackBackground;
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
   * Draw selection rectangle
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  drawSelectionRect(x, y, width, height) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(51, 111, 156, 0.12)';
    ctx.strokeStyle = 'rgba(82, 137, 178, 0.74)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
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
