export async function decodeFileToPcm(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buffer = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(buffer.slice(0));
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(new Float32Array(audio.getChannelData(c)));
    return { channels, sampleRate: audio.sampleRate, duration: audio.duration };
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
