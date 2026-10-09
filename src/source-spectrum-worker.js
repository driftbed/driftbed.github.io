import { renderMultiComponentSourceSpectrumNoise } from './multi-component-spectrum-noise.js?v=1.6.0';

self.onmessage = event => {
  const data = event.data || {};
  if (data.type !== 'render') return;
  try {
    const left = new Float32Array(data.left);
    const right = data.right ? new Float32Array(data.right) : null;
    const result = renderMultiComponentSourceSpectrumNoise({
      channels: right ? [left, right] : [left],
      sampleRate: data.sampleRate,
      seed: data.seed,
      config: data.config,
      onProgress: progress => self.postMessage({ type: 'progress', ...progress })
    });
    const outputLeft = result.channels[0];
    const outputRight = result.channels[1];
    const transfer = [left.buffer, outputLeft.buffer, outputRight.buffer];
    if (right) transfer.push(right.buffer);
    self.postMessage({ type: 'result', sourceLeft: left.buffer, sourceRight: right?.buffer || null, outputLeft: outputLeft.buffer, outputRight: outputRight.buffer }, transfer);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
