#!/usr/bin/env python3
"""Opt-in real LibRaw RGB -> Prism raster/snapshot proof; no catalog or UI claim."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('work', type=Path, help='Completed run.py output directory')
parser.add_argument('--nf-cli', type=Path, default=Path(__file__).resolve().parents[2] / 'target/debug/nf-cli')
args = parser.parse_args()
manifest = json.loads(Path(__file__).with_name('manifest.json').read_text())
metadata = json.loads((args.work / 'result.json').read_text())
original = args.work / 'pentax-k7.dng'
original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
if original_hash != manifest['fixture']['sha256']:
    raise SystemExit('Original RAW does not match the admitted camera fixture')
if metadata.get('fixture_sha256') != original_hash or metadata.get('source_sha256') != manifest['source']['sha256']:
    raise SystemExit('Decode provenance does not match the pinned source and fixture')
ppm = (args.work / 'pentax-k7.ppm').read_bytes()
if hashlib.sha256(ppm).hexdigest() != metadata['preview_sha256']:
    raise SystemExit('Preview changed after the actual LibRaw decode')
magic, dimensions, maximum, rgb = ppm.split(b'\n', 3)
width, height = map(int, dimensions.split())
if magic != b'P6' or maximum != b'255' or width <= 0 or height <= 0 or width * height > 40_000_000 or len(rgb) != width * height * 3:
    raise SystemExit('Invalid decoded RGB preview')
# Explicit nearest-sample preview reduction keeps the existing UI/JSON budgets.
# It does not develop RAW or alter the camera original; LibRaw already decoded RGB.
scale = min(1, 512 / max(width, height))
w, h = max(1, round(width * scale)), max(1, round(height * scale))
rgba = bytearray(w * h * 4)
for y in range(h):
    sy = min(height - 1, y * height // h)
    for x in range(w):
        sx = min(width - 1, x * width // w)
        source, target = (sy * width + sx) * 3, (y * w + x) * 4
        rgba[target:target + 3] = rgb[source:source + 3]
        rgba[target + 3] = 255

proc = subprocess.Popen([str(args.nf_cli.resolve())], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
sequence = 0
handles = []
def call(op, handle=0, payload=None):
    global sequence
    sequence += 1
    request = {'id': sequence, 'handle': handle, 'op': op}
    if payload is not None:
        request['payload'] = payload
    proc.stdin.write(json.dumps(request) + '\n')
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        raise RuntimeError('Real engine host ended before replying')
    response = json.loads(line)
    if response.get('id') != sequence or not response.get('ok'):
        raise RuntimeError(response)
    return response.get('data')
def apply(handle, op, payload=None):
    return call('apply', handle, {'op': op, 'payload': payload or {}})
def snapshot(handle):
    return base64.b64decode(call('snapshot', handle)['bytes'], validate=True)
def require(condition, message):
    if not condition:
        raise RuntimeError(message)
try:
    handle = call('open', payload={'kind': 'prism'})['handle']
    handles.append(handle)
    apply(handle, 'new', {'width': w, 'height': h})
    layer = apply(handle, 'addRasterLayer', {'name': 'Real RAW RGB preview'})['layer_id']
    blank = snapshot(handle)
    apply(handle, 'drawPixels', {'id': layer, 'x': 0, 'y': 0, 'w': w, 'h': h, 'data_b64': base64.b64encode(rgba).decode()})
    rendered = apply(handle, 'flatten')
    require((rendered['width'], rendered['height']) == (w, h), 'Engine changed preview dimensions')
    require(base64.b64decode(rendered['pixels_b64'], validate=True) == rgba, 'Flattened pixels differ from decoded RGB')
    saved = snapshot(handle)
    require(apply(handle, '__undo')['undone'], 'Pixel import did not record undo')
    require(snapshot(handle) == blank, 'Undo did not restore blank raster')
    require(apply(handle, '__redo')['redone'], 'Pixel import did not record redo')
    require(snapshot(handle) == saved, 'Redo changed the imported snapshot')
    reopened = call('open', payload={'kind': 'prism'})['handle']
    handles.append(reopened)
    call('restore', reopened, {'bytes': base64.b64encode(saved).decode()})
    require(snapshot(reopened) == saved, 'Restored snapshot differs')
    require(base64.b64decode(apply(reopened, 'flatten')['pixels_b64'], validate=True) == rgba, 'Restored flattened pixels differ')
    require(hashlib.sha256(original.read_bytes()).hexdigest() == original_hash, 'Camera original changed')
    artifact = args.work / 'raw-preview-prism.nfd'
    artifact.write_bytes(saved)
    result = {'scope': 'macOS LibRaw RGB preview -> real Prism engine', 'width': w, 'height': h,
              'rgba_sha256': hashlib.sha256(rgba).hexdigest(), 'snapshot_sha256': hashlib.sha256(saved).hexdigest(),
              'fixture_sha256': original_hash, 'engine_host_sha256': hashlib.sha256(args.nf_cli.read_bytes()).hexdigest(), 'flatten_exact': True, 'single_undo_redo': True,
              'snapshot_reopen_exact': True, 'original_unchanged': True, 'catalog_implemented': False}
    (args.work / 'prism-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
finally:
    for handle in handles:
        try:
            call('close', handle)
        except Exception:
            pass
    proc.stdin.close()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.terminate()
        proc.wait(timeout=5)
