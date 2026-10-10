export const EXPECTED_WASM_ABI_VERSION = 1;
export const EXPECTED_NUMERIC_CONTRACT_VERSION = 1;
export const FULL_PIPELINE_CAPABILITY = 1 << 1;

function requiredExport(exports, name) {
  const value = exports[name];
  if (typeof value !== 'function') throw new Error(`Wasm core is missing export ${name}.`);
  return value;
}

async function instantiateWasm(url) {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly is unavailable in this browser.');
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Wasm core request failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  return WebAssembly.instantiate(bytes, {});
}

export async function loadWasmCore(url = new URL('../../wasm/driftbed_core.wasm', import.meta.url)) {
  const { instance } = await instantiateWasm(url);
  const exports = instance.exports;
  const abiVersion = requiredExport(exports, 'driftbed_abi_version')();
  const numericContractVersion = requiredExport(exports, 'driftbed_numeric_contract_version')();
  const capabilities = requiredExport(exports, 'driftbed_capabilities')();
  const selfTest = requiredExport(exports, 'driftbed_self_test')();
  if (abiVersion !== EXPECTED_WASM_ABI_VERSION) throw new Error(`Unsupported Wasm ABI version ${abiVersion}.`);
  if (numericContractVersion !== EXPECTED_NUMERIC_CONTRACT_VERSION) throw new Error(`Unsupported numeric contract version ${numericContractVersion}.`);
  if (selfTest !== 0) throw new Error(`Wasm core self-test failed with status ${selfTest}.`);
  return { instance, exports, abiVersion, numericContractVersion, capabilities };
}
