/**
 * @fileoverview Local timeline thumbnail and waveform generation.
 * Derived visuals stay in memory and are never uploaded or added to project JSON.
 */

// Sized for the compact timeline filmstrip without retaining preview-resolution frames.
const THUMBNAIL_WIDTH = 96;
const THUMBNAIL_HEIGHT = 54;
const MAX_OVERVIEW_THUMBNAILS = 16;
const MIN_WAVEFORM_BUCKETS = 8192;
const MAX_WAVEFORM_BUCKETS = 4 * 1024 * 1024;
const WAVEFORM_BUCKET_INTERVAL_MS = 1.25;
const WAVEFORM_LEVEL_FACTOR = 4;
const WAVEFORM_PEAK_SCALE = 32767;
const MAX_WAVEFORM_READS_PER_CHANNEL = 16 * 1024 * 1024;

/**
 * Choose enough samples to make a useful filmstrip without doing excessive seeks.
 * @param {number} durationMs
 * @returns {number}
 */
export function getThumbnailSampleCount(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (durationMs <= 15000) return 6;
  if (durationMs <= 60000) return 8;
  if (durationMs <= 5 * 60000) return 12;
  return MAX_OVERVIEW_THUMBNAILS;
}

/**
 * Downsample decoded PCM into a multiresolution minimum/maximum peak pyramid.
 * The finest level targets 1.25ms buckets (bounded for very long sources), while
 * coarser levels keep zoomed-out timeline rendering inexpensive.
 * @param {AudioBuffer|{length:number, duration:number, numberOfChannels:number, getChannelData:function(number):Float32Array}} audioBuffer
 * @param {number} [requestedBuckets]
 * @returns {{peaks:Int16Array,bucketCount:number,durationMs:number,peakScale:number,levels:{peaks:Int16Array,bucketCount:number}[]}}
 */
export function buildWaveformPeaks(audioBuffer, requestedBuckets) {
  const work = createWaveformPeakWork(audioBuffer, requestedBuckets);
  processWaveformPeakRange(work, 0, work.bucketCount);
  return finishWaveformPeakWork(work);
}

function createWaveformPeakWork(audioBuffer, requestedBuckets) {
  const sampleLength = Math.max(0, Number(audioBuffer.length) || 0);
  const durationMs = Math.max(0, (Number(audioBuffer.duration) || 0) * 1000);
  const targetBuckets = Number.isFinite(requestedBuckets)
    ? Math.max(1, Math.floor(requestedBuckets))
    : Math.max(
      MIN_WAVEFORM_BUCKETS,
      Math.min(MAX_WAVEFORM_BUCKETS, Math.ceil(durationMs / WAVEFORM_BUCKET_INTERVAL_MS))
    );
  const bucketCount = Math.max(1, Math.min(targetBuckets, sampleLength || 1));
  const channelCount = Math.max(1, Number(audioBuffer.numberOfChannels) || 1);
  return {
    sampleLength,
    bucketCount,
    durationMs,
    peaks: new Int16Array(bucketCount * 2),
    channels: Array.from({ length: channelCount }, (_, channel) => (
      audioBuffer.getChannelData(channel)
    )),
    sampleStride: Math.max(1, Math.ceil(sampleLength / MAX_WAVEFORM_READS_PER_CHANNEL)),
  };
}

function processWaveformPeakRange(work, firstBucket, endBucket) {
  const {
    sampleLength,
    peaks,
    channels,
    sampleStride,
  } = work;

  for (let bucket = firstBucket; bucket < endBucket; bucket += 1) {
    const start = Math.floor(bucket / work.bucketCount * sampleLength);
    const end = Math.floor((bucket + 1) / work.bucketCount * sampleLength);
    let min = 0;
    let max = 0;

    for (const samples of channels) {
      for (let index = start; index < end; index += sampleStride) {
        const value = samples[index] || 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (end > start) {
        const finalValue = samples[end - 1] || 0;
        if (finalValue < min) min = finalValue;
        if (finalValue > max) max = finalValue;
      }
    }

    peaks[bucket * 2] = Math.round(Math.max(-1, min) * WAVEFORM_PEAK_SCALE);
    peaks[bucket * 2 + 1] = Math.round(Math.min(1, max) * WAVEFORM_PEAK_SCALE);
  }
}

function finishWaveformPeakWork(work) {
  const levels = [{ peaks: work.peaks, bucketCount: work.bucketCount }];
  let current = levels[0];

  while (current.bucketCount > 1) {
    const bucketCount = Math.ceil(current.bucketCount / WAVEFORM_LEVEL_FACTOR);
    const peaks = new Int16Array(bucketCount * 2);
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const firstSourceBucket = bucket * WAVEFORM_LEVEL_FACTOR;
      const endSourceBucket = Math.min(
        current.bucketCount,
        firstSourceBucket + WAVEFORM_LEVEL_FACTOR
      );
      let min = 0;
      let max = 0;
      for (let sourceBucket = firstSourceBucket; sourceBucket < endSourceBucket; sourceBucket += 1) {
        min = Math.min(min, current.peaks[sourceBucket * 2]);
        max = Math.max(max, current.peaks[sourceBucket * 2 + 1]);
      }
      peaks[bucket * 2] = min;
      peaks[bucket * 2 + 1] = max;
    }
    current = { peaks, bucketCount };
    levels.push(current);
  }

  return {
    peaks: work.peaks,
    bucketCount: work.bucketCount,
    durationMs: work.durationMs,
    peakScale: WAVEFORM_PEAK_SCALE,
    levels,
  };
}

/** Wait for one media event, rejecting instead of hanging indefinitely. */
function waitForEvent(target, eventName, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener('error', onError);
      if (timer !== null) clearTimeout(timer);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Media ${eventName} failed`));
    };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for media ${eventName}`));
    }, timeoutMs);
  });
}

/** Wait for a seek to expose decoded frame data, even if the browser omits seeked. */
function waitForDecodedSeek(video, targetTime, shouldContinue = () => true, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let poller = null;
    const events = ['seeked', 'loadeddata', 'canplay', 'progress', 'timeupdate'];
    const cleanup = () => {
      events.forEach(eventName => video.removeEventListener(eventName, checkReady));
      video.removeEventListener('error', onError);
      if (timer !== null) clearTimeout(timer);
      if (poller !== null) clearInterval(poller);
    };
    const checkReady = () => {
      if (!shouldContinue()) {
        cleanup();
        resolve(false);
        return;
      }
      const isAtTarget = Math.abs(video.currentTime - targetTime) <= 0.5;
      if (video.readyState < 2 || video.seeking === true || !isAtTarget) return;
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video frame data failed to decode'));
    };
    events.forEach(eventName => video.addEventListener(eventName, checkReady));
    video.addEventListener('error', onError, { once: true });
    poller = setInterval(checkReady, 50);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out decoding video frame at ${targetTime.toFixed(3)}s`));
    }, timeoutMs);
  });
}

/** Seek a video and wait until its decoded frame can be copied to a canvas. */
async function seekVideo(video, timeSeconds, shouldContinue) {
  const alreadyAtTime = video.readyState >= 2
    && Math.abs(video.currentTime - timeSeconds) < 0.002;
  if (alreadyAtTime) return true;

  if (typeof video.pause === 'function') video.pause();
  const pendingSeek = waitForDecodedSeek(video, timeSeconds, shouldContinue);
  video.currentTime = timeSeconds;
  return pendingSeek;
}

/** Snapshot and center-crop one decoded video frame into its own dedicated canvas. */
function captureVideoFrame(video, width, height) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceAspect > targetAspect) {
    sw = sourceHeight * targetAspect;
    sx = (sourceWidth - sw) / 2;
  } else if (sourceAspect < targetAspect) {
    sh = sourceWidth / targetAspect;
    sy = (sourceHeight - sh) / 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create thumbnail canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
}

export class MediaVisualGenerator {
  /**
   * Open one reusable local-video decoder for a batch of timestamp requests.
   * @param {File|Blob} file
   * @param {{duration?:number}} metadata
   * @returns {Promise<{durationMs:number,captureTimes:function(number[],function():boolean=):Promise<object>,close:function():void}|null>}
   */
  async createThumbnailSession(file, metadata) {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let closed = false;
    video.muted = true;
    video.volume = 0;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    const close = () => {
      if (closed) return;
      closed = true;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    try {
      if (video.readyState < 1) {
        await waitForEvent(video, 'loadedmetadata');
      }
      const durationMs = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1000
        : Number(metadata.duration) || 0;
      if (durationMs <= 0 || !video.videoWidth || !video.videoHeight) {
        close();
        return null;
      }

      return {
        durationMs,
        captureTimes: async (requestedTimesMs, shouldContinue = () => true) => {
          if (closed) throw new Error('Thumbnail session is closed');
          const safeDuration = Math.max(0, video.duration - 0.04);
          const sampleTimesMs = Array.from(new Set(requestedTimesMs
            .filter(Number.isFinite)
            .map(timeMs => Math.min(safeDuration * 1000, Math.max(0, timeMs)))))
            .sort((a, b) => a - b);
          const capturedTimesMs = [];
          const failedTimesMs = [];
          const frames = [];
          for (let index = 0; index < sampleTimesMs.length; index += 1) {
            const sampleTimeMs = sampleTimesMs[index];
            if (!shouldContinue()) break;
            try {
              const didSeek = await seekVideo(video, sampleTimeMs / 1000, shouldContinue);
              if (!didSeek) break;
              frames.push(captureVideoFrame(video, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT));
              capturedTimesMs.push(sampleTimeMs);
            } catch {
              // One corrupt or unseekable timestamp should not discard the usable strip.
              failedTimesMs.push(sampleTimeMs);
              if (video.error) {
                failedTimesMs.push(...sampleTimesMs.slice(index + 1));
                break;
              }
            }
          }
          return {
            frames,
            frameWidth: THUMBNAIL_WIDTH,
            frameHeight: THUMBNAIL_HEIGHT,
            durationMs,
            sampleTimesMs: capturedTimesMs,
            failedTimesMs,
          };
        },
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  /**
   * Generate independent timestamped snapshots by seeking through a local video Blob.
   * @param {File|Blob} file
   * @param {{duration?:number}} metadata
   * @param {function():boolean} [shouldContinue]
   * @returns {Promise<{frames: CanvasImageSource[], frameWidth:number, frameHeight:number, durationMs:number, sampleTimesMs:number[]}|null>}
   */
  async generateThumbnails(file, metadata, shouldContinue) {
    const session = await this.createThumbnailSession(file, metadata);
    if (!session) return null;

    try {
      const durationMs = session.durationMs;
      const frameCount = getThumbnailSampleCount(durationMs);
      if (frameCount === 0) return null;
      const sampleTimesMs = [];
      for (let index = 0; index < frameCount; index += 1) {
        const sampleRatio = (index + 0.5) / frameCount;
        sampleTimesMs.push(durationMs * sampleRatio);
      }
      const thumbnails = await session.captureTimes(sampleTimesMs, shouldContinue);
      return thumbnails.frames.length > 0 ? thumbnails : null;
    } finally {
      session.close();
    }
  }

  /**
   * Decode and downsample a local audio track.
   * @param {File|Blob} file
   * @returns {Promise<{peaks:Int16Array,bucketCount:number,durationMs:number,peakScale:number,levels:{peaks:Int16Array,bucketCount:number}[]}|null>}
   */
  async generateWaveform(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();

    try {
      const encodedAudio = await file.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(encodedAudio);
      return buildWaveformPeaks(audioBuffer);
    } finally {
      if (typeof context.close === 'function') {
        await context.close().catch(() => {});
      }
    }
  }
}
