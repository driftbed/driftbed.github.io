import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav16, inspectWav } from '../src/wav.js';

for (const sampleRate of [44100, 48000]) {
  for (const frameCount of [1, 479, 480, 48001, 44117]) {
    for (const channels of [1, 2]) {
      test(`WAV preserves ${frameCount} frames at ${sampleRate} Hz across ${channels} channel(s)`, async () => {
        const pcm = Array.from({ length: channels }, (_, channel) => {
          const output = new Float32Array(frameCount);
          if (frameCount) output[frameCount - 1] = channel ? -0.5 : 0.5;
          return output;
        });
        const blob = encodeWav16(pcm, sampleRate);
        assert.equal(blob.size, 44 + frameCount * channels * 2);
        const header = new Uint8Array(await blob.arrayBuffer());
        assert.equal(String.fromCharCode(...header.slice(0, 4)), 'RIFF');
        assert.equal(String.fromCharCode(...header.slice(8, 12)), 'WAVE');
        const inspected = await inspectWav(blob);
        assert.equal(inspected.channels, channels);
        assert.equal(inspected.sampleRate, sampleRate);
        assert.equal(inspected.frameCount, frameCount);
        assert.equal(inspected.duration, frameCount / sampleRate);
      });
    }
  }
}

test('WAV encoder rejects unequal channels and non-finite samples', () => {
  assert.throws(() => encodeWav16([new Float32Array(2), new Float32Array(1)], 48000), /equal frame counts/);
  const invalid = new Float32Array([0, Number.NaN]);
  assert.throws(() => encodeWav16([invalid], 48000), /not finite/);
});
