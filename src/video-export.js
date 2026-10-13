import { classifyDuration, DURATION_TOLERANCE_SECONDS, measureBlobPlaybackDuration } from './media-duration.js?v=1.11.0';
import { inspectWebm } from './webm-container.js?v=1.11.0';
import { inspectMp4, sniffMediaContainer } from './mp4-container.js?v=1.11.0';
import { probeVideoExportCapabilities, selectRecorderProfile } from './video-capabilities.js?v=1.11.0';
import { createVideoCaptureSource } from './video-capture-source.js?v=1.11.0';

function waitForVideoReady(video, eventName, readyState) {
  if (video.readyState >= readyState) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => finish(null);
    const onError = () => finish(new Error('Browser could not decode this video.'));
    const finish = error => {
      video.removeEventListener?.(eventName, onReady);
      video.removeEventListener?.('error', onError);
      if (video[`on${eventName}`] === onReady) video[`on${eventName}`] = null;
      if (video.onerror === onError) video.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    video.addEventListener?.(eventName, onReady, { once: true });
    video.addEventListener?.('error', onError, { once: true });
    video[`on${eventName}`] = onReady;
    video.onerror = onError;
  });
}

async function loadVideoFile(file, preload = 'auto') {
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.preload = preload;
  video.playsInline = true;
  video.muted = false;
  try {
    const metadataReady = waitForVideoReady(video, 'loadedmetadata', 1);
    video.src = objectUrl;
    await metadataReady;
    const targetDuration = Number(video.duration);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error('Video has no finite, positive duration.');
    await waitForVideoReady(video, 'loadeddata', 2);
    return { video, objectUrl, targetDuration };
  } catch (error) {
    video.onloadedmetadata = null;
    video.onloadeddata = null;
    video.onerror = null;
    video.removeAttribute('src');
    try { video.load(); } catch {}
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function createRecorder(stream, mimeType, onError) {
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch (error) {
    onError(error);
    throw new Error(`The browser could not start its ${mimeType} recorder.`);
  }
  const chunks = [];
  let settled = false;
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
    };
    recorder.onerror = event => {
      if (settled) return;
      settled = true;
      const error = event.error || new Error('MediaRecorder failed.');
      reject(error);
      onError(error);
    };
  });
  const stop = () => {
    if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop();
    return done;
  };
  return { recorder, done, stop };
}

export async function auditRecordedMedia(blob, kind, targetDuration) {
  const bytes = await blob.arrayBuffer();
  const container = sniffMediaContainer(bytes, blob.type);
  let inspection = null;
  let containerDuration = null;
  let containerStatus = 'unknown';
  let hasTracks = false;
  try {
    if (container === 'webm') inspection = inspectWebm(bytes);
    else if (container === 'mp4') inspection = inspectMp4(bytes);
    if (inspection) {
      containerDuration = inspection.durationSeconds;
      hasTracks = container === 'webm' ? inspection.hasTracks : inspection.tracks.length > 0;
      containerStatus = !hasTracks ? 'invalid' : containerDuration === null ? 'not-declared' : classifyDuration({ targetDuration, actualDuration: containerDuration }).status;
    }
  } catch {
    containerStatus = 'invalid';
  }
  const playbackDuration = await measureBlobPlaybackDuration(blob, kind);
  const playback = classifyDuration({ targetDuration, actualDuration: playbackDuration });
  const containerAcceptable = containerStatus === 'valid' || containerStatus === 'not-declared';
  const status = containerAcceptable && playback.status === 'valid' ? 'valid' : `${containerStatus}/${playback.status}`;
  return {
    status,
    container,
    containerDuration,
    playbackDuration,
    containerStatus,
    playbackStatus: playback.status,
    containerDeltaSeconds: containerDuration === null ? null : containerDuration - targetDuration,
    playbackDeltaSeconds: playback.deltaSeconds,
    hasTracks,
    inspection
  };
}

export async function prepareVideoExport(file) {
  const loaded = await loadVideoFile(file, 'auto');
  const { video, objectUrl, targetDuration } = loaded;
  try {
    const canvas = document.createElement('canvas');
    const capabilities = probeVideoExportCapabilities({ video, canvas });
    const captureKind = capabilities.directMediaCapture ? 'direct' : capabilities.canvasCapture ? 'canvas' : 'unsupported';
    const profile = captureKind === 'unsupported' ? null : selectRecorderProfile({ capabilities, captureKind });
    if (!profile) throw new Error('This browser can play the video, but it cannot create a local video recording from it.');
    return {
      duration: targetDuration,
      width: Number(video.videoWidth),
      height: Number(video.videoHeight),
      captureKind,
      framePump: capabilities.videoFrameCallback ? 'requestVideoFrameCallback' : 'requestAnimationFrame',
      profile
    };
  } finally {
    video.onloadedmetadata = null;
    video.onloadeddata = null;
    video.removeAttribute('src');
    try { video.load(); } catch {}
    URL.revokeObjectURL(objectUrl);
  }
}

export async function exportVideoRealtime({ engine, file, seed, profile, variation, scenePace = 0.55, spectralDetail = 0.62, relativeDb, prepared = null, onProgress = () => {} }) {
  if (!engine) throw new Error('A processing engine is required for video export.');
  const loaded = await loadVideoFile(file);
  const { video, objectUrl, targetDuration } = loaded;
  let ctx = null;
  let processor = null;
  let timer = null;
  let videoSource = null;
  let videoStream = null;
  let mixed = null;
  let noiseOnly = null;
  let src = null;
  let sourceGain = null;
  let noiseGain = null;
  let mixedDestination = null;
  let noiseDestination = null;
  let analyser = null;
  let silent = null;
  let stopBoth = () => {};
  let sourceEndMediaTime = null;
  let sourceEndWallTime = null;
  let sourceStartMediaTime = 0;
  let sourceStartWallTime = null;
  let exportEnded = false;
  let resolvePlaybackEnded;
  let rejectPlaybackEnded;
  const playbackEnded = new Promise((resolve, reject) => {
    resolvePlaybackEnded = resolve;
    rejectPlaybackEnded = reject;
  });

  try {
    video.currentTime = 0;
    sourceStartMediaTime = video.currentTime;
    const canvas = document.createElement('canvas');
    const capabilities = probeVideoExportCapabilities({ video, canvas });
    videoSource = createVideoCaptureSource({ video, canvas, capabilities });
    const recorderProfile = prepared?.profile?.mixedMimeType && prepared?.profile?.noiseMimeType
      ? prepared.profile
      : selectRecorderProfile({ capabilities, captureKind: videoSource.kind });

    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextCtor !== 'function') throw new Error('This browser does not provide the Web Audio API required for video export.');
    ctx = new AudioContextCtor({ sampleRate: 48000 });
    src = ctx.createMediaElementSource(video);
    sourceGain = ctx.createGain();
    noiseGain = ctx.createGain();
    mixedDestination = ctx.createMediaStreamDestination();
    noiseDestination = ctx.createMediaStreamDestination();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(sourceGain).connect(mixedDestination);
    src.connect(analyser);

    const calibration = engine.createEnvironmentSynth({ seed, sampleRate: ctx.sampleRate, durationSeconds: targetDuration, profile, variation, scenePace, spectralDetail });
    const calibrationFrames = Math.max(1, Math.min(Math.round(ctx.sampleRate * 1.5), Math.round(ctx.sampleRate * targetDuration)));
    const [calL, calR] = calibration.render(calibrationFrames);
    let calSq = 0;
    for (let i = 0; i < calibrationFrames; i++) calSq += (calL[i] * calL[i] + calR[i] * calR[i]) * 0.5;
    const rawNoiseRms = Math.max(1e-7, Math.sqrt(calSq / calibrationFrames));
    let sourceLevelDb = -24;
    const requestedRelativeDb = Number.isFinite(relativeDb) ? relativeDb : -32;
    const initialNoiseRms = 10 ** ((sourceLevelDb + requestedRelativeDb) / 20);
    noiseGain.gain.value = initialNoiseRms / rawNoiseRms;

    processor = ctx.createScriptProcessor(2048, 0, 2);
    const synth = engine.createEnvironmentSynth({ seed, sampleRate: ctx.sampleRate, durationSeconds: targetDuration, profile, variation, scenePace, spectralDetail });
    processor.onaudioprocess = event => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      if (exportEnded) {
        left.fill(0);
        right.fill(0);
        return;
      }
      for (let i = 0; i < left.length; i++) {
        const sample = synth.nextStereo();
        left[i] = sample[0];
        right[i] = sample[1];
      }
    };
    processor.connect(noiseGain);
    noiseGain.connect(mixedDestination);
    noiseGain.connect(noiseDestination);

    silent = ctx.createGain();
    silent.gain.value = 0;
    src.connect(silent).connect(ctx.destination);
    processor.connect(silent);

    videoStream = videoSource.stream;
    const combined = new MediaStream();
    for (const track of videoStream.getVideoTracks()) combined.addTrack(track);
    for (const track of mixedDestination.stream.getAudioTracks()) combined.addTrack(track);

    const recorderError = error => {
      rejectPlaybackEnded(error instanceof Error ? error : new Error(String(error)));
      stopBoth();
    };
    mixed = createRecorder(combined, recorderProfile.mixedMimeType, recorderError);
    noiseOnly = createRecorder(noiseDestination.stream, recorderProfile.noiseMimeType, recorderError);
    stopBoth = () => {
      mixed?.stop();
      noiseOnly?.stop();
    };

    video.onended = () => {
      if (exportEnded) return;
      exportEnded = true;
      sourceEndMediaTime = video.currentTime;
      sourceEndWallTime = performance.now();
      videoSource.stop();
      stopBoth();
      resolvePlaybackEnded();
    };
    video.onerror = () => {
      rejectPlaybackEnded(new Error('Video playback failed during export.'));
      stopBoth();
    };

    const meterBuffer = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      onProgress(targetDuration ? video.currentTime / targetDuration : 0);
      analyser.getFloatTimeDomainData(meterBuffer);
      let ss = 0;
      for (const sample of meterBuffer) ss += sample * sample;
      const rms = Math.sqrt(ss / meterBuffer.length);
      const frameDb = 20 * Math.log10(Math.max(1e-8, rms));
      if (frameDb > -70) sourceLevelDb += 0.03 * (frameDb - sourceLevelDb);
      const targetNoiseRms = 10 ** ((sourceLevelDb + requestedRelativeDb) / 20);
      const targetGain = Math.min(4, Math.max(1e-6, targetNoiseRms / rawNoiseRms));
      noiseGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 3.0);
    }, 250);

    try {
      await ctx.resume();
      mixed.recorder.start();
      noiseOnly.recorder.start();
      sourceStartWallTime = performance.now();
      await video.play();
    } catch (error) {
      if (error?.name === 'NotAllowedError') throw new Error('Video export needs a direct tap to start media playback. Keep Driftbed visible and tap Generate again.');
      throw error;
    }
    await playbackEnded;
    const [mixedBlob, noiseBlob] = await Promise.all([mixed.done, noiseOnly.done]);

    const sourceDuration = classifyDuration({ targetDuration, actualDuration: sourceEndMediaTime });
    if (sourceDuration.status !== 'valid') throw new Error(`Video ended at ${sourceEndMediaTime?.toFixed?.(3) || 'an unknown'} seconds; expected ${targetDuration.toFixed(3)} seconds.`);
    const mixedDiagnostics = await auditRecordedMedia(mixedBlob, 'video', targetDuration);
    const noiseDiagnostics = await auditRecordedMedia(noiseBlob, 'audio', targetDuration);
    if (mixedDiagnostics.status !== 'valid' || noiseDiagnostics.status !== 'valid') {
      throw new Error(`Recorded duration validation failed: merged ${mixedDiagnostics.status}; noise-only ${noiseDiagnostics.status}.`);
    }
    onProgress(1);
    return {
      mixedBlob,
      noiseBlob,
      mixedContainer: mixedDiagnostics.container,
      noiseContainer: noiseDiagnostics.container,
      mixedExtension: recorderProfile.mixedExtension,
      noiseExtension: recorderProfile.noiseExtension,
      capturePath: videoSource.kind,
      captureDiagnostics: { ...videoSource.diagnostics },
      recorderProfile: recorderProfile.id,
      sceneCount: synth.scenePlan.length,
      sceneSummary: engine.summarizeSceneTimeline(synth.scenePlan),
      spectralCount: synth.spectralComponents.length,
      durationDiagnostics: {
        targetDuration,
        sourceStartMediaTime,
        sourceEndMediaTime,
        sourceTimelineStatus: sourceDuration.status,
        captureWallDuration: sourceStartWallTime === null || sourceEndWallTime === null ? null : (sourceEndWallTime - sourceStartWallTime) / 1000,
        mixed: mixedDiagnostics,
        noise: noiseDiagnostics,
        toleranceSeconds: DURATION_TOLERANCE_SECONDS
      }
    };
  } finally {
    exportEnded = true;
    if (timer) clearInterval(timer);
    stopBoth();
    video.pause();
    video.onloadedmetadata = null;
    video.onloadeddata = null;
    video.onended = null;
    video.onerror = null;
    try { videoSource?.stop(); } catch {}
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch {}
    }
    for (const node of [src, sourceGain, noiseGain, mixedDestination, noiseDestination, analyser, silent]) {
      try { node?.disconnect(); } catch {}
    }
    if (videoStream) {
      for (const track of videoStream.getTracks()) track.stop();
    }
    if (ctx) {
      try { await ctx.close(); } catch {}
    }
    video.removeAttribute('src');
    try { video.load(); } catch {}
    URL.revokeObjectURL(objectUrl);
  }
}
