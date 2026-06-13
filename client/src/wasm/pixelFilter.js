const WASM_URL = '/wasm/pixel_filter.wasm';

let wasmExports = null;
let wasmMemory = null;
let wasmReady = false;
let wasmModule = null;
let wasmInstance = null;

function getExports() {
    if (!wasmReady || !wasmExports) {
        throw new Error('WASM module not initialized. Call initFilter() first.');
    }
    return wasmExports;
}

async function initFilter() {
    if (wasmReady) return true;

    try {
        const resp = await fetch(WASM_URL);
        if (!resp.ok) {
            throw new Error(`Failed to load WASM: HTTP ${resp.status}`);
        }
        const bytes = await resp.arrayBuffer();

        try {
            const result = await WebAssembly.instantiateStreaming(resp, {});
            wasmInstance = result.instance;
            wasmModule = result.module;
        } catch {
            const result = await WebAssembly.instantiate(bytes, {});
            wasmInstance = result.instance;
            wasmModule = result.module;
        }

        wasmExports = wasmInstance.exports;
        wasmMemory = wasmExports.memory;
        wasmReady = true;

        if (typeof wasmExports.pixelate !== 'function') {
            throw new Error('WASM module missing pixelate() export');
        }
        if (typeof wasmExports.malloc !== 'function') {
            throw new Error('WASM module missing malloc() export');
        }
        if (typeof wasmExports.free !== 'function') {
            throw new Error('WASM module missing free() export');
        }

        return true;
    } catch (err) {
        wasmReady = false;
        wasmExports = null;
        wasmMemory = null;
        wasmInstance = null;
        wasmModule = null;
        throw err;
    }
}

function isWasmReady() {
    return wasmReady;
}

function destroyFilter() {
    if (wasmMemory && wasmMemory.buffer) {
        try {
            if (typeof WebAssembly.Memory.prototype.grow === 'function') {
            }
        } catch {}
    }
    wasmExports = null;
    wasmMemory = null;
    wasmInstance = null;
    wasmModule = null;
    wasmReady = false;
}

function applyPixelFilter(imageData, blockSize = 16) {
    const ex = getExports();
    const { data, width, height } = imageData;
    const len = data.length;

    if (len === 0 || width === 0 || height === 0) {
        return imageData;
    }

    const ptr = ex.malloc(len);
    if (!ptr) {
        throw new Error('WASM: failed to allocate memory for frame');
    }

    try {
        const mem = new Uint8Array(wasmMemory.buffer);
        mem.set(data, ptr);

        ex.pixelate(ptr, len, width, height, blockSize);

        const result = new Uint8Array(wasmMemory.buffer, ptr, len);
        data.set(result);
    } finally {
        ex.free(ptr, len);
    }

    return imageData;
}

export { initFilter, isWasmReady, destroyFilter, applyPixelFilter };
