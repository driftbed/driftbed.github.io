import { renderMultiComponentSourceSpectrumNoise, renderSourceDerivedLayers } from './multi-component-spectrum-noise.js?v=1.11.0';

self.onmessage = event => {
  const data = event.data || {};
  if (data.type !== 'render' && data.type !== 'renderDerived') return;
  try {
    const left = new Float32Array(data.left);
    const right = data.right ? new Float32Array(data.right) : null;
    if (data.type === 'renderDerived') {
      const result = renderSourceDerivedLayers({
        channels: right ? [left, right] : [left],
        sampleRate: data.sampleRate,
        seed: data.seed,
        config: data.config,
        driftConfig: data.driftConfig,
        onProgress: progress => self.postMessage({ type: 'progress', ...progress })
      });
      const outputLeft = result.sourceStochasticNoise[0];
      const outputRight = result.sourceStochasticNoise[1];
      const driftLeft = result.sourceDrift[0];
      const driftRight = result.sourceDrift[1];
      const transfer = [left.buffer, outputLeft.buffer, outputRight.buffer, driftLeft.buffer, driftRight.buffer];
      if (right) transfer.push(right.buffer);
      self.postMessage({
        type: 'derivedResult',
        sourceLeft: left.buffer,
        sourceRight: right?.buffer || null,
        outputLeft: outputLeft.buffer,
        outputRight: outputRight.buffer,
        driftLeft: driftLeft.buffer,
        driftRight: driftRight.buffer,
        driftDiagnostics: result.driftDiagnostics,
        sourceDriftVersion: result.sourceDriftVersion,
        sourceFrequencyVariedNoiseDiagnostics: result.sourceFrequencyVariedNoiseDiagnostics,
        sourceFrequencyVariedNoiseVersion: result.sourceFrequencyVariedNoiseVersion
      }, transfer);
      return;
    }
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
