export function encodeWav16(channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0].length;
  const bytesPerSample = 2;
  const dataSize = frames * count * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (o, s) => { for (let i=0;i<s.length;i++) view.setUint8(o+i, s.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytesPerSample, true);
  view.setUint16(32, count * bytesPerSample, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i] || 0));
      view.setInt16(offset, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
