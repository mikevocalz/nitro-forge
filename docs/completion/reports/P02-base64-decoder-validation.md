# Shared base64 decoder validation

2026-11-07. Photo preview review found that the common JavaScript decoder treated an out-of-table UTF-16 code unit as zero during bitwise arithmetic. A response such as `ĀĀĀĀĀĀ==` could therefore pass an encoded-length check and become four zero bytes.

The shared decoder now checks alphabet entries, padding shape and unused trailing bits before allocating its output. Valid padded and unpadded encodings remain supported. Malformed padding, embedded whitespace, non-ASCII lookalikes and nonzero unused bits reject instead of producing pixels. This changes no native ABI, dependency, package pin or resource lifetime.

Seven focused tests pass across the new decoder file and existing host tests. They cover independent text vectors, every byte through nonzero-offset subviews, comparison with Node's encoder and malformed inputs, including the reported non-ASCII case. Ignition TypeScript passes. The caller still owns its context-specific byte budget; Photo checks expected encoded length before invoking the decoder.

These are parser and host checks, not native runtime or full platform acceptance.
