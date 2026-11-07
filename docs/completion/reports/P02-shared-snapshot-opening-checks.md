# P02 snapshot opening ownership

Review of the new photo wrapper exposed the same borrowed-buffer pattern in the seven existing SDK openSnapshot methods. Prism, Cadence, Splice, Folio, Pitch, Tally and Quill all captured caller bytes while awaiting native handle allocation.

DocumentHandle.openSnapshot now owns a Uint8Array copy before its first asynchronous boundary, rejects inputs above the existing 256 MiB document boundary before copying, and delegates restore/release/error aggregation to openInitialized. Each inspected wrapper uses this shared boundary. Envelope and product-schema validation remain authoritative engine work; a successful copy is not successful restoration. Native resources are not stored in serialized state.

Fourteen focused tests pass: each of the seven wrappers opens with both a Node Buffer subarray and a typed-array view, the provider mutates the backing storage while open is pending, and the host still receives the original exact slice. The returned session is closed. Ignition TypeScript checking passes. This is controlled host/resource evidence, not native storage or relaunch acceptance. No phase/platform field changes.
