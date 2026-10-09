const EPSILON = 1e-12;

function frameTotal(power, bandCount, frameCount, frame) {
  let total = 0;
  for (let band = 0; band < bandCount; band++) total += power[band * frameCount + frame] || 0;
  return total;
}

function normalizeFrame(power, bandCount, frameCount, frame, output, outputFrame) {
  const total = Math.max(EPSILON, frameTotal(power, bandCount, frameCount, frame));
  for (let band = 0; band < bandCount; band++) output[band * outputFrame + frame] = (power[band * frameCount + frame] || 0) / total;
  return total;
}

/** Select a deterministic, approximately even subset of active frames. */
export function selectTrainingFrames(power, bandCount, frameCount, maxFrames = 4096) {
  const limit = Math.max(1, Math.floor(Number(maxFrames) || 4096));
  const active = [];
  for (let frame = 0; frame < frameCount; frame++) {
    if (frameTotal(power, bandCount, frameCount, frame) > EPSILON) active.push(frame);
  }
  if (active.length <= limit) return active;
  const selected = [];
  for (let i = 0; i < limit; i++) {
    selected.push(active[Math.floor(i * active.length / limit)]);
  }
  return selected;
}

function initializeTemplates(power, bandCount, frameCount, trainingFrames, rank) {
  const trainingCount = trainingFrames.length;
  const normalized = new Float64Array(bandCount * trainingCount);
  const totals = new Float64Array(trainingCount);
  for (let j = 0; j < trainingCount; j++) totals[j] = normalizeFrame(power, bandCount, frameCount, trainingFrames[j], normalized, trainingCount);

  const chosen = new Int32Array(rank);
  let first = 0;
  for (let j = 1; j < trainingCount; j++) if (totals[j] > totals[first]) first = j;
  chosen[0] = first;
  for (let component = 1; component < rank; component++) {
    let bestFrame = component % trainingCount;
    let bestDistance = -Infinity;
    for (let candidate = 0; candidate < trainingCount; candidate++) {
      let nearest = Infinity;
      for (let previous = 0; previous < component; previous++) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        const selected = chosen[previous];
        for (let band = 0; band < bandCount; band++) {
          const a = normalized[band * trainingCount + candidate];
          const b = normalized[band * trainingCount + selected];
          dot += a * b;
          normA += a * a;
          normB += b * b;
        }
        const similarity = dot / Math.sqrt(Math.max(EPSILON, normA * normB));
        nearest = Math.min(nearest, 1 - similarity);
      }
      if (nearest > bestDistance || (nearest === bestDistance && candidate < bestFrame)) {
        bestDistance = nearest;
        bestFrame = candidate;
      }
    }
    chosen[component] = bestFrame;
  }

  const templates = new Float64Array(bandCount * rank);
  for (let component = 0; component < rank; component++) {
    const frame = chosen[component];
    for (let band = 0; band < bandCount; band++) templates[band * rank + component] = normalized[band * trainingCount + frame];
  }
  return { templates, totals };
}

function computeRatio(power, bandCount, componentCount, columnCount, templates, activations, wh, ratio) {
  for (let band = 0; band < bandCount; band++) {
    for (let column = 0; column < columnCount; column++) {
      let reconstruction = EPSILON;
      for (let component = 0; component < componentCount; component++) {
        reconstruction += templates[band * componentCount + component] * activations[component * columnCount + column];
      }
      const index = band * columnCount + column;
      wh[index] = reconstruction;
      ratio[index] = (power[index] || 0) / reconstruction;
    }
  }
}

function normalizeTemplatesInPlace(templates, activations, bandCount, componentCount, columnCount) {
  for (let component = 0; component < componentCount; component++) {
    let total = 0;
    for (let band = 0; band < bandCount; band++) total += templates[band * componentCount + component];
    const safeTotal = Math.max(EPSILON, total);
    for (let band = 0; band < bandCount; band++) templates[band * componentCount + component] /= safeTotal;
    for (let column = 0; column < columnCount; column++) activations[component * columnCount + column] *= safeTotal;
  }
}

/** Normalize W columns and transfer scale into H. */
export function normalizeTemplates(templates, activations, bandCount, componentCount, frameCount) {
  normalizeTemplatesInPlace(templates, activations, bandCount, componentCount, frameCount);
  return { templates, activations };
}

/** KL divergence for band-major nonnegative matrices. */
export function klDivergence(power, templates, activations, bandCount, componentCount, frameCount) {
  let cost = 0;
  for (let band = 0; band < bandCount; band++) {
    for (let frame = 0; frame < frameCount; frame++) {
      let reconstruction = EPSILON;
      for (let component = 0; component < componentCount; component++) reconstruction += templates[band * componentCount + component] * activations[component * frameCount + frame];
      const value = Math.max(0, power[band * frameCount + frame] || 0);
      if (value > EPSILON) cost += value * Math.log(value / reconstruction) - value + reconstruction;
      else cost += reconstruction;
    }
  }
  return cost;
}

function updateActivations(power, templates, activations, bandCount, componentCount, frameCount, iterations, epsilon) {
  const wh = new Float64Array(bandCount * frameCount);
  const ratio = new Float64Array(bandCount * frameCount);
  for (let iteration = 0; iteration < iterations; iteration++) {
    computeRatio(power, bandCount, componentCount, frameCount, templates, activations, wh, ratio);
    for (let component = 0; component < componentCount; component++) {
      let denominator = 0;
      for (let band = 0; band < bandCount; band++) denominator += templates[band * componentCount + component];
      const safeDenominator = Math.max(epsilon, denominator);
      for (let frame = 0; frame < frameCount; frame++) {
        let numerator = 0;
        for (let band = 0; band < bandCount; band++) numerator += templates[band * componentCount + component] * ratio[band * frameCount + frame];
        activations[component * frameCount + frame] *= numerator / safeDenominator;
        if (!Number.isFinite(activations[component * frameCount + frame])) activations[component * frameCount + frame] = 0;
      }
    }
  }
}

/** Infer all-frame activations for fixed deterministic spectral templates. */
export function inferActivations(power, templates, bandCount, componentCount, frameCount, {
  iterations = 10,
  epsilon = EPSILON
} = {}) {
  const activations = new Float64Array(componentCount * frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const total = frameTotal(power, bandCount, frameCount, frame);
    for (let component = 0; component < componentCount; component++) activations[component * frameCount + frame] = Math.max(epsilon, total / componentCount);
  }
  updateActivations(power, templates, activations, bandCount, componentCount, frameCount, Math.max(0, Math.floor(iterations)), epsilon);
  return new Float32Array(activations);
}

/** Merge near-duplicate template columns while preserving their activation energy. */
export function mergeDuplicateComponents(templates, activations, bandCount, componentCount, frameCount, threshold = 0.995) {
  const keep = new Array(componentCount).fill(true);
  for (let left = 0; left < componentCount; left++) {
    if (!keep[left]) continue;
    let leftNorm = 0;
    for (let band = 0; band < bandCount; band++) leftNorm += templates[band * componentCount + left] ** 2;
    for (let right = left + 1; right < componentCount; right++) {
      if (!keep[right]) continue;
      let rightNorm = 0;
      let dot = 0;
      for (let band = 0; band < bandCount; band++) {
        const a = templates[band * componentCount + left];
        const b = templates[band * componentCount + right];
        dot += a * b;
        rightNorm += b * b;
      }
      const similarity = dot / Math.sqrt(Math.max(EPSILON, leftNorm * rightNorm));
      if (similarity < threshold) continue;
      for (let frame = 0; frame < frameCount; frame++) activations[left * frameCount + frame] += activations[right * frameCount + frame];
      keep[right] = false;
    }
  }
  const active = [];
  for (let component = 0; component < componentCount; component++) if (keep[component]) active.push(component);
  const compactTemplates = new Float32Array(bandCount * active.length);
  const compactActivations = new Float32Array(active.length * frameCount);
  for (let newComponent = 0; newComponent < active.length; newComponent++) {
    const oldComponent = active[newComponent];
    for (let band = 0; band < bandCount; band++) compactTemplates[band * active.length + newComponent] = templates[band * componentCount + oldComponent];
    for (let frame = 0; frame < frameCount; frame++) compactActivations[newComponent * frameCount + frame] = activations[oldComponent * frameCount + frame];
  }
  return { templates: compactTemplates, activations: compactActivations, componentCount: active.length };
}

/** Deterministic KL-NMF with farthest-point frame initialization. */
export function factorizeNmf(power, bandCount, frameCount, {
  rank = 4,
  trainingMaxFrames = 4096,
  iterations = 60,
  activationIterations = 10,
  epsilon = EPSILON,
  mergeThreshold = 0.995
} = {}) {
  const componentRank = Math.max(1, Math.floor(Number(rank) || 4));
  const trainingFrames = selectTrainingFrames(power, bandCount, frameCount, trainingMaxFrames);
  if (!trainingFrames.length) {
    return {
      templates: new Float32Array(bandCount * componentRank),
      activations: new Float32Array(componentRank * frameCount),
      componentCount: componentRank,
      trainingFrames,
      costs: []
    };
  }
  const trainingCount = trainingFrames.length;
  const trainingPower = new Float64Array(bandCount * trainingCount);
  for (let band = 0; band < bandCount; band++) for (let column = 0; column < trainingCount; column++) trainingPower[band * trainingCount + column] = power[band * frameCount + trainingFrames[column]] || 0;
  const initialized = initializeTemplates(power, bandCount, frameCount, trainingFrames, componentRank);
  const templates = initialized.templates;
  const activations = new Float64Array(componentRank * trainingCount);
  for (let column = 0; column < trainingCount; column++) {
    const total = initialized.totals[column];
    for (let component = 0; component < componentRank; component++) activations[component * trainingCount + column] = Math.max(epsilon, total / componentRank);
  }
  const wh = new Float64Array(bandCount * trainingCount);
  const ratio = new Float64Array(bandCount * trainingCount);
  const costs = [klDivergence(trainingPower, templates, activations, bandCount, componentRank, trainingCount)];
  for (let iteration = 0; iteration < Math.max(0, Math.floor(iterations)); iteration++) {
    computeRatio(trainingPower, bandCount, componentRank, trainingCount, templates, activations, wh, ratio);
    for (let component = 0; component < componentRank; component++) {
      let denominator = 0;
      for (let band = 0; band < bandCount; band++) denominator += templates[band * componentRank + component];
      const safeDenominator = Math.max(epsilon, denominator);
      for (let column = 0; column < trainingCount; column++) {
        let numerator = 0;
        for (let band = 0; band < bandCount; band++) numerator += templates[band * componentRank + component] * ratio[band * trainingCount + column];
        activations[component * trainingCount + column] *= numerator / safeDenominator;
      }
    }
    computeRatio(trainingPower, bandCount, componentRank, trainingCount, templates, activations, wh, ratio);
    for (let band = 0; band < bandCount; band++) {
      for (let component = 0; component < componentRank; component++) {
        let numerator = 0;
        let denominator = 0;
        for (let column = 0; column < trainingCount; column++) {
          numerator += activations[component * trainingCount + column] * ratio[band * trainingCount + column];
          denominator += activations[component * trainingCount + column];
        }
        templates[band * componentRank + component] *= numerator / Math.max(epsilon, denominator);
      }
    }
    normalizeTemplatesInPlace(templates, activations, bandCount, componentRank, trainingCount);
    costs.push(klDivergence(trainingPower, templates, activations, bandCount, componentRank, trainingCount));
  }

  const finalTemplates = new Float32Array(templates);
  const fullActivations = inferActivations(power, finalTemplates, bandCount, componentRank, frameCount, { iterations: activationIterations, epsilon });
  const merged = mergeDuplicateComponents(finalTemplates, fullActivations, bandCount, componentRank, frameCount, mergeThreshold);
  return { ...merged, trainingFrames, costs };
}
