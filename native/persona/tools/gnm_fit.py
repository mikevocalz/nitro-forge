#!/usr/bin/env python3
"""Fit the open GNM Head model (Apache-2.0, google/GNM) to 2D landmarks.

Pipeline position: this is the reconstruction backend for the Nitro Forge
persona capture flow. The phone captures guided multi-pose photos; a
landmark extractor (MediaPipe Face Landmarker on-device, or this tool's
synthetic mode for tests) produces 68 correspondences; this script solves
for GNM identity/expression coefficients and a weak-perspective pose, then
exports the fitted params and a renderable mesh.

Math: GNM vertex positions are linear in identity/expression coefficients,
and the 68 sparse landmarks are fixed barycentric blends of vertices, so
landmark positions are exactly linear in the coefficients. Given a pose
estimate we solve one regularized linear least-squares for all 636
coefficients, then re-estimate the pose (Umeyama/Kabsch) and iterate.

Usage:
  gnm_fit.py --selftest                 # synthetic roundtrip validation
  gnm_fit.py --input landmarks.json --output out_dir
  gnm_fit.py --dump-basis out_dir       # cache landmark Jacobian to .npz

landmarks.json format:
  {"image": {"width": W, "height": H, "fx": F, "fy": F, "cx": CX, "cy": CY},
   "landmarks": [[u, v], ... x68]}     # pixel coords, GNM sparse-68 order
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

import numpy as np

MODEL_CACHE = Path.home() / '.cache' / 'gnm' / 'models' / 'v3_0' / 'gnm_head.npz'
LANDMARK_FILE = (
    Path(sys.prefix)
    / 'lib'
    / f'python{sys.version_info.major}.{sys.version_info.minor}'
    / 'site-packages'
    / 'gnm'
    / 'shape'
    / 'data'
    / 'landmarks'
    / 'head_sparse_68.txt'
)

NUM_IDENTITY = 253
NUM_EXPRESSION = 383
NUM_LANDMARKS = 68


def _find_landmark_file() -> Path:
    """Locate head_sparse_68.txt in the installed gnm-shape package."""
    import gnm.shape as gnm_shape

    candidate = Path(gnm_shape.__file__).parent / 'data' / 'landmarks' / 'head_sparse_68.txt'
    if candidate.exists():
        return candidate
    # pip installs may drop the Bazel-linked data file; fall back to a
    # user-provided copy via GNM_LANDMARKS_FILE.
    import os

    env = os.environ.get('GNM_LANDMARKS_FILE')
    if env and Path(env).exists():
        return Path(env)
    raise FileNotFoundError(
        'head_sparse_68.txt not found in gnm-shape package; download it from '
        'github.com/google/GNM gnm/shape/data/landmarks/ and set '
        'GNM_LANDMARKS_FILE.'
    )


def load_gnm():
    from gnm.shape import gnm_numpy

    return gnm_numpy.GNM.from_remote(
        version=gnm_numpy.GNMMajorVersion.V3,
        variant=gnm_numpy.GNMVariant.HEAD,
    )


@dataclasses.dataclass
class LandmarkBasis:
    """Linear landmark model: L(c) = l0 + J_id @ c_id + J_ex @ c_ex."""

    l0: np.ndarray          # (68, 3)
    j_id: np.ndarray        # (68, 3, 253)
    j_ex: np.ndarray        # (68, 3, 383)

    @property
    def dim(self) -> int:
        return NUM_IDENTITY + NUM_EXPRESSION

    def landmarks(self, coeffs: np.ndarray) -> np.ndarray:
        c_id, c_ex = coeffs[:NUM_IDENTITY], coeffs[NUM_IDENTITY:]
        return self.l0 + np.einsum('lci,i->lc', self.j_id, c_id) + np.einsum(
            'lci,i->lc', self.j_ex, c_ex
        )


def _landmark_weights(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Parse head_sparse_68.txt -> vertex indices (68,3) and weights (68,3)."""
    rows = [line.split() for line in path.read_text().splitlines() if line.strip()]
    if len(rows) != NUM_LANDMARKS:
        raise ValueError(f'expected {NUM_LANDMARKS} landmark rows, got {len(rows)}')
    idx = np.array([[int(r[0]), int(r[2]), int(r[4])] for r in rows], dtype=np.int64)
    w = np.array([[float(r[1]), float(r[3]), float(r[5])] for r in rows])
    return idx, w


def build_landmark_basis(gnm, path: Path | None = None) -> LandmarkBasis:
    """Build the exact linear landmark Jacobian from the vertex bases."""
    from gnm.shape import gnm_landmarks

    path = path or _find_landmark_file()
    idx, w = _landmark_weights(path)

    # Landmark vertex positions at zero coefficients.
    _, l0 = gnm.vertices_and_landmarks(
        landmarks_type=gnm_landmarks.GNMLandmarksType.HEAD_SPARSE_68
    )
    l0 = np.asarray(l0, dtype=np.float64)

    # dL/dc = sum_k w_k * dV[idx_k]/dc. Vertex bases are (I, V, 3).
    # Gather basis entries at the landmark vertex indices: (68, 3, I, 3).
    def jac(basis: np.ndarray) -> np.ndarray:
        gathered = basis[:, idx, :]              # (I, 68, 3verts, 3)
        gathered = np.transpose(gathered, (1, 2, 0, 3))  # (68, 3v, I, 3)
        # weight over the 3 vertices: (68, 3v, 1, 1) * w (68,3v) -> sum axis1
        return np.einsum('lv,lvic->lci', w, gathered)

    return LandmarkBasis(
        l0=l0,
        j_id=jac(np.asarray(gnm.vertex_identity_basis, dtype=np.float64)),
        j_ex=jac(np.asarray(gnm.expression_basis, dtype=np.float64)),
    )


# ---------------------------------------------------------------------------
# Pose estimation (weak perspective + Umeyama)
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class Pose:
    """Weak-perspective 2D affine pose: obs_px = A @ [x, y, 1].

    A is (2,3): two rows mapping model (x,y,z,1) -> pixel (u,v). This is the
    standard weak-perspective camera model used in 3DMM fitting; it absorbs
    focal length, scale, in-plane rotation, out-of-plane tilt (weakly) and
    translation. Out-of-plane rotation is only weakly observable from a
    single view, which matches the capture protocol (frontal + turns are
    separate observations).
    """

    affine: np.ndarray = dataclasses.field(
        default_factory=lambda: np.array(
            [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]]
        )
    )

    def project(self, x: np.ndarray) -> np.ndarray:
        """Project model points (N,3) to pixels (N,2)."""
        hom = np.concatenate(
            [x, np.ones((len(x), 1))], axis=1
        )  # (N,4): x,y,z,1
        return hom @ self.affine.T

    @property
    def linear(self) -> np.ndarray:
        # (2,4) affine -> the 3x3 part acting on model xyz is cols 0..2
        # stacked as rows; design einsum expects (2,3) mapping xyz->px.
        return self.affine[:, :3]


def estimate_pose(model3: np.ndarray, obs_uv: np.ndarray) -> Pose:
    """Least-squares 2D affine mapping model landmarks -> observed pixels."""
    hom = np.concatenate([model3, np.ones((len(model3), 1))], axis=1)
    # Solve hom @ A.T = obs for A (2,4)-> we use 3 cols x,y,z + bias.
    a, *_ = np.linalg.lstsq(hom, obs_uv, rcond=None)
    return Pose(affine=a.T.copy())


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------


def fit(basis: LandmarkBasis, obs_uv: np.ndarray,
        iterations: int = 12, regularization: float = 10.0) -> tuple[np.ndarray, Pose, float]:
    """Alternate linear coefficient solve and affine pose estimation.

    Returns (coeffs[636], pose, final_rmse_px).
    """
    coeffs = np.zeros(basis.dim)
    pose = Pose()

    # Landmark positions are linear in coeffs: L(c) = l0 + J c, J (68,3,636).
    j_full = np.concatenate([basis.j_id, basis.j_ex], axis=2)  # (68,3,636)

    for _ in range(iterations):
        # 1. Solve coefficients given the current affine pose.
        #    proj(L) = A_lin @ L + a_bias ; d proj/dc = A_lin @ J.
        a_lin = pose.linear  # (2,3)
        design = np.einsum('pi,lij->lpj', a_lin, j_full)       # (68,2,636)
        design = design.reshape(NUM_LANDMARKS * 2, basis.dim)
        base = pose.project(basis.l0).reshape(-1)
        rhs = obs_uv.reshape(-1) - base
        a_aug = np.vstack([design, regularization * np.eye(basis.dim)])
        b_aug = np.concatenate([rhs, np.zeros(basis.dim)])
        coeffs, *_ = np.linalg.lstsq(a_aug, b_aug, rcond=None)

        # 2. Re-estimate the affine pose from current model landmarks.
        pose = estimate_pose(basis.landmarks(coeffs), obs_uv)

    model_lm = basis.landmarks(coeffs)
    pred = pose.project(model_lm)
    rmse = float(np.sqrt(np.mean(np.sum((pred - obs_uv) ** 2, axis=1))))
    return coeffs, pose, rmse


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def export_mesh(gnm, coeffs: np.ndarray, pose: Pose, out_dir: Path) -> None:
    """Write fitted mesh as OBJ (triangulated) + params JSON."""
    from gnm.shape import gnm_landmarks

    c_id, c_ex = coeffs[:NUM_IDENTITY], coeffs[NUM_IDENTITY:]
    verts, _ = gnm.vertices_and_landmarks(
        landmarks_type=gnm_landmarks.GNMLandmarksType.HEAD_SPARSE_68,
        identity=c_id,
        expression=c_ex,
    )
    verts = np.asarray(verts, dtype=np.float64)
    # Apply the fitted weak-perspective pose: xy from the affine, z scaled
    # by the mean singular value of its linear part (depth is weakly
    # observable from one view — documented approximation).
    lin = pose.linear
    z_scale = float(np.mean(np.linalg.svd(lin, compute_uv=False)))
    hom = np.concatenate([verts, np.ones((len(verts), 1))], axis=1)
    projected = hom @ pose.affine.T  # (V,2) pixel coords
    # Store normalized device coords instead of raw pixels for the OBJ:
    # undo translation/scale is ambiguous; keep pixel-space xy and scaled z.
    verts = np.stack([projected[:, 0], projected[:, 1], verts[:, 2] * z_scale], axis=1)

    # Triangulate quads (v0,v1,v2,v3) -> (0,1,2),(0,2,3). GNM quad vertex
    # order follows the mesh's UV grid; standard split is acceptable for a
    # first export — validate visually before production use.
    quads = np.asarray(gnm.quads)
    tris = np.concatenate(
        [quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]], axis=0
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    obj_path = out_dir / 'persona_head.obj'
    with obj_path.open('w') as f:
        f.write('# GNM Head V3 fit — Nitro Forge persona\n')
        for v in verts:
            f.write(f'v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n')
        for t in tris:
            f.write(f'f {t[0]+1} {t[1]+1} {t[2]+1}\n')

    params = {
        'model': 'gnm-head-v3',
        'license': 'Apache-2.0 (google/GNM)',
        'identity': c_id.tolist(),
        'expression': c_ex.tolist(),
        'pose': {
            'affine': pose.affine.tolist(),
            'note': 'weak-perspective 2D affine; z scaled by mean singular value',
        },
    }
    (out_dir / 'persona_params.json').write_text(json.dumps(params))
    print(f'wrote {obj_path} and persona_params.json ({len(verts)} verts, {len(tris)} tris)')


# ---------------------------------------------------------------------------
# Self test: synthesize landmarks from known coefficients, fit, compare.
# ---------------------------------------------------------------------------


def selftest(gnm, basis: LandmarkBasis) -> int:
    rng = np.random.default_rng(7)
    true_coeffs = rng.normal(0, 0.5, basis.dim)
    # Keep coefficients in a plausible range.
    true_coeffs = np.clip(true_coeffs, -2.0, 2.0)
    model_lm = basis.landmarks(true_coeffs)

    # Simulate a weak-perspective camera as a 2D affine.
    pose = Pose(affine=np.array([
        [140.0, 8.0, 540.0],
        [-6.0, 138.0, 320.0],
        [0.0, 0.0, 0.0],
    ]))
    # project() expects affine (2,4)-style rows [x,y,z,bias]; build properly:
    pose.affine = np.array([[140.0, 8.0, 0.0, 540.0],
                            [-6.0, 138.0, 0.0, 320.0]])
    obs = pose.project(model_lm)

    fitted, est_pose, rmse = fit(basis, obs, iterations=15)
    # The coefficient vector has a large null space (636 params vs 136
    # observations); what matters is reconstruction accuracy, so score
    # landmark-space and full-vertex error against the ground truth.
    l_err = float(np.sqrt(np.mean(np.sum(
        (basis.landmarks(fitted) - model_lm) ** 2, axis=1))))
    b_all = np.concatenate(
        [np.asarray(gnm.vertex_identity_basis),
         np.asarray(gnm.expression_basis)], axis=0)
    mean_v = np.asarray(
        gnm.vertex_positions_bind_pose(identity=None, expression=None))

    def _verts(c):
        return mean_v + np.einsum('ivc,i->vc', b_all, c)

    v_err = float(np.sqrt(np.mean(np.sum(
        (_verts(fitted) - _verts(true_coeffs)) ** 2, axis=1))))
    print(f'selftest: px_rmse={rmse:.3f} landmark_rmse={l_err:.4f} '
          f'vertex_rmse={v_err:.4f}')
    ok = rmse < 5.0 and v_err < 0.05
    print('SELFTEST', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--input', type=Path)
    ap.add_argument('--output', type=Path, default=Path('persona_out'))
    ap.add_argument('--dump-basis', type=Path)
    ap.add_argument('--selftest-joint', action='store_true')
    ap.add_argument('--selftest-mp', action='store_true')
    args = ap.parse_args()

    gnm = load_gnm()
    basis = build_landmark_basis(gnm)
    print(f'basis: l0={basis.l0.shape} j_id={basis.j_id.shape} j_ex={basis.j_ex.shape}')

    if args.dump_basis:
        args.dump_basis.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            args.dump_basis / 'landmark_basis.npz',
            l0=basis.l0, j_id=basis.j_id, j_ex=basis.j_ex,
        )
        print(f'dumped basis to {args.dump_basis}/landmark_basis.npz')

    if args.selftest:
        return selftest(gnm, basis)
    if args.selftest_joint:
        return selftest_joint(gnm, basis)
    if args.selftest_mp:
        return selftest_mp_mapping()

    if not args.input:
        ap.error('provide --input landmarks.json or --selftest')

    data = json.loads(args.input.read_text())
    obs = np.array(data['landmarks'], dtype=np.float64)
    if obs.shape != (NUM_LANDMARKS, 2):
        raise SystemExit(f'expected 68x2 landmarks, got {obs.shape}')
    coeffs, pose, rmse = fit(basis, obs)
    print(f'fit rmse={rmse:.3f}px')
    export_mesh(gnm, coeffs, pose, args.output)
    return 0




# ---------------------------------------------------------------------------
# MediaPipe correspondence + multi-frame joint fit
# ---------------------------------------------------------------------------

_MP_MAP_PATH = Path(__file__).parent / 'mp_to_gnm68.json'


def load_mp_mapping(path: Path | None = None) -> list[int]:
    """Return mp_index for each of the 68 GNM landmarks, in GNM order."""
    data = json.loads((path or _MP_MAP_PATH).read_text())
    corr = sorted(data['correspondences'], key=lambda c: c['gnm_index'])
    if len(corr) != NUM_LANDMARKS:
        raise ValueError('mp_to_gnm68.json does not contain 68 correspondences')
    return [int(c['mp_index']) for c in corr]


def mp478_to_gnm68(mp_points: np.ndarray, mapping: list[int] | None = None) -> np.ndarray:
    """Reorder MediaPipe FaceLandmarker output (478,>=2) to GNM sparse-68.

    `mp_points` may be normalized (x,y in 0..1) or pixel coordinates; the
    caller is responsible for consistent intrinsics handling.
    """
    mp_points = np.asarray(mp_points, dtype=np.float64)
    if mp_points.ndim != 2 or mp_points.shape[1] < 2:
        raise ValueError('expected (N,>=2) landmark array')
    idx = mapping or load_mp_mapping()
    return mp_points[np.asarray(idx)][:, :2]


def fit_joint(
    basis: LandmarkBasis,
    frames: list[np.ndarray],
    iterations: int = 15,
    regularization: float = 10.0,
) -> tuple[np.ndarray, list[Pose], list[float]]:
    """Joint multi-frame fit: one shared identity, per-frame expression+pose.

    `frames` is a list of (68,2) landmark observations (e.g. front, left,
    right, expression steps). Identity coefficients are shared across all
    frames; each frame gets its own expression coefficients and affine pose.
    This mirrors the capture protocol where several poses describe one
    identity.

    Returns (identity_coeffs[253], expression_coeffs per frame[383],
    poses, per-frame rmse_px).
    """
    n_frames = len(frames)
    if n_frames == 0:
        raise ValueError('fit_joint requires at least one frame')

    c_id = np.zeros(NUM_IDENTITY)
    c_ex = [np.zeros(NUM_EXPRESSION) for _ in range(n_frames)]
    poses = [Pose() for _ in range(n_frames)]

    j_id = basis.j_id      # (68,3,253)
    j_ex = basis.j_ex      # (68,3,383)

    for _ in range(iterations):
        # 1. Solve shared identity coefficients across all frames.
        #    For frame f: proj(L) = A_f (l0 + J_id c_id + J_ex c_ex_f) + b_f
        #    => residual linear in c_id with c_ex_f fixed.
        rows, rhs = [], []
        for f in range(n_frames):
            a_lin = poses[f].linear
            # landmark positions with current expr, minus expr contribution
            expr_l = np.einsum('lci,i->lc', j_ex, c_ex[f])
            l_base = basis.l0 + expr_l
            design = np.einsum('pi,lij->lpj', a_lin, j_id)  # (68,2,253)
            design = design.reshape(NUM_LANDMARKS * 2, NUM_IDENTITY)
            base = poses[f].project(l_base).reshape(-1)
            rows.append(design)
            rhs.append(frames[f].reshape(-1) - base)
        a_all = np.vstack(rows)
        b_all = np.concatenate(rhs)
        a_aug = np.vstack([a_all, regularization * np.eye(NUM_IDENTITY)])
        b_aug = np.concatenate([b_all, np.zeros(NUM_IDENTITY)])
        c_id, *_ = np.linalg.lstsq(a_aug, b_aug, rcond=None)

        # 2. Per frame: solve expression coefficients given identity+pose.
        for f in range(n_frames):
            a_lin = poses[f].linear
            design = np.einsum('pi,lij->lpj', a_lin, j_ex)
            design = design.reshape(NUM_LANDMARKS * 2, NUM_EXPRESSION)
            id_l = basis.l0 + np.einsum('lci,i->lc', j_id, c_id)
            base = poses[f].project(id_l).reshape(-1)
            rhs_f = frames[f].reshape(-1) - base
            # Expression is lower-dimensional trust: stronger regularization.
            reg_ex = regularization * 3.0
            a_aug = np.vstack([design, reg_ex * np.eye(NUM_EXPRESSION)])
            b_aug = np.concatenate([rhs_f, np.zeros(NUM_EXPRESSION)])
            c_ex[f], *_ = np.linalg.lstsq(a_aug, b_aug, rcond=None)

            # 3. Re-estimate this frame's pose.
            l_frame = basis.l0 + np.einsum('lci,i->lc', j_id, c_id) + np.einsum(
                'lci,i->lc', j_ex, c_ex[f])
            poses[f] = estimate_pose(l_frame, frames[f])

    rmses = []
    for f in range(n_frames):
        l_frame = basis.l0 + np.einsum('lci,i->lc', j_id, c_id) + np.einsum(
            'lci,i->lc', j_ex, c_ex[f])
        pred = poses[f].project(l_frame)
        rmses.append(float(np.sqrt(np.mean(np.sum((pred - frames[f]) ** 2, axis=1)))))
    return c_id, c_ex, poses, rmses


def selftest_joint(gnm, basis: LandmarkBasis) -> int:
    """Two-frame joint fit: shared identity, different expressions/poses."""
    rng = np.random.default_rng(11)
    true_id = np.clip(rng.normal(0, 0.4, NUM_IDENTITY), -1.5, 1.5)
    true_ex = [np.clip(rng.normal(0, 0.3, NUM_EXPRESSION), -1.0, 1.0) for _ in range(2)]
    poses_true = [
        Pose(affine=np.array([[140., 5., 0., 540.], [-4., 135., 0., 330.]])),
        Pose(affine=np.array([[135., -12., 0., 555.], [10., 130., 0., 325.]])),
    ]
    frames = []
    for f in range(2):
        lm = basis.l0 + np.einsum('lci,i->lc', basis.j_id, true_id) + np.einsum(
            'lci,i->lc', basis.j_ex, true_ex[f])
        frames.append(poses_true[f].project(lm))

    c_id, _c_ex, poses, rmses = fit_joint(basis, frames, iterations=15)
    id_err = float(np.sqrt(np.mean((c_id - true_id) ** 2)))
    print(f'joint selftest: id_rmse={id_err:.4f} frame_rmse={rmses}')
    ok = all(r < 5.0 for r in rmses) and id_err < 0.5
    print('JOINT SELFTEST', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def selftest_mp_mapping() -> int:
    """Verify the MediaPipe->GNM68 mapping shape and index range."""
    idx = load_mp_mapping()
    ok = len(idx) == NUM_LANDMARKS and min(idx) >= 0 and max(idx) < 478
    uniq = len(set(idx))
    print(f'mp mapping: {len(idx)} entries, {uniq} unique, range {min(idx)}..{max(idx)}')
    # A fully degenerate mapping (all same index) would be a bug.
    ok = ok and uniq > 50
    print('MP MAP SELFTEST', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
