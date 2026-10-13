import test from 'node:test';
import assert from 'node:assert/strict';
import { probeVideoExportCapabilities, selectRecorderProfile } from '../src/video-capabilities.js';

function recorderFor(supported) {
  return class FakeMediaRecorder {
    static isTypeSupported(type) { return supported.has(type); }
  };
}

test('capability probing keeps direct capture on WebM when both paired outputs support it', () => {
  const video = { captureStream() {}, requestVideoFrameCallback() {} };
  const canvas = { captureStream() {} };
  const supported = new Set([
    'video/webm;codecs=vp9,opus', 'audio/webm;codecs=opus',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'audio/mp4;codecs=mp4a.40.2'
  ]);
  const capabilities = probeVideoExportCapabilities({ video, canvas, MediaRecorderCtor: recorderFor(supported) });
  assert.equal(capabilities.directMediaCapture, true);
  assert.equal(capabilities.canvasCapture, true);
  assert.equal(capabilities.videoFrameCallback, true);
  assert.equal(selectRecorderProfile({ capabilities, captureKind: 'direct' }).container, 'webm');
});

test('canvas compatibility capture prefers MP4 when WebM is unavailable', () => {
  const video = { requestVideoFrameCallback() {} };
  const canvas = { captureStream() {} };
  const supported = new Set(['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'audio/mp4;codecs=mp4a.40.2']);
  const capabilities = probeVideoExportCapabilities({ video, canvas, MediaRecorderCtor: recorderFor(supported) });
  assert.equal(capabilities.directMediaCapture, false);
  assert.equal(selectRecorderProfile({ capabilities, captureKind: 'canvas' }).container, 'mp4');
});

test('unsupported recorder pairs fail before export starts', () => {
  const capabilities = probeVideoExportCapabilities({ video: {}, canvas: {}, MediaRecorderCtor: recorderFor(new Set()) });
  assert.throws(() => selectRecorderProfile({ capabilities, captureKind: 'canvas' }), /cannot encode|recording/i);
});
