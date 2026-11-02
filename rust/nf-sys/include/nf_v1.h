#pragma once
/*
 * NitroForge Ignition v1 C ABI. Rust 2021 implementation: nf-sys/ffi_v1.rs.
 * This is a native boundary, NOT a JS API. Strings return UTF-8 JSON errors.
 * All memory is owned by Rust until released by the paired Rust deallocator.
 */
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NfBytes {
  uint8_t* ptr;
  size_t len;
} NfBytes;

/* Returns positive session id on success; 0 on error.
 * kind must be a readable kind_len-byte UTF-8 string.
 * out_err, if non-null, receives a Rust-owned error JSON string.
 */
int64_t nf_v1_open(const uint8_t* kind, size_t kind_len, char** out_err);

/* Returns Rust-owned {"ok":true,"data":...,"events":[...]} or
 * {"ok":false,"error":...}. Never treat malformed/empty JSON as success.
 * The input pointer is borrowed for the synchronous duration of the call.
 */
char* nf_v1_apply(int64_t handle, const uint8_t* bytes, size_t len);

/* Returns owned NFD1 bytes (max 256 MiB), or {NULL,0} and *out_err. */
NfBytes nf_v1_snapshot(int64_t handle, char** out_err);

/* Returns NULL on success or a Rust-owned JSON error string on failure. */
char* nf_v1_restore(int64_t handle, const uint8_t* bytes, size_t len);

/* Returns 1 once for a live document; 0 for invalid/previously closed. */
int32_t nf_v1_close(int64_t handle);

/* Every returned Rust allocation must be freed by its matching function. */
void nf_free_string(char* string);
void nf_free_bytes(NfBytes bytes);

#ifdef __cplusplus
}
#endif
