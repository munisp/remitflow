//! Image decoding via the vendored stb_image shim (csrc/stb_shim.c).
//! Returns interleaved RGB888 pixels. FAIL CLOSED: any decode problem is an
//! error; callers must never fall back to pseudo-embeddings.

use std::ffi::CStr;

extern "C" {
    fn rf_decode_rgb(data: *const u8, len: i32, out_w: *mut i32, out_h: *mut i32) -> *mut u8;
    fn rf_img_free(p: *mut u8);
    fn rf_img_last_error() -> *const std::os::raw::c_char;
}

/// Interleaved RGB888 image.
pub struct RgbImage {
    pub width: usize,
    pub height: usize,
    /// row-major, 3 bytes/pixel, RGB order
    pub data: Vec<u8>,
}

impl RgbImage {
    #[inline]
    pub fn pixel(&self, x: usize, y: usize) -> (u8, u8, u8) {
        let i = (y * self.width + x) * 3;
        (self.data[i], self.data[i + 1], self.data[i + 2])
    }
}

/// Decode an encoded image (JPEG/PNG/BMP/TGA/PNM) into RGB888.
pub fn decode_rgb(bytes: &[u8]) -> Result<RgbImage, String> {
    if bytes.is_empty() {
        return Err("empty image payload".to_string());
    }
    if bytes.len() > i32::MAX as usize {
        return Err("image payload too large".to_string());
    }
    let mut w: i32 = 0;
    let mut h: i32 = 0;
    let ptr = unsafe { rf_decode_rgb(bytes.as_ptr(), bytes.len() as i32, &mut w, &mut h) };
    if ptr.is_null() {
        let reason = unsafe {
            let p = rf_img_last_error();
            if p.is_null() {
                "unknown decode error".to_string()
            } else {
                CStr::from_ptr(p).to_string_lossy().into_owned()
            }
        };
        return Err(format!(
            "image decode failed (unsupported or corrupt JPEG/PNG): {reason}"
        ));
    }
    let (w, h) = (w as usize, h as usize);
    let len = w * h * 3;
    let data = unsafe { std::slice::from_raw_parts(ptr, len).to_vec() };
    unsafe { rf_img_free(ptr) };
    Ok(RgbImage {
        width: w,
        height: h,
        data,
    })
}
