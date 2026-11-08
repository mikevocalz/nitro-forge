# Quill dependency notices

The changeCase operation uses unicode-normalization 0.1.25 only for Unicode General_Category=Mark classification. Exact source: https://github.com/unicode-rs/unicode-normalization/tree/v0.1.25 . The crate is offered under MIT OR Apache-2.0; this distribution uses the MIT option below. The source and checksum are pinned in Cargo.lock; no upstream code was copied into the engine.

Copyright (c) 2015 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

# Font metrics and shaping backend notices (registerFont / layout {font})

The font registry, measured layout and text shaping use the fontations stack plus harfrust to parse host-supplied font bytes and shape text: skrifa 0.49.0 and harfrust 0.15.0 (both over read-fonts 0.46.0, font-types 0.12.7) plus their transitive dependencies (yoke 0.8.4, zerofrom 0.1.8, smallvec 1.16.5, bitflags 2.13.2, bytemuck/bytemuck_derive, foldhash 0.2.0, stable_deref_trait 1.2.1, synstructure 0.14.0, once_cell). Licenses vary per crate: skrifa, read-fonts, font-types, harfrust, bitflags, smallvec, once_cell, stable_deref_trait and synstructure are MIT OR Apache-2.0 (this distribution uses the MIT option); yoke, yoke-derive, zerofrom and zerofrom-derive are Unicode-3.0; foldhash is Zlib; bytemuck and bytemuck_derive are Zlib OR Apache-2.0 OR MIT. harfrust and skrifa are both pinned `default-features = false` + `std`, which excludes harfrust's optional `icu` feature (its builtin Unicode tables are used instead) and skrifa's `autohint_shaping`. Content hashing uses sha2 0.10.x (already in the dependency tree; MIT OR Apache-2.0, MIT option). Exact sources: https://github.com/googlefonts/fontations (tags skrifa-v0.49.0), https://github.com/harfbuzz/harfrust (tag v0.15.0), https://github.com/RustCrypto/hashes (sha2). Sources and checksums are pinned in Cargo.lock; no upstream code was copied into the engine.

Copyright (c) 2022 Google LLC
Copyright (c) 2018 The Fuchsia Authors
Copyright (c) 2017 The rust-lang authors
Copyright (c) 2015 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

# Glyph rasterization backend notice (renderPage)

`renderPage` rasterizes text glyphs with tiny-skia 0.12.0 (BSD-3-Clause,
published 2026-02-02) plus tiny-skia-path 0.12.0 (BSD-3-Clause, same
repository, https://github.com/linebender/tiny-skia). The crate is pinned
exactly (`=0.12.0`) with `default-features = false` + `std`, which excludes
the optional `png` dependency (no PNG output in this slice) and the
`simd` feature so one scalar code path serves every target. tiny-skia
supplies only path fills — glyph outlines come from the already-admitted
skrifa/read-fonts stack above via its `PathSink` pen protocol (no second
font parser). Transitive dependencies added by this admission: arrayref
0.3.x (Apache-2.0 OR MIT), arrayvec 0.7.x (MIT), strict-num 0.1.x (MIT),
cfg-if 1.x (MIT OR Apache-2.0), log 0.4.x (MIT OR Apache-2.0); bytemuck
1.x (Zlib OR Apache-2.0 OR MIT) was already in the tree. Exact sources,
versions and checksums are pinned in Cargo.lock; no upstream code was
copied into the engine.

Copyright (c) 2011 Google Inc.
Copyright (c) 2020 Yevhenii Reizner

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
document files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
