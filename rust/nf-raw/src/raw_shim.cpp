// nf-raw C ABI shim over LibRaw 0.22.3 (CDDL-1.0 route).
// Native code for this crate lives in this file; the Rust side is
// src/ffi.rs (declarations) and src/lib.rs (unsafe call sites).
// Contract mirrors tooling/raw-prototype/decode.cpp: open_buffer probe,
// bounded unpack, half-size 8-bit sRGB processing, RGBA8 expansion.
#include "nf_raw.h"

#include <libraw/libraw.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {

constexpr size_t kMaxInputBytes = 64u * 1024u * 1024u;   // 64 MiB
constexpr uint64_t kMaxRawPixels = 40'000'000ull;        // 40 MP RAW budget
constexpr int kMaxRawMemoryMb = 256;                     // decoder memory cap
constexpr uint32_t kMaxPreviewSide = 4096;               // engine MAX_SIDE

struct CancelBridge {
  void* ctx;
  int (*poll)(void* ctx);
};

// LibRaw invokes this at stage boundaries (identify, load_raw start/end,
// preprocess, demosaic tiles, postprocess). Returning nonzero makes LibRaw
// throw LIBRAW_EXCEPTION_CANCELLED_BY_CALLBACK internally, which surfaces
// as LIBRAW_CANCELLED_BY_CALLBACK. Phases without callback coverage (e.g.
// inside a single decoder row loop) cannot cancel mid-call; the Rust side
// checks the flag between stages as well.
int progress_trampoline(void* data, enum LibRaw_progress, int, int) {
  auto* bridge = static_cast<CancelBridge*>(data);
  if (!bridge || !bridge->poll) return 0;
  return bridge->poll(bridge->ctx);
}

void set_error(char* err, size_t errlen, const char* message) {
  if (!err || !errlen) return;
  std::strncpy(err, message, errlen - 1);
  err[errlen - 1] = '\0';
}

void set_libraw_error(char* err, size_t errlen, int code) {
  if (!err || !errlen) return;
  const char* msg = libraw_strerror(code);
  std::strncpy(err, msg ? msg : "LibRaw error", errlen - 1);
  err[errlen - 1] = '\0';
}

void fill_info(const LibRaw& raw, nf_raw_info_t* info) {
  std::memset(info, 0, sizeof(*info));
  const auto& id = raw.imgdata.idata;
  const auto& sz = raw.imgdata.sizes;
  std::strncpy(info->make, id.make, sizeof(info->make) - 1);
  std::strncpy(info->model, id.model, sizeof(info->model) - 1);
  // Coarse container classification: dng_version is set by identify() for
  // DNG files. Everything else is reported as generic "raw"; per-format
  // names would need unpack_function_name() and are out of scope here.
  std::strncpy(info->format, id.dng_version ? "dng" : "raw",
               sizeof(info->format) - 1);
  info->width = sz.raw_width;
  info->height = sz.raw_height;
}

// Area-average box downscale of an interleaved RGB8 bitmap. Deterministic;
// total work is O(src pixels). Used only when LibRaw's smallest output mode
// still exceeds the caller's pixel budget.
void downscale_rgb3(const uint8_t* src, uint32_t w, uint32_t h, uint32_t tw,
                    uint32_t th, uint8_t* dst) {
  for (uint32_t y = 0; y < th; ++y) {
    const uint32_t y0 = static_cast<uint32_t>((static_cast<uint64_t>(y) * h) / th);
    uint32_t y1 = static_cast<uint32_t>((static_cast<uint64_t>(y + 1) * h) / th);
    if (y1 <= y0) y1 = y0 + 1;
    for (uint32_t x = 0; x < tw; ++x) {
      const uint32_t x0 = static_cast<uint32_t>((static_cast<uint64_t>(x) * w) / tw);
      uint32_t x1 = static_cast<uint32_t>((static_cast<uint64_t>(x + 1) * w) / tw);
      if (x1 <= x0) x1 = x0 + 1;
      uint64_t r = 0, g = 0, b = 0, n = 0;
      for (uint32_t yy = y0; yy < y1; ++yy) {
        const uint8_t* row = src + (static_cast<size_t>(yy) * w + x0) * 3;
        for (uint32_t xx = x0; xx < x1; ++xx, row += 3) {
          r += row[0];
          g += row[1];
          b += row[2];
          ++n;
        }
      }
      uint8_t* o = dst + (static_cast<size_t>(y) * tw + x) * 3;
      o[0] = static_cast<uint8_t>(r / n);
      o[1] = static_cast<uint8_t>(g / n);
      o[2] = static_cast<uint8_t>(b / n);
    }
  }
}

bool raw_dims_ok(const libraw_image_sizes_t& sz) {
  return sz.raw_width > 0 && sz.raw_height > 0 &&
         static_cast<uint64_t>(sz.raw_width) * sz.raw_height <= kMaxRawPixels;
}

// Returns a LibRaw error code (LIBRAW_SUCCESS == 0 on success). Validation
// failures reuse LIBRAW_FILE_UNSUPPORTED / LIBRAW_TOO_BIG so the Rust side
// maps them without a parallel error space.
int open_and_probe(const uint8_t* data, size_t len, LibRaw* raw,
                   nf_raw_info_t* info, char* err, size_t errlen,
                   CancelBridge* bridge) {
  if (!data || len == 0 || len > kMaxInputBytes) {
    set_error(err, errlen, "input must be 1 byte..64 MiB");
    return LIBRAW_FILE_UNSUPPORTED;
  }
  if (!info) {
    set_error(err, errlen, "missing info out-param");
    return LIBRAW_UNSPECIFIED_ERROR;
  }
  raw->imgdata.rawparams.max_raw_memory_mb = kMaxRawMemoryMb;
  if (bridge) {
    raw->set_progress_handler(progress_trampoline, bridge);
  }
  int rc = raw->open_buffer(data, len);
  if (rc != LIBRAW_SUCCESS) {
    set_libraw_error(err, errlen, rc);
    return rc;
  }
  if (!raw_dims_ok(raw->imgdata.sizes)) {
    set_error(err, errlen, "raw dimensions exceed 40 MP budget");
    return LIBRAW_TOO_BIG;
  }
  fill_info(*raw, info);
  return LIBRAW_SUCCESS;
}

int nf_raw_probe_impl(const uint8_t* data, size_t len, nf_raw_info_t* info,
                      char* err, size_t errlen) {
  LibRaw raw;
  return open_and_probe(data, len, &raw, info, err, errlen, nullptr);
}

// Decodes to packed straight-alpha sRGB RGBA8. Caller owns *out (malloc) and
// must release it with nf_raw_free. *out_len is width*height*4.
int nf_raw_decode_impl(const uint8_t* data, size_t len, uint64_t max_pixels,
                       void* cancel_ctx, nf_raw_poll_fn cancel_poll,
                       nf_raw_info_t* info, uint8_t** out, size_t* out_len,
                       char* err, size_t errlen) {
  if (!out || !out_len) {
    set_error(err, errlen, "missing output out-params");
    return LIBRAW_UNSPECIFIED_ERROR;
  }
  *out = nullptr;
  *out_len = 0;

  LibRaw raw;
  CancelBridge bridge{cancel_ctx, cancel_poll};
  int rc = open_and_probe(data, len, &raw, info, err, errlen, &bridge);
  if (rc != LIBRAW_SUCCESS) return rc;

  auto& params = raw.imgdata.params;
  params.half_size = 1;        // bounded preview, matches prototype
  params.output_bps = 8;
  params.output_color = 1;     // sRGB
  params.use_camera_wb = 1;
  params.output_tiff = 0;

  rc = raw.unpack();
  if (rc != LIBRAW_SUCCESS) {
    set_libraw_error(err, errlen, rc);
    return rc;
  }
  if (cancel_poll && cancel_poll(cancel_ctx)) {
    set_error(err, errlen, "cancelled");
    return LIBRAW_CANCELLED_BY_CALLBACK;
  }
  if (!raw_dims_ok(raw.imgdata.sizes)) {
    set_error(err, errlen, "unpacked raw dimensions exceed 40 MP budget");
    return LIBRAW_TOO_BIG;
  }

  // Prototype parity (tooling/raw-prototype/decode.cpp): require a Bayer
  // raw plane with a sane pitch and at least one nonzero sample. An
  // all-zero decode means a corrupt/empty file, not a black image.
  {
    const auto& isz = raw.imgdata.sizes;
    const auto& rd = raw.imgdata.rawdata;
    if (!rd.raw_image) {
      set_error(err, errlen, "decoder produced no raw plane");
      return LIBRAW_DATA_ERROR;
    }
    const uint64_t pitch = isz.raw_pitch;
    if (pitch < static_cast<uint64_t>(isz.raw_width) * sizeof(uint16_t) ||
        pitch % sizeof(uint16_t) != 0) {
      set_error(err, errlen, "invalid decoded raw row pitch");
      return LIBRAW_DATA_ERROR;
    }
    const size_t row_samples = static_cast<size_t>(pitch / sizeof(uint16_t));
    const uint16_t* plane = rd.raw_image;
    bool nonzero = false;
    for (uint32_t row = 0; row < isz.raw_height && !nonzero; ++row) {
      const uint16_t* r = plane + static_cast<size_t>(row) * row_samples;
      for (uint32_t col = 0; col < isz.raw_width; ++col) {
        if (r[col] != 0) {
          nonzero = true;
          break;
        }
      }
    }
    if (!nonzero) {
      set_error(err, errlen, "decoded raw plane is empty");
      return LIBRAW_DATA_ERROR;
    }
  }

  rc = raw.dcraw_process();
  if (rc != LIBRAW_SUCCESS) {
    set_libraw_error(err, errlen, rc);
    return rc;
  }
  if (cancel_poll && cancel_poll(cancel_ctx)) {
    set_error(err, errlen, "cancelled");
    return LIBRAW_CANCELLED_BY_CALLBACK;
  }

  int img_err = 0;
  libraw_processed_image_t* img = raw.dcraw_make_mem_image(&img_err);
  if (img_err != LIBRAW_SUCCESS || !img) {
    if (img) LibRaw::dcraw_clear_mem(img);
    set_libraw_error(err, errlen, img_err ? img_err : LIBRAW_DATA_ERROR);
    return img_err ? img_err : LIBRAW_DATA_ERROR;
  }

  const uint32_t w = img->width;
  const uint32_t h = img->height;
  const bool ok = img->type == LIBRAW_IMAGE_BITMAP && img->bits == 8 &&
                  img->colors == 3 && w > 0 && h > 0 &&
                  img->data_size ==
                      static_cast<uint64_t>(w) * h * img->colors &&
                  max_pixels > 0;
  if (!ok) {
    LibRaw::dcraw_clear_mem(img);
    set_error(err, errlen, "unexpected preview format from LibRaw");
    return LIBRAW_DATA_ERROR;
  }

  // LibRaw's smallest output mode (half_size) can still exceed the engine
  // pixel/side budget (e.g. 4736x3136 -> 2342x1561 = 3.66 MP). There is no
  // quarter-size parameter, so area-downscale the RGB bitmap here to fit
  // max_pixels and the 4096-side cap. When it already fits, scale stays 1.
  double scale = 1.0;
  const double px = static_cast<double>(w) * h;
  if (px > static_cast<double>(max_pixels)) {
    scale = std::sqrt(static_cast<double>(max_pixels) / px);
  }
  const double side = static_cast<double>(kMaxPreviewSide);
  if (static_cast<double>(w) > side) scale = std::min(scale, side / w);
  if (static_cast<double>(h) > side) scale = std::min(scale, side / h);

  uint32_t tw = w;
  uint32_t th = h;
  const uint8_t* rgb = img->data;
  uint8_t* small = nullptr;
  if (scale < 1.0) {
    tw = static_cast<uint32_t>(w * scale);
    th = static_cast<uint32_t>(h * scale);
    if (tw < 1) tw = 1;
    if (th < 1) th = 1;
    while (tw > 1 && static_cast<uint64_t>(tw) * th > max_pixels) --tw;
    while (th > 1 && static_cast<uint64_t>(tw) * th > max_pixels) --th;
    if (static_cast<uint64_t>(tw) * th > max_pixels) {
      LibRaw::dcraw_clear_mem(img);
      set_error(err, errlen, "cannot fit preview within pixel budget");
      return LIBRAW_TOO_BIG;
    }
    small = static_cast<uint8_t*>(std::malloc(static_cast<size_t>(tw) * th * 3));
    if (!small) {
      LibRaw::dcraw_clear_mem(img);
      set_error(err, errlen, "preview allocation failed");
      return LIBRAW_UNSUFFICIENT_MEMORY;
    }
    downscale_rgb3(img->data, w, h, tw, th, small);
    rgb = small;
  }

  const size_t rgba_len = static_cast<size_t>(tw) * th * 4;
  uint8_t* rgba = static_cast<uint8_t*>(std::malloc(rgba_len));
  if (!rgba) {
    std::free(small);
    LibRaw::dcraw_clear_mem(img);
    set_error(err, errlen, "preview allocation failed");
    return LIBRAW_UNSUFFICIENT_MEMORY;
  }
  for (size_t i = 0, j = 0; i < rgba_len; i += 4, j += 3) {
    rgba[i] = rgb[j];
    rgba[i + 1] = rgb[j + 1];
    rgba[i + 2] = rgb[j + 2];
    rgba[i + 3] = 255;
  }
  std::free(small);
  LibRaw::dcraw_clear_mem(img);

  *out = rgba;
  *out_len = rgba_len;
  info->preview_width = tw;
  info->preview_height = th;
  return LIBRAW_SUCCESS;
}

}  // namespace

// Exception safety: LibRaw internals (constructor, open_buffer, unpack,
// dcraw_process, dcraw_make_mem_image/copy_mem_image/gamma_curve) do not
// catch C++ exceptions such as std::bad_alloc. Letting one escape an
// extern "C" function is undefined behavior, so every export wraps its
// impl in catch(...) and reports a generic LibRaw error instead.
extern "C" {

int nf_raw_probe(const uint8_t* data, size_t len, nf_raw_info_t* info,
                 char* err, size_t errlen) {
  try {
    return nf_raw_probe_impl(data, len, info, err, errlen);
  } catch (...) {
    set_error(err, errlen, "unexpected native exception in RAW probe");
    return LIBRAW_UNSPECIFIED_ERROR;
  }
}

int nf_raw_decode(const uint8_t* data, size_t len, uint64_t max_pixels,
                  void* cancel_ctx, nf_raw_poll_fn cancel_poll,
                  nf_raw_info_t* info, uint8_t** out, size_t* out_len,
                  char* err, size_t errlen) {
  try {
    return nf_raw_decode_impl(data, len, max_pixels, cancel_ctx, cancel_poll,
                              info, out, out_len, err, errlen);
  } catch (...) {
    if (out) *out = nullptr;
    if (out_len) *out_len = 0;
    set_error(err, errlen, "unexpected native exception in RAW decode");
    return LIBRAW_UNSPECIFIED_ERROR;
  }
}

void nf_raw_free(void* p) { std::free(p); }

}  // extern "C"
