//! Builds the pinned LibRaw 0.22.3 static library and the C ABI shim.
//!
//! Source resolution order:
//!   1. `NF_RAW_LIBRAW_DIR` env var: path to an extracted LibRaw-0.22.3 tree.
//!      The tree must be writable (the upstream Makefile.dist builds in place)
//!      unless `lib/libraw_r.a` is already present, in which case `make` is a
//!      no-op. Use this for offline builds or a pre-fetched source tree.
//!   2. Otherwise the pinned tarball is downloaded from libraw.org into
//!      OUT_DIR, its SHA-256 is verified against the manifest pin, extracted
//!      with `tar`, and built there.
//!
//! The pin (version, URL, SHA-256) matches tooling/raw-prototype/manifest.json
//! and docs/completion/reports/P10-libraw-isolated-decode-source.md. There is
//! no floating dependency: the archive hash is checked before extraction.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const LIBRAW_VERSION: &str = "0.22.3";
const LIBRAW_URL: &str = "https://www.libraw.org/data/LibRaw-0.22.3.tar.gz";
const LIBRAW_SHA256: &str =
    "789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4";
const LIBRAW_TOP_DIR: &str = "LibRaw-0.22.3";

fn run(cmd: &mut Command, what: &str) {
    let status = cmd
        .status()
        .unwrap_or_else(|e| panic!("nf-raw build: failed to spawn {what}: {e}"));
    assert!(status.success(), "nf-raw build: {what} failed ({status})");
}

fn sha256_file(path: &Path) -> String {
    // Prefer sha256sum (Linux), fall back to shasum (macOS). Both print
    // "<hex>  <path>"; we only need the hex digest.
    for tool in ["sha256sum", "shasum"] {
        if let Ok(out) = Command::new(tool).arg("-a").arg("256").arg(path).output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(hex) = text.split_whitespace().next() {
                    return hex.to_string();
                }
            }
        }
    }
    panic!("nf-raw build: no sha256 tool (sha256sum/shasum) available");
}

/// Download the pinned tarball into `dest_dir`, verify SHA-256, extract, and
/// return the extracted source directory.
fn fetch_source(dest_dir: &Path) -> PathBuf {
    let tarball = dest_dir.join(format!("LibRaw-{LIBRAW_VERSION}.tar.gz"));
    if !tarball.exists() {
        eprintln!("nf-raw build: downloading {LIBRAW_URL}");
        run(
            Command::new("curl")
                .args(["--fail", "--location", "--silent", "--show-error"])
                .arg("--max-filesize")
                .arg("67108864")
                .arg("-o")
                .arg(&tarball)
                .arg(LIBRAW_URL),
            "LibRaw download",
        );
    }
    let digest = sha256_file(&tarball);
    assert_eq!(
        digest, LIBRAW_SHA256,
        "nf-raw build: LibRaw tarball SHA-256 mismatch (got {digest})"
    );
    let src = dest_dir.join(LIBRAW_TOP_DIR);
    if !src.join("libraw/libraw.h").exists() {
        run(
            Command::new("tar").args(["-xzf"]).arg(&tarball).arg("-C").arg(dest_dir),
            "LibRaw extract",
        );
    }
    src
}

fn source_dir() -> PathBuf {
    if let Ok(dir) = env::var("NF_RAW_LIBRAW_DIR") {
        let dir = PathBuf::from(dir);
        assert!(
            dir.join("libraw/libraw.h").exists(),
            "nf-raw build: NF_RAW_LIBRAW_DIR={} is not an extracted LibRaw-{LIBRAW_VERSION} tree",
            dir.display()
        );
        return dir;
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fetch_source(&out_dir)
}

fn main() {
    println!("cargo:rerun-if-env-changed=NF_RAW_LIBRAW_DIR");
    println!("cargo:rerun-if-changed=src/raw_shim.cpp");

    let src = source_dir();

    // Build the reentrant static lib exactly as the isolated prototype did:
    // upstream Makefile.dist, no OpenMP, no optional codec integrations,
    // system zlib only.
    run(
        Command::new("make")
            .args(["-f", "Makefile.dist", "-j4", "lib/libraw_r.a"])
            .env("CXX", "clang++")
            .env("CC", "clang")
            .env("CFLAGS", "-O2 -I. -w -DUSE_ZLIB")
            .current_dir(&src),
        "LibRaw static build",
    );
    let lib_dir = src.join("lib");
    assert!(
        lib_dir.join("libraw_r.a").exists(),
        "nf-raw build: libraw_r.a missing after make"
    );

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=raw_r");
    println!("cargo:rustc-link-lib=z");
    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("apple") {
        // libc++ on macOS/iOS.
        println!("cargo:rustc-link-lib=c++");
    } else if target.contains("windows") {
        // MSVC C++ runtime; untested, documented as unsupported for now.
        println!("cargo:rustc-link-lib=static=libc++");
    } else {
        println!("cargo:rustc-link-lib=stdc++");
    }

    cc::Build::new()
        .cpp(true)
        .file("src/raw_shim.cpp")
        .include(&src)
        .flag("-std=c++17")
        .flag("-O2")
        .flag("-w")
        .compile("nf_raw_shim");
}
