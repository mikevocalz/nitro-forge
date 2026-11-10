#!/usr/bin/env python3
"""Build the MediaPipe FaceLandmarker (478pt) -> GNM sparse-68 correspondence.

Method: render the GNM Head template mesh frontally, run MediaPipe's
FaceLandmarker on the render, project the 68 GNM landmarks into the same
image, and match each GNM landmark to its nearest detected MediaPipe
landmark. Nearest-neighbor matching on a clean synthetic render gives a
verifiable correspondence table; ambiguous matches are flagged by distance.

Output: mp_to_gnm68.json — {"gnm_index": <0..67>, "mp_index": <0..477>,
"distance_px": float} plus summary stats. Requires:
  - gnm-shape installed (see tools/README.md)
  - mediapipe pip package
  - face_landmarker.task model (GNM_FACEMESH_MODEL env or /tmp/gnm-assets)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gnm_fit as G  # noqa: E402

IMAGE_W = IMAGE_H = 1024


def render_template(gnm, out_path: Path) -> np.ndarray:
    """Render the bind-pose head frontally with per-group skin-like colors.

    GNM's face normal is +z (nose landmarks have the largest z), so the
    front view is the x-y plane. Vertex groups give us eyes, irises,
    pupils, scleras and lips — coloring them makes the render face-like
    enough for MediaPipe's detector.
    """
    import matplotlib

    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection

    verts = np.asarray(
        gnm.vertex_positions_bind_pose(identity=None, expression=None)
    )
    tris = np.asarray(gnm.triangles)

    # Per-vertex base colors by semantic group (RGBA 0..1).
    vcol = np.tile(np.array([0.85, 0.68, 0.58, 1.0]), (len(verts), 1))  # skin
    group_colors = {
        'scleras': [0.95, 0.95, 0.95, 1.0],
        'irises': [0.25, 0.18, 0.10, 1.0],
        'pupils': [0.05, 0.05, 0.05, 1.0],
        'upper_lip': [0.72, 0.38, 0.38, 1.0],
        'lower_lip': [0.78, 0.45, 0.45, 1.0],
        'teeth': [0.92, 0.90, 0.85, 1.0],
        'tongue': [0.70, 0.30, 0.30, 1.0],
        'gums': [0.80, 0.55, 0.55, 1.0],
        'eye_exteriors': [0.55, 0.42, 0.38, 1.0],  # slightly darker socket rim
    }
    for name, col in group_colors.items():
        try:
            mask = gnm.vertex_group_mask(name)
        except Exception:
            continue
        vcol[mask] = col

    # Front-facing triangles only, lambertian shade.
    v0, v1, v2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    normals = np.cross(v1 - v0, v2 - v0)
    nn = np.linalg.norm(normals, axis=1) + 1e-9
    facing = normals[:, 2] / nn
    if np.mean(facing > 0) < 0.5:
        facing = -facing
    # Average vertex color per triangle, modulated by facing.
    tri_col = (vcol[tris[:, 0]] + vcol[tris[:, 1]] + vcol[tris[:, 2]]) / 3.0
    shade = np.clip(0.45 + 0.55 * np.clip(facing, 0, 1), 0, 1)
    colors = tri_col.copy()
    colors[:, :3] *= shade[:, None]
    colors[:, 3] = 1.0
    # Drop back-facing tris for a clean face silhouette.
    keep = facing > 0.05
    polys = verts[tris[keep]][:, :, :2]
    cols = colors[keep]

    # Crop to the face region (forehead->chin, ear to ear) and scale up.
    fx = (verts[:, 0] > -0.11) & (verts[:, 0] < 0.11)
    fy = (verts[:, 1] > 0.12) & (verts[:, 1] < 0.37)
    face = fx & fy
    fverts = verts[face]
    ftris_mask = keep & np.array(
        [bool((face[t]).any()) for t in tris[keep]]
    ) if False else keep
    # Simpler: keep all front tris but set axis limits to face bbox.
    fig, ax = plt.subplots(figsize=(4, 4), dpi=256)
    ax.set_facecolor('white')
    fig.patch.set_facecolor('white')
    coll = PolyCollection(polys, facecolors=cols, edgecolors='none')
    ax.add_collection(coll)
    ax.set_xlim(fverts[:, 0].min() - 0.005, fverts[:, 0].max() + 0.005)
    ax.set_ylim(fverts[:, 1].min() - 0.005, fverts[:, 1].max() + 0.005)
    ax.set_aspect('equal')
    ax.axis('off')
    fig.savefig(out_path, bbox_inches='tight', pad_inches=0.02)
    plt.close(fig)

    img = plt.imread(out_path)
    if img.dtype != np.uint8:
        img = (img[..., :3] * 255).astype(np.uint8)
    return img[:, :, :3].copy()


def detect_landmarks(img_rgb: np.ndarray, model_path: Path) -> np.ndarray | None:
    """Run MediaPipe FaceLandmarker; return (478,3) normalized landmarks."""
    import mediapipe as mp
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core.base_options import BaseOptions

    base = BaseOptions(model_asset_path=str(model_path))
    opts = vision.FaceLandmarkerOptions(
        base_options=base,
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    with vision.FaceLandmarker.create_from_options(opts) as det:
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
        res = det.detect(mp_img)
    if not res.face_landmarks:
        return None
    return np.array([[p.x, p.y, p.z] for p in res.face_landmarks[0]])


def main() -> int:
    import gnm_fit as GF

    gnm = GF.load_gnm()
    basis = GF.build_landmark_basis(gnm)
    gnm_lm = basis.l0  # (68,3) template positions

    render_path = Path('/tmp/gnm-assets/template_render.png')
    img = render_template(gnm, render_path)
    h, w = img.shape[:2]
    print(f'rendered {w}x{h}')

    model = Path(os.environ.get('GNM_FACEMESH_MODEL', '/tmp/gnm-assets/face_landmarker.task'))
    mp_lm = detect_landmarks(img, model)
    if mp_lm is None:
        print('FaceLandmarker found no face in render — check azim/elev')
        return 1
    print(f'detected {len(mp_lm)} mediapipe landmarks')

    # Project GNM landmarks into the rendered image. The render used the
    # raw vertex coords; matplotlib saved with bbox_inches tight so the
    # mapping from data coords to pixels needs the axes limits used.
    # Recompute using the same limits as render_template.
    verts = np.asarray(
        gnm.vertex_positions_bind_pose(identity=None, expression=None)
    )
    x, y, z = verts[:, 0], verts[:, 1], verts[:, 2]
    # Front view (azim=-90, elev=0): screen x ~ -y? Verify empirically by
    # comparing projected landmark spread to detected face bbox; try both
    # sign conventions and keep the one with lower mean NN distance.
    # GNM axes -> image: face is upright in the saved render (forehead at
    # top = larger y), image v grows downward, so try all axis/sign combos.
    xs = {
        'x': gnm_lm[:, 0], '-x': -gnm_lm[:, 0],
        'y': gnm_lm[:, 1], '-y': -gnm_lm[:, 1],
        'z': gnm_lm[:, 2], '-z': -gnm_lm[:, 2],
    }
    pairs = [('x', 'y'), ('x', '-y'), ('-x', 'y'), ('-x', '-y'),
             ('y', 'x'), ('y', '-x'), ('-y', 'x'), ('-y', '-x'),
             ('x', 'z'), ('x', '-z'), ('-x', 'z'), ('-x', '-z'),
             ('y', 'z'), ('y', '-z'), ('-y', 'z'), ('-y', '-z')]
    candidates = {f'{a}{b}': np.stack([xs[a], xs[b]], axis=1) for a, b in pairs}
    # Normalize each candidate to image coords via bbox of detected face.
    mp_xy = mp_lm[:, :2]
    mp_min, mp_max = mp_xy.min(0), mp_xy.max(0)

    best = None
    for name, xy in candidates.items():
        lo, hi = xy.min(0), xy.max(0)
        span = np.maximum(hi - lo, 1e-9)
        norm = (xy - lo) / span  # (68,2) in 0..1
        # Map into detected-face bbox region of the image.
        px = mp_min[0] + norm[:, 0] * (mp_max[0] - mp_min[0])
        py = mp_min[1] + norm[:, 1] * (mp_max[1] - mp_min[1])
        proj = np.stack([px, py], axis=1)
        d = np.sqrt(((proj[:, None, :] - mp_xy[None, :, :]) ** 2).sum(-1))
        nn = d.min(1)
        score = nn.mean()
        print(f'{name}: mean NN dist={score:.4f}')
        if best is None or score < best[0]:
            best = (score, name, proj, nn, d.argmin(1))

    score, name, proj, nn, mp_idx = best
    print(f'chose projection {name}, mean dist {score:.4f}, max {nn.max():.4f}')

    out = []
    for i in range(68):
        out.append({
            'gnm_index': i,
            'mp_index': int(mp_idx[i]),
            'distance': float(nn[i]),
        })
    result = {
        'method': 'synthetic-render nearest-neighbor',
        'projection': name,
        'mean_distance': float(score),
        'max_distance': float(nn.max()),
        'correspondences': out,
    }
    out_path = Path(__file__).parent / 'mp_to_gnm68.json'
    out_path.write_text(json.dumps(result, indent=2))
    print(f'wrote {out_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
