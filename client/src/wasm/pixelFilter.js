let wasmExports = null;
let wasmReady = false;

function pixelateJS(data, width, height, blockSize) {
    const bs = Math.max(1, blockSize);
    const byCount = Math.ceil(height / bs);
    const bxCount = Math.ceil(width / bs);

    for (let by = 0; by < byCount; by++) {
        for (let bx = 0; bx < bxCount; bx++) {
            const x0 = bx * bs;
            const y0 = by * bs;
            const x1 = Math.min((bx + 1) * bs, width);
            const y1 = Math.min((by + 1) * bs, height);

            let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;

            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const idx = (y * width + x) * 4;
                    rSum += data[idx];
                    gSum += data[idx + 1];
                    bSum += data[idx + 2];
                    aSum += data[idx + 3];
                    count++;
                }
            }

            if (count === 0) continue;

            const avgR = (rSum / count) | 0;
            const avgG = (gSum / count) | 0;
            const avgB = (bSum / count) | 0;
            const avgA = (aSum / count) | 0;

            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const idx = (y * width + x) * 4;
                    data[idx] = avgR;
                    data[idx + 1] = avgG;
                    data[idx + 2] = avgB;
                    data[idx + 3] = avgA;
                }
            }
        }
    }
}

async function initWasmModule() {
    const WASM_URL = '/wasm/pixel_filter_bg.wasm';
    try {
        const imports = { wbg: {} };
        const stubs = [
            '__wbindgen_throw',
            '__wbindgen_error_new',
            '__wbindgen_object_drop_ref',
            '__wbindgen_is_undefined',
            '__wbindgen_in',
            '__wbindgen_is_object',
            '__wbindgen_is_string',
            '__wbindgen_is_function',
            '__wbindgen_is_null',
            '__wbindgen_boolean_get',
            '__wbindgen_number_get',
            '__wbindgen_string_get',
            '__wbindgen_cb_drop',
        ];
        stubs.forEach((name) => {
            imports.wbg[name] = function () { return 0; };
        });

        let instance;
        try {
            const resp = await fetch(WASM_URL);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const { instance: inst } = await WebAssembly.instantiateStreaming(resp, imports);
            instance = inst;
        } catch {
            const resp = await fetch(WASM_URL);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const bytes = await resp.arrayBuffer();
            const { instance: inst } = await WebAssembly.instantiate(bytes, imports);
            instance = inst;
        }

        const exports = instance.exports;
        if (typeof exports.pixelate === 'function' && exports.memory && exports.__wbindgen_malloc && exports.__wbindgen_free) {
            wasmExports = exports;
            wasmReady = true;
            return true;
        }
        throw new Error('Missing expected WASM exports');
    } catch (err) {
        console.warn('WASM module not available, using JS fallback:', err.message);
        wasmReady = false;
        return false;
    }
}

function pixelateWasm(data, width, height, blockSize) {
    if (!wasmExports || !wasmExports.__wbindgen_malloc) return false;

    const len = data.length;
    const ptr = wasmExports.__wbindgen_malloc(len);
    if (!ptr) return false;

    try {
        const mem = new Uint8Array(wasmExports.memory.buffer);
        mem.set(data, ptr);
        wasmExports.pixelate(ptr, len, width, height, blockSize);
        const result = new Uint8Array(wasmExports.memory.buffer, ptr, len);
        data.set(result);
    } finally {
        wasmExports.__wbindgen_free(ptr, len);
    }
    return true;
}

export async function initFilter() {
    return initWasmModule();
}

export function isWasmReady() {
    return wasmReady;
}

export function applyPixelFilter(imageData, blockSize = 16) {
    const { data, width, height } = imageData;

    if (wasmReady && wasmExports) {
        const ok = pixelateWasm(data, width, height, blockSize);
        if (ok) return imageData;
    }

    pixelateJS(data, width, height, blockSize);
    return imageData;
}
