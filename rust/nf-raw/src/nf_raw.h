/* nf-raw C ABI shared between raw_shim.cpp and src/ffi.rs.
 * Keep this header C-compatible; do not include C++ or LibRaw headers. */
#ifndef NF_RAW_H
#define NF_RAW_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  char make[64];
  char model[64];
  char format[32]; /* "dng" or coarse "raw" classification */
  uint32_t width;  /* raw_width  */
  uint32_t height; /* raw_height */
  /* Filled by nf_raw_decode only; 0 after nf_raw_probe. */
  uint32_t preview_width;
  uint32_t preview_height;
} nf_raw_info_t;

/* Cooperative cancellation poll. Return nonzero to cancel. Called from
 * LibRaw progress callbacks (same thread, no OpenMP in this build) and
 * between decode stages. */
typedef int (*nf_raw_poll_fn)(void* ctx);

/* Probe only: parse metadata, no pixel decode. Returns a LibRaw error code
 * (LIBRAW_SUCCESS == 0) or LIBRAW_FILE_UNSUPPORTED for invalid input. */
int nf_raw_probe(const uint8_t* data, size_t len, nf_raw_info_t* info,
                 char* err, size_t errlen);

/* Full decode to packed straight-alpha sRGB RGBA8.
 * max_pixels caps width*height of the output preview.
 * On success *out is malloc'd (free with nf_raw_free) and *out_len == w*h*4.
 * Returns a LibRaw error code; LIBRAW_CANCELLED_BY_CALLBACK (-100010) means
 * the cancel poll fired. */
int nf_raw_decode(const uint8_t* data, size_t len, uint64_t max_pixels,
                  void* cancel_ctx, nf_raw_poll_fn cancel_poll,
                  nf_raw_info_t* info, uint8_t** out, size_t* out_len,
                  char* err, size_t errlen);

void nf_raw_free(void* p);

#ifdef __cplusplus
}
#endif

#endif /* NF_RAW_H */
