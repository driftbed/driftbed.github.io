export const VIDEO_RECORDER_PROFILES = Object.freeze([
  Object.freeze({
    id: 'webm-vp9-opus',
    container: 'webm',
    mixedMimeTypes: ['video/webm;codecs=vp9,opus', 'video/webm'],
    noiseMimeTypes: ['audio/webm;codecs=opus', 'audio/webm'],
    mixedExtension: 'webm',
    noiseExtension: 'webm'
  }),
  Object.freeze({
    id: 'webm-vp8-opus',
    container: 'webm',
    mixedMimeTypes: ['video/webm;codecs=vp8,opus', 'video/webm'],
    noiseMimeTypes: ['audio/webm;codecs=opus', 'audio/webm'],
    mixedExtension: 'webm',
    noiseExtension: 'webm'
  }),
  Object.freeze({
    id: 'mp4-h264-aac',
    container: 'mp4',
    mixedMimeTypes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'],
    noiseMimeTypes: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
    mixedExtension: 'mp4',
    noiseExtension: 'm4a'
  })
]);

function isSupported(MediaRecorderCtor, mimeType) {
  if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== 'function') return false;
  try { return MediaRecorderCtor.isTypeSupported(mimeType); } catch { return false; }
}

function firstSupported(MediaRecorderCtor, mimeTypes) {
  return mimeTypes.find(mimeType => isSupported(MediaRecorderCtor, mimeType)) || null;
}

export function probeVideoExportCapabilities({ video = null, canvas = null, MediaRecorderCtor = globalThis.MediaRecorder } = {}) {
  const directMediaCapture = Boolean(video && typeof video.captureStream === 'function');
  const canvasCapture = Boolean(canvas && typeof canvas.captureStream === 'function');
  const mediaRecorder = typeof MediaRecorderCtor === 'function' && typeof MediaRecorderCtor.isTypeSupported === 'function';
  const recorderProfiles = [];
  if (mediaRecorder) {
    for (const profile of VIDEO_RECORDER_PROFILES) {
      const mixedMimeType = firstSupported(MediaRecorderCtor, profile.mixedMimeTypes);
      const noiseMimeType = firstSupported(MediaRecorderCtor, profile.noiseMimeTypes);
      if (mixedMimeType && noiseMimeType) recorderProfiles.push({ ...profile, mixedMimeType, noiseMimeType });
    }
  }
  return Object.freeze({
    mediaRecorder,
    directMediaCapture,
    canvasCapture,
    videoFrameCallback: Boolean(video && typeof video.requestVideoFrameCallback === 'function'),
    audioContext: typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function',
    mediaElementAudioSource: Boolean(globalThis.AudioContext?.prototype?.createMediaElementSource || globalThis.webkitAudioContext?.prototype?.createMediaElementSource),
    recorderProfiles: Object.freeze(recorderProfiles)
  });
}

export function selectRecorderProfile({ capabilities, captureKind = 'direct' } = {}) {
  if (!capabilities?.mediaRecorder) throw new Error('This browser cannot encode a local video export.');
  const preferredContainers = captureKind === 'canvas' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  for (const container of preferredContainers) {
    const match = capabilities.recorderProfiles.find(profile => profile.container === container);
    if (match) return match;
  }
  throw new Error('This browser can play the video, but it cannot encode a supported merged video and noise-only audio pair.');
}
