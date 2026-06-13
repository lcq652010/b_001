const WASM_URL = '/wasm/pixel_filter.wasm';
const ALLOC_ALIGN = 4;

let cachedModule = null;
let wasmInstance = null;
let wasmExports = null;
let wasmMemory = null;
let wasmReady = false;

const allocMap = new Map();

function getExports() {
    if (!wasmReady || !wasmExports) {
        throw new Error('WASM module not initialized. Call initFilter() first.');
    }
    return wasmExports;
}

async function loadModule() {
    if (cachedModule) return cachedModule;

    const resp = await fetch(WASM_URL);
    if (!resp.ok) {
        throw new Error(`Failed to load WASM: HTTP ${resp.status}`);
    }
    const bytes = await resp.arrayBuffer();

    try {
        const result = await WebAssembly.instantiateStreaming(resp, {});
        cachedModule = result.module;
    } catch {
        const result = await WebAssembly.instantiate(bytes, {});
        cachedModule = result.module;
    }

    return cachedModule;
}

async function initFilter() {
    if (wasmReady) return true;

    try {
        const module = await loadModule();
        const instance = await WebAssembly.instantiate(module, {});

        wasmInstance = instance;
        wasmExports = instance.exports;
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
        throw err;
    }
}

function isWasmReady() {
    return wasmReady;
}

function destroyFilter() {
    allocMap.clear();
    wasmExports = null;
    wasmMemory = null;
    wasmInstance = null;
    wasmReady = false;
}

function wasmMalloc(size) {
    const ex = getExports();
    const ptr = ex.malloc(size);
    if (!ptr) {
        throw new Error('WASM: failed to allocate memory');
    }
    allocMap.set(ptr, { size, align: ALLOC_ALIGN });
    return ptr;
}

function wasmFree(ptr) {
    const info = allocMap.get(ptr);
    if (!info) {
        console.warn('WASM: free called on unknown pointer', ptr);
        return;
    }
    const ex = getExports();
    ex.free(ptr, info.size);
    allocMap.delete(ptr);
}

function applyPixelFilter(imageData, blockSize = 16) {
    const { data, width, height } = imageData;
    const len = data.length;

    if (len === 0 || width === 0 || height === 0) {
        return imageData;
    }

    const ptr = wasmMalloc(len);

    try {
        const mem = new Uint8Array(wasmMemory.buffer);
        mem.set(data, ptr);

        const ex = getExports();
        ex.pixelate(ptr, len, width, height, blockSize);

        const result = new Uint8Array(wasmMemory.buffer, ptr, len);
        data.set(result);
    } finally {
        wasmFree(ptr);
    }

    return imageData;
}

function getModuleCached() {
    return cachedModule !== null;
}

function getAllocCount() {
    return allocMap.size;
}

export { initFilter, isWasmReady, destroyFilter, applyPixelFilter, wasmMalloc, wasmFree, getModuleCached, getAllocCount };
