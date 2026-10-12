import { JavaScriptBackend } from './javascript-backend.js?v=1.10.0';
import { createWasmBackend } from './wasm-backend.js?v=1.7.0';

export const ENGINE_PREFERENCE_KEY = 'driftbed.processingEngine';
export const ENGINE_PREFERENCES = Object.freeze(['auto', 'wasm', 'javascript']);

export function normalizeEnginePreference(value) {
  return ENGINE_PREFERENCES.includes(value) ? value : 'auto';
}

export async function createProcessingEngine({ preference = 'auto', wasmUrl } = {}) {
  const normalized = normalizeEnginePreference(preference);
  if (normalized === 'javascript') return new JavaScriptBackend();
  if (normalized === 'wasm') return createWasmBackend({ url: wasmUrl });
  try {
    return await createWasmBackend({ url: wasmUrl });
  } catch (error) {
    const backend = new JavaScriptBackend();
    backend.fallbackReason = error?.message || String(error);
    return backend;
  }
}
