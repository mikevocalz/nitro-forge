#!/usr/bin/env python3
"""Drive a fitted GNM persona: pose the head and apply expression coeffs.

This is the live-presence data path at tool level: `persona_params.json`
from gnm_fit.py supplies identity coefficients; expression coefficients and
joint rotations come from a host (the Nitro PersonaPerformance timeline in
production — its calibrated output can target the 383 GNM expression dims
directly via the existing calibration matrix).

Usage:
  gnm_drive.py --params persona_params.json --expression expr.json \
      --yaw 0.3 --pitch 0.1 --out posed_head.obj

expr.json: {"expression": [383 floats]} or {"frames": [{"t":..,"expression":[..],"rotations":[[j,rx,ry,rz],..]}, ...]}
Rotation convention: per-joint axis-angle (radians), joints ordered
[neck, head, left_eye, right_eye] in the GNM rig.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import gnm_fit as G  # noqa: E402

JOINT_NAMES = ['neck', 'head', 'left_eye', 'right_eye']


def load_params(path: Path) -> tuple[np.ndarray, np.ndarray]:
    d = json.loads(path.read_text())
    return (np.array(d['identity'], dtype=np.float64),
            np.array(d['expression'], dtype=np.float64))


def pose_frame(
    gnm,
    identity: np.ndarray,
    expression: np.ndarray,
    rotations: np.ndarray | None = None,
    translation: np.ndarray | None = None,
):
    from gnm.shape import gnm_landmarks

    return gnm.vertices_and_landmarks(
        landmarks_type=gnm_landmarks.GNMLandmarksType.HEAD_SPARSE_68,
        identity=identity,
        expression=expression,
        rotations=rotations,
        translation=translation,
    )


def export_obj(verts: np.ndarray, tris: np.ndarray, path: Path) -> None:
    with path.open('w') as f:
        f.write('# GNM Head V3 posed frame — Nitro Forge persona\n')
        for v in verts:
            f.write(f'v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n')
        for t in tris:
            f.write(f'f {int(t[0])+1} {int(t[1])+1} {int(t[2])+1}\n')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--params', type=Path, required=True)
    ap.add_argument('--expression', type=Path, default=None,
                    help='JSON with "expression" [383] or "frames" [...]')
    ap.add_argument('--yaw', type=float, default=0.0, help='head yaw rad')
    ap.add_argument('--pitch', type=float, default=0.0, help='head pitch rad')
    ap.add_argument('--roll', type=float, default=0.0, help='head roll rad')
    ap.add_argument('--out', type=Path, default=Path('posed_head.obj'))
    ap.add_argument('--frames-dir', type=Path, default=None,
                    help='export numbered OBJ frames instead of single')
    args = ap.parse_args()

    gnm = G.load_gnm()
    identity, base_expr = load_params(args.params)
    tris = np.asarray(gnm.triangles)

    expr = base_expr.copy()
    if args.expression:
        data = json.loads(args.expression.read_text())
        if 'expression' in data:
            expr = np.array(data['expression'], dtype=np.float64)
        elif 'frames' in data:
            frames = data['frames']
            outdir = args.frames_dir or args.out.parent / 'frames'
            outdir.mkdir(parents=True, exist_ok=True)
            for i, fr in enumerate(frames):
                e = np.array(fr.get('expression', []), dtype=np.float64)
                if e.size != gnm.expression_dim:
                    e = np.resize(e, gnm.expression_dim) if e.size else expr
                rot = np.zeros((gnm.num_joints, 3))
                for j, rx, ry, rz in fr.get('rotations', []):
                    rot[int(j)] = [rx, ry, rz]
                v, _ = pose_frame(gnm, identity, e, rotations=rot)
                export_obj(np.asarray(v), tris, outdir / f'frame_{i:04d}.obj')
            print(f'wrote {len(frames)} frames to {outdir}')
            return 0

    rot = np.zeros((gnm.num_joints, 3))
    # head is joint index 1; axis-angle [pitch, yaw, roll]-ish order.
    rot[1] = [args.pitch, args.yaw, args.roll]
    verts, _ = pose_frame(gnm, identity, expr, rotations=rot)
    export_obj(np.asarray(verts), tris, args.out)
    print(f'wrote {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
