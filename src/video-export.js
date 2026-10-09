import { EnvironmentalNoiseSynth, summarizeSceneTimeline } from './synth.js';

function createRecorder(stream, candidates) {
  const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || candidates[candidates.length - 1] || 'application/octet-stream' }));
    recorder.onerror = e => reject(e.error || new Error('MediaRecorder failed'));
  });
  return { recorder, done };
}

// Self-contained Chromium-oriented video path.
// It records the source video track with a Web Audio mixed audio track in real time,
// and simultaneously records the exact post-gain synthesized noise path as audio-only WebM.
export async function exportVideoRealtime({ file, seed, profile, variation, scenePace = 0.55, spectralDetail = 0.62, relativeDb, onProgress = () => {} }) {
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Browser could not decode this video.'));
  });
  if (!video.captureStream) throw new Error('This browser does not support video.captureStream(). Use current Chromium/Chrome/Edge.');

  const ctx = new AudioContext({ sampleRate: 48000 });
  const src = ctx.createMediaElementSource(video);
  const sourceGain = ctx.createGain();
  const noiseGain = ctx.createGain();
  const mixedDestination = ctx.createMediaStreamDestination();
  const noiseDestination = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(sourceGain).connect(mixedDestination);
  src.connect(analyser);

  // Measure a deterministic short segment of the raw synthetic bed so the realtime
  // path can target a source-relative level rather than an arbitrary absolute gain.
  const calibration = new EnvironmentalNoiseSynth({ seed, sampleRate: ctx.sampleRate, durationSeconds: video.duration, profile, variation, scenePace, spectralDetail });
  const calibrationFrames = Math.max(1, Math.min(Math.round(ctx.sampleRate * 1.5), Math.round(ctx.sampleRate * video.duration)));
  const [calL, calR] = calibration.render(calibrationFrames);
  let calSq = 0;
  for (let i = 0; i < calibrationFrames; i++) calSq += (calL[i] * calL[i] + calR[i] * calR[i]) * 0.5;
  const rawNoiseRms = Math.max(1e-7, Math.sqrt(calSq / calibrationFrames));
  let sourceLevelDb = -24;
  const initialNoiseRms = 10 ** ((sourceLevelDb + relativeDb) / 20);
  noiseGain.gain.value = initialNoiseRms / rawNoiseRms;

  const processor = ctx.createScriptProcessor(2048, 0, 2);
  const synth = new EnvironmentalNoiseSynth({ seed, sampleRate: ctx.sampleRate, durationSeconds: video.duration, profile, variation, scenePace, spectralDetail });
  processor.onaudioprocess = e => {
    const l = e.outputBuffer.getChannelData(0);
    const r = e.outputBuffer.getChannelData(1);
    for (let i = 0; i < l.length; i++) {
      const x = synth.nextStereo(); l[i] = x[0]; r[i] = x[1];
    }
  };
  processor.connect(noiseGain);
  noiseGain.connect(mixedDestination);
  noiseGain.connect(noiseDestination);

  // Export is silent to the user while it runs.
  const silent = ctx.createGain(); silent.gain.value = 0;
  src.connect(silent).connect(ctx.destination);
  processor.connect(silent);

  const videoStream = video.captureStream();
  const combined = new MediaStream();
  for (const track of videoStream.getVideoTracks()) combined.addTrack(track);
  for (const track of mixedDestination.stream.getAudioTracks()) combined.addTrack(track);

  const mixed = createRecorder(combined, [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]);
  const noiseOnly = createRecorder(noiseDestination.stream, [
    'audio/webm;codecs=opus',
    'audio/webm'
  ]);

  const meterBuffer = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    onProgress(video.duration ? video.currentTime / video.duration : 0);
    analyser.getFloatTimeDomainData(meterBuffer);
    let ss = 0;
    for (const x of meterBuffer) ss += x * x;
    const rms = Math.sqrt(ss / meterBuffer.length);
    const frameDb = 20 * Math.log10(Math.max(1e-8, rms));
    // Freeze through real silence; otherwise move slowly toward the program level.
    // This intentionally moves slowly so the background does not audibly pump.
    if (frameDb > -70) sourceLevelDb += 0.03 * (frameDb - sourceLevelDb);
    const targetNoiseRms = 10 ** ((sourceLevelDb + relativeDb) / 20);
    const targetGain = Math.min(4, Math.max(1e-6, targetNoiseRms / rawNoiseRms));
    noiseGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 3.0);
  }, 250);

  mixed.recorder.start(1000);
  noiseOnly.recorder.start(1000);
  await ctx.resume();
  await video.play();
  await new Promise((resolve, reject) => {
    video.onended = resolve;
    video.onerror = () => reject(new Error('Video playback failed during export.'));
  });
  mixed.recorder.stop();
  noiseOnly.recorder.stop();
  const [mixedBlob, noiseBlob] = await Promise.all([mixed.done, noiseOnly.done]);

  clearInterval(timer);
  onProgress(1);
  processor.disconnect();
  noiseGain.disconnect();
  src.disconnect();
  await ctx.close();
  URL.revokeObjectURL(video.src);
  return { mixedBlob, noiseBlob, sceneCount: synth.scenePlan.length, sceneSummary: summarizeSceneTimeline(synth.scenePlan), spectralCount: synth.spectralComponents.length };
}
