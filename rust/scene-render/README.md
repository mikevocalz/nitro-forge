# scene-render

Host-side **deterministic CPU rasterizer** for the P17 Track-B scene
engine — tier 1 of the B0 decision
(`docs/completion/reports/P17-3d-backend-decision.md`). NOT an
`ignition_core::Engine`: no `EngineKind`, no `Command`/`Journal`, no
`NFD1` snapshot, no mutations, no sessions. It is stateless per call:
each `render` frame carries the complete canonical scene description
(world-space triangle meshes + material params + camera + texture
bytes) and returns RGBA8/PNG pixels.

Backend: **pure Rust software rasterizer** — view-space near/far
clipping, perspective-correct barycentric interpolation, z-buffer,
per-pixel Lambert/Blinn-Phong shading (PBR channels mapped onto the
admitted Phong approximation), nearest/bilinear texture sampling.
Fixed evaluation order, f32 math, no threading — byte-identical output
for identical input on every target, including WASM-compatible pure
Rust. This is the ONLY parity-claimable render path; the deferred
wgpu tier (tier 2) would be display-only per the B0 decision.

Wire protocol: stdin/stdout JSON-lines, same shape as `nf-cli` /
`folio-render` — `{"id","handle","op","payload"}` →
`{"id","ok","data"|"error"}`. Ops:

- `render` — payload is the scene description (below); returns
  `{format,width,height,stride?,bytes_b64,stats}`.
- `describe` — capabilities and bounds.

## Scene description (render payload)

```jsonc
{
  "width": 640, "height": 480,          // 1..=4096 per side
  "format": "raw",                       // "raw" (default) | "png"
  "camera": {
    "type": "perspective",               // or "orthographic"
    "position": [0,0,5], "target": [0,0,0], "up": [0,1,0],
    "fov_y_degrees": 60,                 // perspective only
    "half_height": 1.0,                  // orthographic only
    "near": 0.1, "far": 1000
  },
  "background": "#101418",               // or [r,g,b] linear; default black
  "ambient": { "type": "ambient", "color": [1,1,1], "intensity": 0.2 },
  "lights": [
    { "type": "directional", "direction": [0,-1,-1], "color": "#ffffff", "intensity": 1.0 },
    { "type": "point", "position": [0,2,0], "color": [1,1,1], "intensity": 4.0, "range": 20 }
  ],
  "materials": [
    {
      "color": "#888888",                // or [r,g,b] linear
      "metallic": 0.0, "roughness": 0.5, // PBR state → Phong approx
      "specular": [1,1,1], "emission": [0,0,0],
      "texture": "albedo",               // name into `textures`
      "texture_filter": "bilinear",      // or "nearest"
      "double_sided": false
    }
  ],
  "textures": {
    "albedo": { "width": 64, "height": 64, "format": "rgba8", "bytes_b64": "..." }
  },
  "meshes": [
    {
      "positions_b64": "...",            // f32le xyz triples, world space
      "normals_b64": "...",              // optional f32le xyz per vertex
      "uvs_b64": "...",                  // optional f32le uv per vertex
      "indices_b64": "...",              // optional u32le triangles
      "material": 0                       // index into materials
    }
  ]
}
```

Notes:

- Vertex/index attributes are **little-endian binary base64** (f32le /
  u32le), not JSON arrays — keeps frames compact at scene scale.
- `normals_b64` absent → flat per-face geometric normals.
  `indices_b64` absent → sequential non-indexed triangles (vertex
  count must be divisible by 3).
- `"#RRGGBB[AA]"` colors are sRGB (converted to linear); `[r,g,b(,a)]`
  float arrays are already linear 0..=1. Alpha is ignored — v1 is
  opaque; output alpha is always 255.
- Textures are RGBA8, sRGB-decoded at sample time, clamped to edge
  (no wrap modes). A textured material requires `uvs_b64` on every
  mesh using it — the service fails closed otherwise.
- Lighting: ambient term + per-light Lambert diffuse + Blinn-Phong
  specular. Point lights use fixed `intensity/(1+d²)` attenuation with
  optional hard `range` cutoff. `metallic`/`roughness`/`specular` are
  PBR *state* mapped onto this approximation — not PBR shading.

## Bounds (fail-closed)

Output ≤ 4096 px/side and ≤ 32 MiB decoded RGBA; ≤ 1,000,000 triangles;
≤ 3,000,000 vertices per scene (500,000 per mesh); ≤ 4096 meshes;
≤ 1024 materials; ≤ 16 lights; ≤ 256 textures totaling ≤ 64 MiB
decoded RGBA8 (each ≤ 4096²); protocol frame ≤ 256 MiB raw, rejected
before JSON parse. All coordinates must be finite.

## Build & test

```bash
cargo build -p scene-render
cargo test -p scene-render   # 11 integration tests, real renders
```

## Deferred (honest)

wgpu/GPU preview tier; the scene-graph engine itself (tag 11 pending
sign-off); primitive mesh generation; node transforms (the engine owns
them — this service consumes world-space geometry); shadows, IBL,
post-processing; transparency/blending/texture alpha; glTF/OBJ import;
baking/UV packing; text/dimension rendering in 3D views.
