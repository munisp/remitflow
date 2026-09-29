// RemitFlow rust-biometric — build script.
//
// Compiles the vendored stb_image shim (csrc/stb_shim.c, public domain/MIT)
// with the system C compiler. We deliberately do NOT add the `cc` crate:
// wave-15 policy restricts new Cargo deps for this service to `ort`,
// `ndarray` and the repo-standard DB crate. A C compiler is guaranteed in
// the builder image (Dockerfile installs gcc).
use std::process::Command;

fn main() {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR not set");
    let obj = format!("{out_dir}/stb_shim.o");
    let lib = format!("{out_dir}/libstb_shim.a");

    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let status = Command::new(&cc)
        .args([
            "-O2",
            "-DSTBI_THREAD_LOCAL=_Thread_local",
            "-c",
            "csrc/stb_shim.c",
            "-o",
            &obj,
        ])
        .status()
        .unwrap_or_else(|e| panic!("failed to spawn C compiler '{cc}': {e}"));
    assert!(status.success(), "C compiler failed on csrc/stb_shim.c");

    let _ = std::fs::remove_file(&lib);
    let status = Command::new("ar")
        .args(["rcs", &lib, &obj])
        .status()
        .expect("failed to spawn 'ar'");
    assert!(status.success(), "ar failed");

    println!("cargo:rustc-link-search=native={out_dir}");
    println!("cargo:rustc-link-lib=static=stb_shim");
    println!("cargo:rustc-link-lib=m"); // stb_image HDR path uses libm
                                        // ort-sys compiles C++ shim sources (logging.cc etc.) → needs the C++
                                        // runtime at final link time.
    println!("cargo:rustc-link-lib=stdc++");
    println!("cargo:rerun-if-changed=csrc/stb_shim.c");
    println!("cargo:rerun-if-changed=csrc/stb_image.h");
}
