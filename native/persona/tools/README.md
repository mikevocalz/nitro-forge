# GNM fitting tool

`gnm_fit.py` fits the open **GNM Head V3** parametric model
([google/GNM](https://github.com/google/GNM), Apache-2.0) to 2D landmarks —
the reconstruction backend for the persona capture pipeline. This is the
same model family the reference Likeness app uses (RealVatar/GNOME), but we
consume the public Apache-2.0 release, not Google's proprietary weights.

## Setup

```bash
uv venv /tmp/gnm-venv --python 3.13
VIRTUAL_ENV=/tmp/gnm-venv uv pip install \
  "gnm-shape @ git+https://github.com/google/GNM.git#subdirectory=gnm/shape"
# The pip package drops the Bazel-linked landmark data file; restore it:
mkdir -p /tmp/gnm-venv/lib/python3.13/site-packages/gnm/shape/data/landmarks
curl -L -o /tmp/gnm-venv/lib/python3.13/site-packages/gnm/shape/data/landmarks/head_sparse_68.txt \
  https://raw.githubusercontent.com/google/GNM/main/gnm/shape/data/landmarks/head_sparse_68.txt
# Model weights (~51 MB) download on first use to ~/.cache/gnm/models/
```

## Usage

```bash
export GNM_LANDMARKS_FILE=/tmp/gnm-venv/lib/python3.13/site-packages/gnm/shape/data/landmarks/head_sparse_68.txt

# Validate the fitter on synthetic data (must print SELFTEST PASS):
python gnm_fit.py --selftest

# Fit real landmarks:
python gnm_fit.py --input landmarks.json --output persona_out
```

`landmarks.json` carries 68 GNM sparse-landmark pixel coordinates plus
intrinsics (`fx/fy/cx/cy`). On-device extraction uses MediaPipe Face
Landmarker (478 pts) — a sparse-68 mapping layer is the next piece of work.

## How it works

- GNM vertex positions are linear in identity (253) + expression (383)
  coefficients, and the 68 landmarks are fixed barycentric vertex blends,
  so landmark positions are exactly linear in the coefficients.
- `build_landmark_basis` forms the exact Jacobian `(68,3,636)` from the
  vertex bases — no finite differences, no per-component model evals.
- `fit` alternates: regularized linear least squares for coefficients
  (ridge λ=10; the system is underdetermined — 136 observations vs 636
  params — so regularization supplies the minimum-norm prior) and a
  weak-perspective 2D affine pose re-estimate. ~15 iterations converge.
- `export_mesh` writes a triangulated OBJ (17,821 verts, 35,324 tris;
  skin/eyes/teeth/tongue components are merged for now) plus
  `persona_params.json` with the coefficient vector and pose — the params
  drive expressions and head pose at runtime via `vertices_and_landmarks`.

## Verified

`SELFTEST PASS`: synthetic roundtrip from known coefficients gives
px_rmse=0.17, landmark_rmse=0.0026, vertex_rmse=0.0023 (model units).

## Not yet done

- MediaPipe 478 → GNM sparse-68 correspondence mapping.
- Multi-image joint fit (our capture protocol supplies several poses;
  v1 fits a single frame — identity should be jointly fit across frames).
- Expression decomposition per capture step.
- Rigged export (joints/skin weights) for live presence — params JSON has
  coefficients only; `apply_linear_blend_skinning` is available upstream.
- Renderer integration (OBJ → Nitro Forge splat/mesh pipeline).
