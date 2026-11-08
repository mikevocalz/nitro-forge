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

# Font metrics backend notices (registerFont / layout {font})

The font registry and measured layout use the fontations stack to parse host-supplied font bytes: skrifa 0.49.0 (with read-fonts 0.46.0, font-types 0.12.7) plus their transitive dependencies (yoke 0.8.4, zerofrom 0.1.8, smallvec 1.16.5, bytemuck/bytemuck_derive, foldhash 0.2.0, stable_deref_trait 1.2.1, synstructure 0.14.0, once_cell). These crates are offered under MIT OR Apache-2.0; this distribution uses the MIT option. Content hashing uses sha2 0.10.x (already in the dependency tree; MIT OR Apache-2.0, MIT option). Exact sources: https://github.com/googlefonts/fontations (tag skrifa-v0.49.0), https://github.com/RustCrypto/hashes (sha2). Sources and checksums are pinned in Cargo.lock; no upstream code was copied into the engine.

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
