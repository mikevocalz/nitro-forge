# Draft: bounded 2D backend

Draft persists world points and ordered segments, calculates actual world snaps, and solves fixed/coincident/horizontal/vertical/signed-axis-distance linear constraints. Rank, DOF, residual and unsatisfied IDs describe the admitted matrix. Inconsistent or out-of-bounds geometry never publishes; locked coordinates remain exact.

Anchor-based ortho axes and legal polar rays are computed in world space with explicit tolerance. A bounded POINT/LINE/SEGMENT/MOVE/DELETE/SOLVE/SNAP grammar reuses the same atomic engine operations; unsupported commands reject without mutation. Canonical source-shaped bindings preserve failed drafts and withhold stale revision-tagged snap feedback. These CAD controls are not in the pinned alpha.4 exports, so this source does not activate them.

It renders actual Prism stroked-path RGBA through a supplied world viewport. Distinct coincident points are valid and their zero-length segment draws no path. Endpoints include all authored points; other snaps use visible finite segments. Collinear/nonunique and angular-nearparallel intersections are excluded. Exact limits and semantics are in ENGINE_OPS and the P17 source report.

Kind/native/checkpoint tag 10 appends after Design 9. NFD1 framing stays unchanged. Snapshots use explicit draft/schema1 validation and shared borrowed-byte ownership. No default UI, native target acceptance, general nonlinear/3D CAD, encoded delivery or complete P17 acceptance is implied.
