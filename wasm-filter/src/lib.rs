use std::alloc::{alloc, dealloc, Layout};

#[no_mangle]
pub extern "C" fn malloc(size: u32) -> *mut u8 {
    let s = size as usize;
    if s == 0 {
        return std::ptr::null_mut();
    }
    let layout = Layout::from_size_align(s, 4).unwrap();
    unsafe { alloc(layout) }
}

#[no_mangle]
pub extern "C" fn free(ptr: *mut u8, size: u32) {
    if ptr.is_null() {
        return;
    }
    let s = size as usize;
    if s == 0 {
        return;
    }
    let layout = Layout::from_size_align(s, 4).unwrap();
    unsafe { dealloc(ptr, layout); }
}

#[no_mangle]
pub extern "C" fn pixelate(ptr: *mut u8, len: u32, width: u32, height: u32, block_size: u32) {
    if ptr.is_null() || len == 0 || width == 0 || height == 0 {
        return;
    }
    let data = unsafe { std::slice::from_raw_parts_mut(ptr, len as usize) };

    let bs = block_size.max(1);
    let by_count = (height + bs - 1) / bs;
    let bx_count = (width + bs - 1) / bs;
    let w = width as usize;
    let expected_len = (width as usize) * (height as usize) * 4;

    for by in 0..by_count {
        for bx in 0..bx_count {
            let x0 = (bx * bs) as usize;
            let y0 = (by * bs) as usize;
            let x1 = (((bx + 1) * bs).min(width)) as usize;
            let y1 = (((by + 1) * bs).min(height)) as usize;

            let mut r_sum: u64 = 0;
            let mut g_sum: u64 = 0;
            let mut b_sum: u64 = 0;
            let mut a_sum: u64 = 0;
            let mut count: u64 = 0;

            for y in y0..y1 {
                let row_start = y * w * 4;
                for x in x0..x1 {
                    let idx = row_start + x * 4;
                    if idx + 3 < expected_len && idx + 3 < data.len() {
                        r_sum += data[idx] as u64;
                        g_sum += data[idx + 1] as u64;
                        b_sum += data[idx + 2] as u64;
                        a_sum += data[idx + 3] as u64;
                        count += 1;
                    }
                }
            }

            if count == 0 {
                continue;
            }

            let avg_r = (r_sum / count) as u8;
            let avg_g = (g_sum / count) as u8;
            let avg_b = (b_sum / count) as u8;
            let avg_a = (a_sum / count) as u8;

            for y in y0..y1 {
                let row_start = y * w * 4;
                for x in x0..x1 {
                    let idx = row_start + x * 4;
                    if idx + 3 < expected_len && idx + 3 < data.len() {
                        data[idx] = avg_r;
                        data[idx + 1] = avg_g;
                        data[idx + 2] = avg_b;
                        data[idx + 3] = avg_a;
                    }
                }
            }
        }
    }
}
