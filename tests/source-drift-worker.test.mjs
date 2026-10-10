import test from 'node:test';
import assert from 'node:assert/strict';

const messages = [];
globalThis.self = { postMessage(message) { messages.push(message); } };
await import('../src/source-spectrum-worker.js?worker-test=1');

test('source worker accepts the derived-layer operation', async () => {
  messages.length = 0;
  const sampleRate = 8000;
  const left = new Float32Array(800);
  const right = new Float32Array(800);
  for (let i = 0; i < left.length; i++) {
    const value = 0.2 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
    left[i] = value;
    right[i] = 0.9 * value;
  }
  await self.onmessage({
    data: {
      type: 'renderDerived',
      left: left.buffer,
      right: right.buffer,
      sampleRate,
      seed: 'worker-derived-test',
      config: { analysisBands: 12, componentRank: 2, nmfIterations: 8, activationIterations: 3, templateTrainingFrames: 512 },
      driftConfig: { targetPowerShare: 0.08 }
    }
  });
  const result = messages.find(message => message.type === 'derivedResult');
  assert.ok(result);
  assert.equal(result.sourceDriftVersion, 1);
  assert.equal(new Float32Array(result.outputLeft).length, left.length);
  assert.equal(new Float32Array(result.driftLeft).length, left.length);
  assert.ok(result.driftDiagnostics.maxVoiceGainSum <= 0.10 + 1e-12);
});
