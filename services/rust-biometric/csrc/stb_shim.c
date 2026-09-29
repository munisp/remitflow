/* RemitFlow rust-biometric — image decode shim.
 *
 * Wraps stb_image v2.30 (vendored, pinned to nothings/stb commit
 * f0569113c93ad095470c54bf34a17b36646bbbb5). stb_image is dual-licensed
 * public domain / MIT — permissive, no provenance gray zone.
 *
 * Why a vendored C decoder instead of a Cargo crate: the wave-15 license
 * policy restricts NEW Cargo dependencies for this service to `ort` and
 * `ndarray` only. We therefore compile this single-file decoder with the
 * system C compiler from build.rs (no `cc` crate either) and expose a
 * minimal ABI to Rust. Supports baseline+progressive JPEG, PNG, BMP, TGA,
 * PNM — everything stb_image supports.
 */
#define STB_IMAGE_IMPLEMENTATION
#define STBI_FAILURE_USERMSG
/* Decode-time safety: fail closed on absurd dimensions (decompression bombs). */
#define STBI_MAX_DIMENSIONS 8192
#include "stb_image.h"

/* Returns a stb-allocated interleaved RGB888 buffer (w*h*3 bytes), or NULL.
 * On success *out_w/*out_h are set. Free with rf_img_free(). */
unsigned char *rf_decode_rgb(const unsigned char *data, int len, int *out_w, int *out_h) {
    int w = 0, h = 0, channels = 0;
    unsigned char *img = stbi_load_from_memory(data, len, &w, &h, &channels, 3 /* force RGB */);
    if (img == NULL) {
        return NULL;
    }
    *out_w = w;
    *out_h = h;
    return img;
}

void rf_img_free(unsigned char *p) {
    stbi_image_free(p);
}

const char *rf_img_last_error(void) {
    const char *r = stbi_failure_reason();
    return r == NULL ? "unknown decode error" : r;
}

/* ── glibc ≥2.38 compatibility shims ────────────────────────────────────────
 * The prebuilt ONNX Runtime static library (downloaded by ort-sys) was
 * compiled against glibc ≥ 2.38 headers, which redirect strtol family calls
 * to the C23 __isoc23_* entry points. Older glibc (e.g. Debian 12 / 2.36)
 * does not export those symbols. For all practical purposes the C23 variants
 * differ only in binary-literal ("0b") handling under base 0, which ONNX
 * Runtime never relies on, so forwarding to the classic symbols is safe.
 */
#include <stdlib.h>
long __isoc23_strtol(const char *nptr, char **endptr, int base) {
    return strtol(nptr, endptr, base);
}
long long __isoc23_strtoll(const char *nptr, char **endptr, int base) {
    return strtoll(nptr, endptr, base);
}
unsigned long __isoc23_strtoul(const char *nptr, char **endptr, int base) {
    return strtoul(nptr, endptr, base);
}
unsigned long long __isoc23_strtoull(const char *nptr, char **endptr, int base) {
    return strtoull(nptr, endptr, base);
}
