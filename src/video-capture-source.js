function drawVideoFrame(video, context, width, height, diagnostics) {
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  context.drawImage(video, 0, 0, width, height);
  diagnostics.presentedFrameCount++;
}

function createFramePump({ video, canvas, diagnostics, requestAnimationFrameImpl = globalThis.requestAnimationFrame, cancelAnimationFrameImpl = globalThis.cancelAnimationFrame }) {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a 2D canvas for video compatibility capture.');
  let stopped = false;
  let animationFrame = null;
  let videoFrameCallbackId = null;
  let started = false;

  const draw = metadata => {
    if (stopped) return;
    drawVideoFrame(video, context, canvas.width, canvas.height, diagnostics);
    if (metadata && Number.isFinite(metadata.mediaTime)) {
      if (diagnostics.firstPresentedMediaTime === null) diagnostics.firstPresentedMediaTime = metadata.mediaTime;
      diagnostics.lastPresentedMediaTime = metadata.mediaTime;
    }
  };

  const pumpWithVideoFrames = metadata => {
    draw(metadata);
    if (!stopped && typeof video.requestVideoFrameCallback === 'function') videoFrameCallbackId = video.requestVideoFrameCallback(pumpWithVideoFrames);
  };

  const pumpWithAnimationFrame = () => {
    draw({ mediaTime: Number(video.currentTime) });
    if (!stopped && typeof requestAnimationFrameImpl === 'function') animationFrame = requestAnimationFrameImpl(pumpWithAnimationFrame);
  };

  return {
    start() {
      if (started) return;
      started = true;
      draw({ mediaTime: Number(video.currentTime) });
      if (typeof video.requestVideoFrameCallback === 'function') videoFrameCallbackId = video.requestVideoFrameCallback(pumpWithVideoFrames);
      else if (typeof requestAnimationFrameImpl === 'function') animationFrame = requestAnimationFrameImpl(pumpWithAnimationFrame);
    },
    stop() {
      stopped = true;
      if (animationFrame !== null && typeof cancelAnimationFrameImpl === 'function') cancelAnimationFrameImpl(animationFrame);
      if (videoFrameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(videoFrameCallbackId);
    },
    diagnostics
  };
}

export function createDirectMediaCaptureSource({ video } = {}) {
  if (!video || typeof video.captureStream !== 'function') throw new Error('Direct media capture is unavailable.');
  const stream = video.captureStream();
  return {
    kind: 'direct',
    stream,
    diagnostics: { framePump: 'media-element-capture' },
    start() {},
    stop() { for (const track of stream.getTracks()) track.stop(); }
  };
}

export function createCanvasVideoCaptureSource({ video, canvas, requestAnimationFrameImpl, cancelAnimationFrameImpl } = {}) {
  if (!video || !canvas || typeof canvas.captureStream !== 'function') throw new Error('Canvas video capture is unavailable.');
  const width = Number(video.videoWidth);
  const height = Number(video.videoHeight);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('The video has no usable decoded dimensions.');
  canvas.width = width;
  canvas.height = height;
  const diagnostics = {
    presentedFrameCount: 0,
    firstPresentedMediaTime: null,
    lastPresentedMediaTime: null,
    canvasWidth: width,
    canvasHeight: height,
    framePump: typeof video.requestVideoFrameCallback === 'function' ? 'requestVideoFrameCallback' : 'requestAnimationFrame'
  };
  const pump = createFramePump({ video, canvas, diagnostics, requestAnimationFrameImpl, cancelAnimationFrameImpl });
  pump.start();
  const stream = canvas.captureStream();
  return {
    kind: 'canvas',
    stream,
    diagnostics,
    start() {},
    stop() {
      pump.stop();
      for (const track of stream.getTracks()) track.stop();
    }
  };
}

export function createVideoCaptureSource({ video, capabilities, canvas = null, requestAnimationFrameImpl, cancelAnimationFrameImpl } = {}) {
  if (capabilities?.directMediaCapture && typeof video?.captureStream === 'function') return createDirectMediaCaptureSource({ video });
  if (capabilities?.canvasCapture) {
    const targetCanvas = canvas || document.createElement('canvas');
    return createCanvasVideoCaptureSource({ video, canvas: targetCanvas, requestAnimationFrameImpl, cancelAnimationFrameImpl });
  }
  throw new Error('This browser can play the video, but it cannot create a local video recording from it.');
}
