import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasVideoCaptureSource } from '../src/video-capture-source.js';

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { getTracks: () => tracks, getVideoTracks: () => tracks };
}

test('canvas source follows presented frames and preserves decoded portrait dimensions', () => {
  let frameCallback = null;
  const video = {
    videoWidth: 512,
    videoHeight: 1108,
    currentTime: 0,
    requestVideoFrameCallback(callback) { frameCallback = callback; return 1; }
  };
  const calls = { fills: 0, draws: 0 };
  const stream = fakeStream();
  const context = {
    fillStyle: '',
    fillRect() { calls.fills++; },
    drawImage() { calls.draws++; }
  };
  const canvas = {
    captureStream() { return stream; },
    getContext() { return context; }
  };
  const source = createCanvasVideoCaptureSource({ video, canvas });
  assert.equal(canvas.width, 512);
  assert.equal(canvas.height, 1108);
  assert.equal(source.kind, 'canvas');
  assert.equal(source.diagnostics.framePump, 'requestVideoFrameCallback');
  frameCallback({ mediaTime: 0.033 });
  assert.equal(source.diagnostics.presentedFrameCount, 2);
  assert.equal(source.diagnostics.firstPresentedMediaTime, 0);
  assert.equal(source.diagnostics.lastPresentedMediaTime, 0.033);
  assert.equal(calls.fills, 2);
  assert.equal(calls.draws, 2);
  source.stop();
  assert.equal(stream.getTracks()[0].stopped, true);
});

test('canvas source uses animation frames when video-frame callbacks are unavailable', () => {
  let scheduled = 0;
  const video = { videoWidth: 640, videoHeight: 360, currentTime: 1 };
  const stream = fakeStream();
  const canvas = {
    captureStream() { return stream; },
    getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }
  };
  const source = createCanvasVideoCaptureSource({ video, canvas, requestAnimationFrameImpl() { scheduled++; return 7; }, cancelAnimationFrameImpl() {} });
  assert.equal(source.diagnostics.framePump, 'requestAnimationFrame');
  assert.equal(scheduled, 1);
  source.stop();
});
