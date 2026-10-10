export const DURATION_TOLERANCE_SECONDS = 0.125;

export const DURATION_STATUS = Object.freeze({
  VALID: 'valid',
  METADATA_MISSING: 'metadata-missing',
  INVALID: 'invalid',
  TOO_SHORT: 'too-short',
  TOO_LONG: 'too-long'
});

export function assertSampleRate(sampleRate, label = 'sample rate') {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff) {
    throw new Error(`${label} must be a positive integer no greater than 4294967295 Hz.`);
  }
  return sampleRate;
}

export function pcmDurationSeconds(frameCount, sampleRate) {
  assertSampleRate(sampleRate);
  if (!Number.isInteger(frameCount) || frameCount < 0) {
    throw new Error('PCM frame count must be a non-negative integer.');
  }
  const duration = frameCount / sampleRate;
  if (!Number.isFinite(duration)) throw new Error('PCM duration is not finite.');
  return duration;
}

export function assertPcmShape(channels, label = 'PCM', expectedFrameCount = null) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 0xffff) {
    throw new Error(`${label} must contain between 1 and 65535 channels.`);
  }
  const first = channels[0];
  if (!first || !Number.isInteger(first.length) || first.length < 0) {
    throw new Error(`${label} channel 0 must be an array-like sample channel.`);
  }
  const frameCount = first.length;
  if (expectedFrameCount !== null && frameCount !== expectedFrameCount) {
    throw new Error(`${label} has ${frameCount} frames; expected ${expectedFrameCount}.`);
  }
  for (let index = 0; index < channels.length; index++) {
    const channel = channels[index];
    if (!channel || !Number.isInteger(channel.length) || channel.length !== frameCount) {
      throw new Error(`${label} channels must have equal frame counts.`);
    }
  }
  return { channelCount: channels.length, frameCount };
}

export function classifyDuration({ targetDuration, actualDuration, tolerance = DURATION_TOLERANCE_SECONDS }) {
  if (!Number.isFinite(targetDuration) || targetDuration < 0) {
    throw new Error('Target duration must be a finite non-negative number.');
  }
  if (actualDuration === null || actualDuration === undefined) {
    return { status: DURATION_STATUS.METADATA_MISSING, deltaSeconds: null };
  }
  if (!Number.isFinite(actualDuration) || actualDuration < 0) {
    return { status: DURATION_STATUS.INVALID, deltaSeconds: null };
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Duration tolerance must be non-negative.');
  const deltaSeconds = actualDuration - targetDuration;
  let status = DURATION_STATUS.VALID;
  if (Math.abs(deltaSeconds) > tolerance) status = deltaSeconds < 0 ? DURATION_STATUS.TOO_SHORT : DURATION_STATUS.TOO_LONG;
  return { status, deltaSeconds };
}

export function measureBlobPlaybackDuration(blob, kind = 'video', timeoutMs = 5000) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return Promise.reject(new Error('Browser media duration measurement is unavailable outside a document.'));
  }
  if (!blob) return Promise.reject(new Error('A media blob is required for duration measurement.'));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Media duration timeout must be positive.'));
  const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
  const url = URL.createObjectURL(blob);
  element.preload = 'metadata';
  element.muted = true;
  if (kind !== 'audio') element.playsInline = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, duration = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute('src');
      try { element.load(); } catch {}
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration);
    };
    const timer = setTimeout(() => finish(new Error(`Timed out reading ${kind} playback duration.`)), timeoutMs);
    element.onloadedmetadata = () => {
      const duration = Number(element.duration);
      if (!Number.isFinite(duration) || duration < 0) {
        finish(new Error(`Decoded ${kind} duration is not finite.`));
        return;
      }
      finish(null, duration);
    };
    element.onerror = () => finish(new Error(`Browser could not decode the recorded ${kind}.`));
    element.src = url;
    element.load();
  });
}
