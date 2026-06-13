const WASM_URL = '/wasm/pixel_filter.wasm';

let cachedModule = null;
let sharedMemory = null;
let wasmInstance = null;
let wasmExports = null;
let wasmReady = false;

console.log('[WASM] pixelFilter.js loaded, waiting for initFilter()');

function getExports() {
    if (!wasmReady || !wasmExports) {
        throw new Error('WASM module not initialized. Call initFilter() first.');
    }
    return wasmExports;
}

async function loadModule() {
    if (cachedModule) {
        console.log('[WASM] Reusing cached compiled module');
        return cachedModule;
    }

    console.log(`[WASM] Loading module from ${WASM_URL}`);
    const resp = await fetch(WASM_URL);
    if (!resp.ok) {
        const err = new Error(`Failed to load WASM: HTTP ${resp.status}`);
        console.error('[WASM] Module load failed:', err.message);
        throw err;
    }
    const contentLen = resp.headers.get('content-length');
    console.log(`[WASM] Fetch success, size: ${contentLen || 'unknown'} bytes`);

    const bytes = await resp.arrayBuffer();
    console.log(`[WASM] Downloaded ${bytes.byteLength} bytes, compiling...`);

    try {
        const result = await WebAssembly.instantiate(bytes, {});
        cachedModule = result.module;
        console.log('[WASM] Compiled successfully');
    } catch (err) {
        console.error('[WASM] Compilation failed:', err.message);
        throw err;
    }

    return cachedModule;
}

async function initFilter() {
    if (wasmReady && wasmExports?.pixelate) {
        console.log('[WASM] Already initialized');
        return true;
    }

    if (cachedModule && sharedMemory && !wasmReady) {
        try {
            console.log('[WASM] Reinitializing from cached module + shared memory');
            const instance = await WebAssembly.instantiate(cachedModule, {
                env: { memory: sharedMemory },
            });
            wasmInstance = instance;
            wasmExports = instance.exports;
            wasmReady = true;
            console.log('[WASM] Reinitialized successfully');
            return true;
        } catch (reuseErr) {
            console.warn('[WASM] Failed to reuse, fresh init:', reuseErr.message);
        }
    }

    console.log('[WASM] Starting fresh initialization...');
    const module = await loadModule();

    const importObj = {};
    if (sharedMemory) {
        importObj.env = { memory: sharedMemory };
        console.log('[WASM] Using shared memory for new instance');
    }

    const instance = await WebAssembly.instantiate(module, importObj);
    wasmInstance = instance;
    wasmExports = instance.exports;

    if (!sharedMemory) {
        sharedMemory = wasmExports.memory;
        const memPages = sharedMemory.buffer.byteLength / (64 * 1024);
        console.log(`[WASM] Initial memory: ${memPages} pages (${memPages * 64} KB)`);
    }

    const exportNames = Object.keys(wasmExports).filter(k => typeof wasmExports[k] === 'function');
    console.log(`[WASM] Exports (${exportNames.length} functions):`, exportNames.join(', '));

    if (typeof wasmExports.pixelate !== 'function') {
        throw new Error('WASM module missing pixelate() export — cannot process frames');
    }
    if (typeof wasmExports.malloc !== 'function') {
        throw new Error('WASM module missing malloc() export — cannot allocate memory');
    }
    if (typeof wasmExports.free !== 'function') {
        throw new Error('WASM module missing free() export — cannot release memory');
    }

    wasmReady = true;
    console.log('[WASM] ✅ Fully initialized and ready to process frames');
    return true;
}

function isWasmReady() {
    return wasmReady;
}

function destroyFilter() {
    console.log('[WASM] Destroying instance (keeping cached module and memory)');
    wasmExports = null;
    wasmInstance = null;
    wasmReady = false;
}

function fullDestroyFilter() {
    console.log('[WASM] Full destroy — clearing module and memory cache');
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
        throw new Error(`WASM: failed to allocate ${len} bytes for ${width}x${height} frame`);
    }

    try {
        const mem = new Uint8Array(sharedMemory.buffer);
        mem.set(data, ptr);

        const t0 = performance.now();
        ex.pixelate(ptr, len, width, height, blockSize);
        const t1 = performance.now();

        const result = new Uint8Array(sharedMemory.buffer, ptr, len);
        data.set(result);

        const allocCount = typeof ex.alloc_count === 'function' ? ex.alloc_count() : 'N/A';
        console.debug(
            `[WASM] pixelate ${width}x${height} block=${blockSize} in ${(t1 - t0).toFixed(2)}ms ` +
            `(alloc=${len} bytes, pending allocs=${allocCount})`
        );
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
