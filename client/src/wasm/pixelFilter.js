const WASM_URL = '/wasm/pixel_filter.wasm';

let cachedModule = null;
let sharedMemory = null;
let wasmInstance = null;
let wasmExports = null;
let wasmReady = false;

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
    if (wasmReady && wasmExports?.pixelate) {
        return true;
    }

    try {
        const module = await loadModule();

        const importObj = {};
        if (sharedMemory) {
            importObj.env = { memory: sharedMemory };
        }

        const instance = await WebAssembly.instantiate(module, importObj);

        wasmInstance = instance;
        wasmExports = instance.exports;

        if (!sharedMemory) {
            sharedMemory = wasmExports.memory;
        }

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
        wasmInstance = null;
        throw err;
    }
}

function isWasmReady() {
    return wasmReady;
}

function destroyFilter() {
    wasmExports = null;
    wasmInstance = null;
    wasmReady = false;
}

function fullDestroyFilter() {
    destroyFilter();
    cachedModule = null;
    sharedMemory = null;
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
        const mem = new Uint8Array(sharedMemory.buffer);
        mem.set(data, ptr);

        ex.pixelate(ptr, len, width, height, blockSize);

        const result = new Uint8Array(sharedMemory.buffer, ptr, len);
        data.set(result);
    } finally {
        ex.free(ptr);
    }

    return imageData;
}

function getModuleCached() {
    return cachedModule !== null;
}

function getMemoryShared() {
    return sharedMemory !== null;
}

function getAllocCount() {
    if (wasmExports && typeof wasmExports.alloc_count === 'function') {
        return wasmExports.alloc_count();
    }
    return 0;
}

export {
    initFilter,
    isWasmReady,
    destroyFilter,
    fullDestroyFilter,
    applyPixelFilter,
    getModuleCached,
    getMemoryShared,
    getAllocCount,
};
