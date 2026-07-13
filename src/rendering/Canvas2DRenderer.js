/**
 * @fileoverview Canvas 2D renderer implementation
 */

import { Renderer } from './Renderer.js';
import { CLIP_HEADER_HEIGHT, COLORS } from '../core/constants.js';

const WAVEFORM_VERTICAL_GAIN = 1.5;
const WAVEFORM_MAX_AMPLITUDE = 0.98;
const MAX_WAVEFORM_BUCKETS_PER_PIXEL = 4;
const MIN_THUMBNAIL_REFINEMENT_WIDTH = 32;

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
    ctx.fillRect(x, y + CLIP_HEADER_HEIGHT, width, Math.max(0, height - CLIP_HEADER_HEIGHT));
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
    ctx.font = '600 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = 2;
    ctx.fillText(clip.name, x + 6, y + 4);
    ctx.shadowBlur = 0;

    let metadataRight = x + width - 6;
    if (clip.reversed) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('◀', metadataRight, y + 4);
      metadataRight -= 16;
    }

    if (clip.speed && clip.speed !== 1.0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.font = '500 9px "SFMono-Regular", Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${clip.speed}×`, metadataRight, y + 4);
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

      const displayMin = Math.max(-WAVEFORM_MAX_AMPLITUDE, min * WAVEFORM_VERTICAL_GAIN);
      const displayMax = Math.min(WAVEFORM_MAX_AMPLITUDE, max * WAVEFORM_VERTICAL_GAIN);
      const yMin = centerY + amp * displayMin;
      const yMax = centerY + amp * displayMax;

      // Draw vertical line from min to max
      ctx.moveTo(x + i, yMin);
      ctx.lineTo(x + i, yMax);
    }

    ctx.stroke();
  }

  /**
   * Draw downsampled source peaks, mapping trim, speed, and reverse to timeline pixels.
   * @param {{peaks:Float32Array|Int16Array,bucketCount:number,durationMs:number,peakScale?:number,levels?:{peaks:Float32Array|Int16Array,bucketCount:number}[]}} waveform
   * @param {number} clipX
   * @param {number} y
   * @param {number} clipWidth
   * @param {number} height
   * @param {string} color
   * @param {{trimStart?:number,speed?:number,reversed?:boolean,viewportLeft?:number,viewportRight?:number,contentInset?:number,backgroundColor?:string}} [options]
   */
  drawWaveformPeaks(waveform, clipX, y, clipWidth, height, color = COLORS.waveform, options = {}) {
    if (!waveform || !waveform.peaks || waveform.peaks.length < 2) return;
    if (!Number.isFinite(clipWidth) || clipWidth <= 0 || height <= 0) return;

    let peaks = waveform.peaks;
    let bucketCount = Math.min(
      Number(waveform.bucketCount) || Math.floor(peaks.length / 2),
      Math.floor(peaks.length / 2)
    );
    const sourceDuration = Number(waveform.durationMs) || 0;
    if (bucketCount <= 0 || sourceDuration <= 0) return;

    const viewportLeft = Number.isFinite(options.viewportLeft) ? options.viewportLeft : 0;
    const viewportRight = Number.isFinite(options.viewportRight) ? options.viewportRight : this.width;
    const contentInset = Math.max(0, Number(options.contentInset) || 0);
    const contentLeft = clipX + contentInset;
    const contentRight = clipX + clipWidth - contentInset;
    const startX = Math.max(viewportLeft, Math.floor(contentLeft));
    const endX = Math.min(viewportRight, Math.ceil(contentRight));
    if (endX <= startX) return;

    const trimStart = Math.max(0, Number(options.trimStart) || 0);
    const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
    const clipSourceLength = (Number(options.clipDuration) || 0) * speed;
    if (clipSourceLength <= 0) return;

    // Match detail to the current timeline scale. Fine levels become visible as
    // the user zooms in; coarse levels avoid scanning the full source when zoomed out.
    if (Array.isArray(waveform.levels) && waveform.levels.length > 0) {
      const sourceSpanPerPixel = clipSourceLength / clipWidth;
      for (const level of waveform.levels) {
        if (!level || !level.peaks || level.bucketCount <= 0) continue;
        const levelBucketCount = Math.min(level.bucketCount, Math.floor(level.peaks.length / 2));
        if (levelBucketCount <= 0) continue;
        peaks = level.peaks;
        bucketCount = levelBucketCount;
        const bucketsPerPixel = sourceSpanPerPixel / sourceDuration * bucketCount;
        if (bucketsPerPixel <= MAX_WAVEFORM_BUCKETS_PER_PIXEL) break;
      }
    }
    const peakScale = Number(waveform.peakScale) > 0 ? Number(waveform.peakScale) : 1;

    const ctx = this.ctx;
    const amplitude = height / 2;
    const centerY = y + amplitude;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.max(contentLeft, viewportLeft), y, Math.min(contentRight, viewportRight) - Math.max(contentLeft, viewportLeft), height);
    ctx.clip();
    if (options.backgroundColor) {
      ctx.fillStyle = options.backgroundColor;
      ctx.fillRect(Math.max(contentLeft, viewportLeft), y, Math.min(contentRight, viewportRight) - Math.max(contentLeft, viewportLeft), height);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.max(contentLeft, viewportLeft), centerY + 0.5);
    ctx.lineTo(Math.min(contentRight, viewportRight), centerY + 0.5);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let pixelX = startX; pixelX < endX; pixelX += 1) {
      const ratioA = Math.max(0, Math.min(1, (pixelX - clipX) / clipWidth));
      const ratioB = Math.max(0, Math.min(1, (pixelX + 1 - clipX) / clipWidth));
      const sourceA = options.reversed
        ? trimStart + (1 - ratioA) * clipSourceLength
        : trimStart + ratioA * clipSourceLength;
      const sourceB = options.reversed
        ? trimStart + (1 - ratioB) * clipSourceLength
        : trimStart + ratioB * clipSourceLength;
      const lowerSource = Math.max(0, Math.min(sourceDuration, Math.min(sourceA, sourceB)));
      const upperSource = Math.max(0, Math.min(sourceDuration, Math.max(sourceA, sourceB)));
      const firstBucket = Math.max(0, Math.min(bucketCount - 1, Math.floor(lowerSource / sourceDuration * bucketCount)));
      const lastBucket = Math.max(firstBucket, Math.min(
        bucketCount - 1,
        Math.ceil(upperSource / sourceDuration * bucketCount) - 1
      ));
      let min = 0;
      let max = 0;

      for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        min = Math.min(min, (peaks[bucket * 2] || 0) / peakScale);
        max = Math.max(max, (peaks[bucket * 2 + 1] || 0) / peakScale);
      }

      min = Math.max(-WAVEFORM_MAX_AMPLITUDE, min * WAVEFORM_VERTICAL_GAIN);
      max = Math.min(WAVEFORM_MAX_AMPLITUDE, max * WAVEFORM_VERTICAL_GAIN);

      ctx.moveTo(pixelX + 0.5, centerY + min * amplitude);
      ctx.lineTo(pixelX + 0.5, centerY + max * amplitude);
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a filmstrip from independent timestamped frame snapshots.
   * @param {{frames:CanvasImageSource[],frameWidth:number,frameHeight:number,durationMs:number,sampleTimesMs:number[]}} thumbnails
   * @param {number} clipX
   * @param {number} y
   * @param {number} clipWidth
   * @param {number} height
   * @param {{trimStart?:number,speed?:number,reversed?:boolean,clipDuration?:number,viewportLeft?:number,viewportRight?:number,contentInset?:number}} [options]
   */
  drawThumbnailStrip(thumbnails, clipX, y, clipWidth, height, options = {}) {
    const frames = thumbnails && Array.isArray(thumbnails.frames) ? thumbnails.frames : [];
    const frameCount = frames.length;
    if (!thumbnails || frameCount === 0) return [];
    if (!Number.isFinite(clipWidth) || clipWidth <= 0 || height <= 0) return [];

    const viewportLeft = Number.isFinite(options.viewportLeft) ? options.viewportLeft : 0;
    const viewportRight = Number.isFinite(options.viewportRight) ? options.viewportRight : this.width;
    const contentInset = Math.max(0, Number(options.contentInset) || 0);
    const visibleLeft = Math.max(clipX + contentInset, viewportLeft);
    const visibleRight = Math.min(clipX + clipWidth - contentInset, viewportRight);
    if (visibleRight <= visibleLeft) return [];

    const tileWidth = Math.max(40, height * (thumbnails.frameWidth / thumbnails.frameHeight));
    const firstTile = Math.max(0, Math.floor((visibleLeft - clipX) / tileWidth));
    const lastTile = Math.max(firstTile, Math.ceil((visibleRight - clipX) / tileWidth));
    const trimStart = Math.max(0, Number(options.trimStart) || 0);
    const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
    const clipSourceLength = (Number(options.clipDuration) || 0) * speed;
    const mediaDuration = Number(thumbnails.durationMs) || 1;
    const sourceSpanPerTile = clipSourceLength * Math.min(1, tileWidth / clipWidth);
    const acceptableDistanceMs = Math.max(250, sourceSpanPerTile * 0.55);
    const requestedTimes = new Map();

    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(visibleLeft, y, visibleRight - visibleLeft, height);
    ctx.clip();
    ctx.globalAlpha = 1;

    for (let tile = firstTile; tile <= lastTile; tile += 1) {
      const targetX = clipX + tile * tileWidth;
      const timelineRatio = Math.max(0, Math.min(1, (targetX + tileWidth / 2 - clipX) / clipWidth));
      const mappedSourceTime = options.reversed
        ? trimStart + (1 - timelineRatio) * clipSourceLength
        : trimStart + timelineRatio * clipSourceLength;
      const sourceTime = Math.max(0, Math.min(mediaDuration, mappedSourceTime));
      let frameIndex;
      if (Array.isArray(thumbnails.sampleTimesMs)
          && thumbnails.sampleTimesMs.length === frameCount) {
        frameIndex = this.findNearestThumbnailFrame(thumbnails.sampleTimesMs, sourceTime);
        const nearestTime = thumbnails.sampleTimesMs[frameIndex];
        const needsCloserFrame = !Number.isFinite(nearestTime)
          || Math.abs(nearestTime - sourceTime) > acceptableDistanceMs;
        if (clipWidth >= MIN_THUMBNAIL_REFINEMENT_WIDTH && needsCloserFrame) {
          const requestKey = Math.round(sourceTime / 100) * 100;
          requestedTimes.set(requestKey, sourceTime);
        }
      } else {
        const sourceRatio = Math.max(0, Math.min(0.999999, sourceTime / mediaDuration));
        frameIndex = Math.max(0, Math.min(
          frameCount - 1,
          Math.floor(sourceRatio * frameCount)
        ));
      }

      if (frames[frameIndex]) ctx.drawImage(frames[frameIndex], targetX, y, tileWidth, height);
    }

    ctx.restore();
    return Array.from(requestedTimes.values());
  }

  /**
   * Find the closest captured frame to a source timestamp.
   * @param {number[]} sampleTimesMs
   * @param {number} sourceTimeMs
   * @returns {number}
   */
  findNearestThumbnailFrame(sampleTimesMs, sourceTimeMs) {
    if (!sampleTimesMs || sampleTimesMs.length <= 1) return 0;
    let low = 0;
    let high = sampleTimesMs.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sampleTimesMs[middle] < sourceTimeMs) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low === 0) return 0;
    const previous = low - 1;
    return Math.abs(sampleTimesMs[low] - sourceTimeMs)
      < Math.abs(sampleTimesMs[previous] - sourceTimeMs)
      ? low
      : previous;
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
