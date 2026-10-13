import { assertPcmShape, assertSampleRate, pcmDurationSeconds } from './media-duration.js?v=1.11.0';

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWav16(channels, sampleRate) {
  const { channelCount: count, frameCount: frames } = assertPcmShape(channels, 'WAV PCM');
  assertSampleRate(sampleRate, 'WAV sample rate');
  const bytesPerSample = 2;
  const dataSize = frames * count * bytesPerSample;
  if (!Number.isSafeInteger(dataSize) || dataSize > 0xffffffff || dataSize + 44 > 0xffffffff + 8) {
    throw new Error('WAV output is too large for a RIFF container.');
  }
  const blockAlign = count * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  if (!Number.isSafeInteger(byteRate) || byteRate > 0xffffffff || blockAlign > 0xffff) {
    throw new Error('WAV format values exceed the PCM header limits.');
  }
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const sample = Number(channels[c][i]);
      if (!Number.isFinite(sample)) throw new Error(`WAV PCM sample ${c}:${i} is not finite.`);
      const x = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function inspectWav(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE') {
    throw new Error('The blob is not a RIFF/WAVE file.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format = null;
  let dataOffset = null;
  let dataSize = null;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    const end = payload + size;
    if (end > bytes.length) throw new Error(`WAV ${id} chunk exceeds the file boundary.`);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is truncated.');
      format = {
        audioFormat: view.getUint16(payload, true),
        channels: view.getUint16(payload + 2, true),
        sampleRate: view.getUint32(payload + 4, true),
        byteRate: view.getUint32(payload + 8, true),
        blockAlign: view.getUint16(payload + 12, true),
        bitsPerSample: view.getUint16(payload + 14, true)
      };
    } else if (id === 'data') {
      dataOffset = payload;
      dataSize = size;
    }
    offset = end + (size & 1);
  }
  if (!format || dataOffset === null) throw new Error('WAV file must contain fmt and data chunks.');
  if (format.audioFormat !== 1 || format.channels < 1 || format.bitsPerSample !== 16) throw new Error('WAV file is not PCM16.');
  if (format.blockAlign !== format.channels * 2 || dataSize % format.blockAlign !== 0) throw new Error('WAV data is not aligned to complete PCM frames.');
  const frameCount = dataSize / format.blockAlign;
  return {
    ...format,
    frameCount,
    duration: pcmDurationSeconds(frameCount, format.sampleRate),
    dataOffset,
    dataSize
  };
}
