import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPcmShape, classifyDuration, DURATION_STATUS, pcmDurationSeconds } from '../src/media-duration.js';

test('PCM duration is derived from exact frame count', () => {
  assert.equal(pcmDurationSeconds(44117, 44100), 44117 / 44100);
  assert.deepEqual(assertPcmShape([new Float32Array(3), new Float32Array(3)], 'fixture'), { channelCount: 2, frameCount: 3 });
  assert.throws(() => assertPcmShape([new Float32Array(3), new Float32Array(2)], 'fixture'), /equal frame counts/);
});

test('duration classification distinguishes missing, short, long, and valid output', () => {
  assert.equal(classifyDuration({ targetDuration: 2, actualDuration: null }).status, DURATION_STATUS.METADATA_MISSING);
  assert.equal(classifyDuration({ targetDuration: 2, actualDuration: 1.5, tolerance: 0.1 }).status, DURATION_STATUS.TOO_SHORT);
  assert.equal(classifyDuration({ targetDuration: 2, actualDuration: 2.2, tolerance: 0.1 }).status, DURATION_STATUS.TOO_LONG);
  assert.equal(classifyDuration({ targetDuration: 2, actualDuration: 2.05, tolerance: 0.1 }).status, DURATION_STATUS.VALID);
});
