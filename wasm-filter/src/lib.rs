use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn pixelate(data: &mut [u8], width: u32, height: u32, block_size: u32) {
    let bs = block_size.max(1);
    let by_count = (height + bs - 1) / bs;
    let bx_count = (width + bs - 1) / bs;

    for by in 0..by_count {
        for bx in 0..bx_count {
            let x0 = bx * bs;
            let y0 = by * bs;
            let x1 = ((bx + 1) * bs).min(width);
            let y1 = ((by + 1) * bs).min(height);

            let mut r_sum: u64 = 0;
            let mut g_sum: u64 = 0;
            let mut b_sum: u64 = 0;
            let mut a_sum: u64 = 0;
            let mut count: u64 = 0;

            for y in y0..y1 {
                for x in x0..x1 {
                    let idx = ((y * width + x) * 4) as usize;
                    if idx + 3 < data.len() {
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
                for x in x0..x1 {
                    let idx = ((y * width + x) * 4) as usize;
                    if idx + 3 < data.len() {
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
