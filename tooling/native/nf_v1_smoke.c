#include "../../rust/nf-sys/include/nf_v1.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void apply_checked(int64_t handle, const char* text) {
  char* result = nf_v1_apply(handle, (const uint8_t*)text, strlen(text));
  assert(result != NULL);
  if (strstr(result, "\"ok\":true") == NULL) {
    fprintf(stderr, "Unexpected Ignition command response: %s\n", result);
    nf_free_string(result);
    abort();
  }
  nf_free_string(result);
}

int main(void) {
  char* error = NULL;
  const char* kind = "tally";
  int64_t handle = nf_v1_open((const uint8_t*)kind, strlen(kind), &error);
  assert(error == NULL);
  assert(handle > 0);

  apply_checked(handle, "{\"op\":\"new\",\"payload\":{}}");
  apply_checked(handle, "{\"op\":\"setCell\",\"payload\":{\"addr\":\"A1\",\"value\":\"42\"}}");
  NfBytes snapshot = nf_v1_snapshot(handle, &error);
  assert(error == NULL);
  assert(snapshot.ptr != NULL && snapshot.len > 9);
  assert(memcmp(snapshot.ptr, "NFD1", 4) == 0);

  apply_checked(handle, "{\"op\":\"setCell\",\"payload\":{\"addr\":\"A1\",\"value\":\"8\"}}");
  char* restore_error = nf_v1_restore(handle, snapshot.ptr, snapshot.len);
  nf_free_bytes(snapshot);
  assert(restore_error == NULL);
  apply_checked(handle, "{\"op\":\"getCell\",\"payload\":{\"addr\":\"A1\"}}");

  const char* op = "getCell";
  const char* payload = "{\"addr\":\"A1\"}";
  NfV1CommandResult typed = nf_v1_apply_parts(
    handle, (const uint8_t*)op, strlen(op),
    (const uint8_t*)payload, strlen(payload), 1
  );
  assert(typed.error_json == NULL);
  assert(typed.data_json != NULL && strstr(typed.data_json, "42") != NULL);
  assert(typed.event_count == 0);
  nf_v1_free_command_result(typed);

  assert(nf_v1_close(handle) == 1);
  assert(nf_v1_close(handle) == 0);
  char* result = nf_v1_apply(handle, (const uint8_t*)"{\"op\":\"describe\"}", 17);
  assert(result != NULL);
  assert(strstr(result, "\"ok\":false") != NULL);
  nf_free_string(result);
  puts("NitroForge v1 C ABI smoke: open/edit/NFD1/restore/close passed");
  return 0;
}
