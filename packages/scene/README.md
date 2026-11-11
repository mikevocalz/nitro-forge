# Scene: bounded 3D scene document

Scene persists a scene graph — `group`/`layer`/`mesh`/`camera`/`light` nodes with TRS transforms and acyclic parent chains — plus PBR-state materials matching the `scene-render` model, custom base64 mesh attributes and deterministic box/plane/sphere/cylinder/torus primitives. Every mutation validates the whole document before commit and is atomic; `Journal` undo and `NFD1` snapshots follow the shared engine contracts.

The engine owns document state only (P17 Track-B B0): it never rasterizes. `renderFrame` returns the canonical scene description — world-space meshes, re-indexed materials, resolved camera and world-transformed lights, host-supplied texture pixels — that the host submits unchanged to the `rust/scene-render` service. `bounds` reports the world AABB over visible mesh vertices and `pick` returns the nearest ray→triangle hit over visible geometry.

Kind/native/checkpoint tag 11 appends after Draft 10. NFD1 framing stays unchanged. Deferred per B0: node-material DAG/cook, UV packing, glTF/OBJ import, GPU tier, shadows/IBL/transparency, studio app surface and native target acceptance.
