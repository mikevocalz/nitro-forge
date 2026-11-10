#!/usr/bin/env python3
"""End-to-end persona fit from photos.

photos -> MediaPipe FaceLandmarker (478 pts) -> mp_to_gnm68 mapping ->
gnm_fit (single-frame `fit` or multi-frame `fit_joint`) ->
persona_head.obj + persona_params.json (+ per-frame params for multi).

This is the offline/reference path for the same contract the on-device
extractor will feed: 478 MediaPipe landmarks in, GNM coefficients out.

Usage:
  python persona_fit_image.py front.jpg [left.jpg right.jpg ...] \
      --out ./persona_out

Requires: gnm-shape (GNM_LANDMARKS_FILE set), mediapipe, opencv,
the face landmarker task model (default /tmp/gnm-assets/face_landmarker.task),
and mp_to_gnm68.json in this directory.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gnm_fit as G  # noqa: E402
import mp_to_gnm68 as M  # noqa: E402


def load_rgb(path: Path) -> np.ndarray:
    import cv2

    img = cv2.imread(str(path))
    if img is None:
        raise SystemExit(f'cannot read image: {path}')
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def landmarks68_from_photo(path: Path, model: Path) -> np.ndarray | None:
    """Photo -> (68,2) GNM-ordered landmark pixels, or None if no face."""
    img = load_rgb(path)
    h, w = img.shape[:2]
    mp_lm = M.detect_landmarks(img, model)
    if mp_lm is None:
        return None
    px = mp_lm[:, :2] * np.array([w, h])  # normalized -> pixels
    return G.mp478_to_gnm68(px)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('images', type=Path, nargs='+')
    ap.add_argument('--model', type=Path,
                    default=Path('/tmp/gnm-assets/face_landmarker.task'))
    ap.add_argument('--out', type=Path, default=Path('./persona_out'))
    ap.add_argument('--iterations', type=int, default=15)
    args = ap.parse_args()

    frames = []
    for p in args.images:
        lm = landmarks68_from_photo(p, args.model)
        if lm is None:
            print(f'no face detected in {p} — skipped', file=sys.stderr)
            continue
        frames.append(lm)
    if not frames:
        print('no usable frames', file=sys.stderr)
        return 2

    gnm = G.load_gnm()
    basis = G.build_landmark_basis(gnm)
    args.out.mkdir(parents=True, exist_ok=True)

    if len(frames) == 1:
        coeffs, pose, rmse = G.fit(basis, frames[0], iterations=args.iterations)
        G.export_mesh(gnm, coeffs, pose, args.out)
        print(f'single-frame fit rmse={rmse:.3f}px -> {args.out}')
        return 0

    c_id, c_ex, poses, rmses = G.fit_joint(basis, frames, iterations=args.iterations)
    # Neutral persona = shared identity + mean expression across frames.
    coeffs = np.concatenate([c_id, np.mean(c_ex, axis=0)])
    # export_mesh poses with a single affine; use the first frame's pose
    # (frontal capture is conventionally first).
    G.export_mesh(gnm, coeffs, poses[0], args.out)
    per_frame = {
        'identity': c_id.tolist(),
        'frames': [
            {'expression': c_ex[f].tolist(), 'pose_affine': poses[f].affine.tolist()}
            for f in range(len(frames))
        ],
        'rmses_px': rmses,
        'sources': [str(p) for p in args.images],
    }
    (args.out / 'persona_params.json').write_text(json.dumps(per_frame, indent=2))
    print(f'joint fit {len(frames)} frames id shared, rmses={rmses} -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
