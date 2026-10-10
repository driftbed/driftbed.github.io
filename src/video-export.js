import { classifyDuration, DURATION_TOLERANCE_SECONDS, measureBlobPlaybackDuration } from './media-duration.js?v=1.9.1';
import { inspectWebm } from './webm-container.js?v=1.9.1';

function createRecorder(stream, candidates, onError) {
  const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  let settled = false;
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      resolve(new Blob(chunks, { type: recorder.mimeType || candidates[candidates.length - 1] || 'application/octet-stream' }));
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

async function auditWebmBlob(blob, kind, targetDuration) {
  const inspection = inspectWebm(await blob.arrayBuffer());
  const playbackDuration = await measureBlobPlaybackDuration(blob, kind);
  const container = classifyDuration({ targetDuration, actualDuration: inspection.durationSeconds });
  const playback = classifyDuration({ targetDuration, actualDuration: playbackDuration });
  const status = container.status === 'valid' && playback.status === 'valid' ? 'valid' : `${container.status}/${playback.status}`;
  return {
    status,
    containerDuration: inspection.durationSeconds,
    playbackDuration,
    containerStatus: container.status,
    playbackStatus: playback.status,
    containerDeltaSeconds: container.deltaSeconds,
    playbackDeltaSeconds: playback.deltaSeconds,
    clusterCount: inspection.clusterCount,
    hasTracks: inspection.hasTracks
  };
}

// Self-contained Chromium-oriented video path.
// It records the source video track with a Web Audio mixed audio track in real time,
// and simultaneously records the exact post-gain synthesized noise path as audio-only WebM.
export async function exportVideoRealtime({ engine, file, seed, profile, variation, scenePace = 0.55, spectralDetail = 0.62, relativeDb, onProgress = () => {} }) {
  if (!engine) throw new Error('A processing engine is required for video export.');
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;

  let ctx = null;
  let processor = null;
  let timer = null;
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
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Browser could not decode this video.'));
    });
    const targetDuration = Number(video.duration);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error('Video has no finite, positive duration.');
    if (!video.captureStream) throw new Error('This browser does not support video.captureStream(). Use current Chromium/Chrome/Edge.');
    video.currentTime = 0;
    sourceStartMediaTime = video.currentTime;

    ctx = new AudioContext({ sampleRate: 48000 });
    src = ctx.createMediaElementSource(video);
    sourceGain = ctx.createGain();
    noiseGain = ctx.createGain();
    mixedDestination = ctx.createMediaStreamDestination();
    noiseDestination = ctx.createMediaStreamDestination();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(sourceGain).connect(mixedDestination);
    src.connect(analyser);

    // Measure a deterministic short segment of the raw synthetic bed so the realtime
    // path can target a source-relative level rather than an arbitrary absolute gain.
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

    // Export is silent to the user while it runs.
    silent = ctx.createGain();
    silent.gain.value = 0;
    src.connect(silent).connect(ctx.destination);
    processor.connect(silent);

    videoStream = video.captureStream();
    const combined = new MediaStream();
    for (const track of videoStream.getVideoTracks()) combined.addTrack(track);
    for (const track of mixedDestination.stream.getAudioTracks()) combined.addTrack(track);

    const recorderError = error => {
      rejectPlaybackEnded(error instanceof Error ? error : new Error(String(error)));
      stopBoth();
    };
    mixed = createRecorder(combined, [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ], recorderError);
    noiseOnly = createRecorder(noiseDestination.stream, [
      'audio/webm;codecs=opus',
      'audio/webm'
    ], recorderError);
    stopBoth = () => {
      mixed?.stop();
      noiseOnly?.stop();
    };

    video.onended = () => {
      if (exportEnded) return;
      exportEnded = true;
      sourceEndMediaTime = video.currentTime;
      sourceEndWallTime = performance.now();
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
      // Freeze through real silence; otherwise move slowly toward the program level.
      // This intentionally moves slowly so the background does not audibly pump.
      if (frameDb > -70) sourceLevelDb += 0.03 * (frameDb - sourceLevelDb);
      const targetNoiseRms = 10 ** ((sourceLevelDb + requestedRelativeDb) / 20);
      const targetGain = Math.min(4, Math.max(1e-6, targetNoiseRms / rawNoiseRms));
      noiseGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 3.0);
    }, 250);

    await ctx.resume();
    // Start both recorders back-to-back, then invoke playback without an intervening await.
    mixed.recorder.start();
    noiseOnly.recorder.start();
    sourceStartWallTime = performance.now();
    const playPromise = video.play();
    await playPromise;
    await playbackEnded;
    const [mixedBlob, noiseBlob] = await Promise.all([mixed.done, noiseOnly.done]);

    const sourceDuration = classifyDuration({ targetDuration, actualDuration: sourceEndMediaTime });
    if (sourceDuration.status !== 'valid') throw new Error(`Video ended at ${sourceEndMediaTime?.toFixed?.(3) || 'an unknown'} seconds; expected ${targetDuration.toFixed(3)} seconds.`);
    const mixedDiagnostics = await auditWebmBlob(mixedBlob, 'video', targetDuration);
    const noiseDiagnostics = await auditWebmBlob(noiseBlob, 'audio', targetDuration);
    if (mixedDiagnostics.status !== 'valid' || noiseDiagnostics.status !== 'valid') {
      throw new Error(`Recorded duration validation failed: merged ${mixedDiagnostics.status}; noise-only ${noiseDiagnostics.status}.`);
    }
    onProgress(1);
    return {
      mixedBlob,
      noiseBlob,
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
    video.onended = null;
    video.onerror = null;
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
