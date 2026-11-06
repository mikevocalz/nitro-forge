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

/* Structured v1 command bridge: separate op and one validated JSON payload.
 * version=0 selects default version 1. A non-null error_json is failure.
 * Every returned string and event array is Rust owned. Free once with
 * nf_v1_free_command_result, after copying any strings used by native C++.
 */
typedef struct NfV1Event {
  char* kind;
  char* detail_json;
} NfV1Event;

typedef struct NfV1CommandResult {
  char* data_json;
  NfV1Event* events;
  size_t event_count;
  char* error_json;
} NfV1CommandResult;

NfV1CommandResult nf_v1_apply_parts(
  int64_t handle, const uint8_t* op, size_t op_len,
  const uint8_t* payload, size_t payload_len, uint32_t version
);
void nf_v1_free_command_result(NfV1CommandResult result);

/* Additive binary/task ABI. Borrowed inputs live through the synchronous call.
 * Task controls may be observed/cancelled concurrently, and must outlive work. */
typedef struct NfTaskContext NfTaskContext;
typedef struct NfBinaryResult { NfV1CommandResult command; NfBytes output; } NfBinaryResult;
NfTaskContext* nf_task_create(void);
void nf_task_cancel(const NfTaskContext* task);
float nf_task_progress(const NfTaskContext* task);
void nf_task_free(NfTaskContext* task);
NfBinaryResult nf_v1_apply_binary(int64_t handle, const uint8_t* op, size_t op_len,
 const uint8_t* payload, size_t payload_len, uint32_t version,
 const uint8_t* input, size_t input_len, uint8_t has_input, const NfTaskContext* task);
void nf_v1_free_binary_result(NfBinaryResult result);

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
