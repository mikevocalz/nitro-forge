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

## Additional tools

- `mp_to_gnm68.py` — builds `mp_to_gnm68.json`, the MediaPipe FaceLandmarker
  (478pt) → GNM sparse-68 correspondence, by rendering the GNM template,
  running the detector, and nearest-neighbor matching. Verified end-to-end
  (detection succeeds on the synthetic render; mean NN distance 0.013).
  The mapping is geometric, not hand-annotated — visually verify on real
  captures before trusting fine detail.
- `gnm_drive.py` — poses a fitted persona: `--params persona_params.json`
  plus expression coefficients and per-joint axis-angle rotations
  ([neck, head, left_eye, right_eye]) → posed OBJ or a frame sequence.
  This is the live-presence data path: production feeds calibrated
  PersonaPerformance output into the 383 GNM expression dims.
- `transfer_server.py` — receiver half of the companion-phone transfer:
  POST /capture (manifest + samples) → stored bundle + `{acknowledgement}`
  for `transferAcknowledged()`. Verified with a real multipart POST.

## Selftests

```bash
python gnm_fit.py --selftest        # single-frame fit
python gnm_fit.py --selftest-joint  # multi-frame shared-identity fit
python gnm_fit.py --selftest-mp     # landmark mapping sanity
```

All three PASS. Joint fit: shared identity RMSE 0.37, per-frame px RMSE
<0.2 on synthetic two-pose data.

## Not yet done

- On-device MediaPipe extraction feeding `mp478_to_gnm68` (mapping table
  exists; the RN-side extractor does not).
- Expression decomposition per capture step (frames mode of gnm_drive
  accepts per-frame expressions; fitting them is future work).
- Rigged export for the RN renderer (joints/LBS weights exist upstream;
  OBJ export is static posed geometry).
- Renderer integration (OBJ → Nitro Forge splat/mesh pipeline).
