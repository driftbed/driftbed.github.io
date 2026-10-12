import { assertPcmShape, pcmDurationSeconds } from './media-duration.js?v=1.10.0';

export async function decodeFileToPcm(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buffer = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buffer);
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(new Float32Array(audio.getChannelData(c)));
    const { frameCount } = assertPcmShape(channels, 'Decoded PCM');
    return { channels, sampleRate: audio.sampleRate, frameCount, duration: pcmDurationSeconds(frameCount, audio.sampleRate) };
  } finally {
    await ctx.close();
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
