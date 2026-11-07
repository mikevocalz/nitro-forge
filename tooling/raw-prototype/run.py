#!/usr/bin/env python3
"""Opt-in isolated macOS LibRaw proof; no install or product dependency mutation."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
work = pathlib.Path(sys.argv[1]) if len(sys.argv) == 2 else pathlib.Path(tempfile.mkdtemp(prefix='nf-raw-proof-'))
work.mkdir(parents=True, exist_ok=True)
if shutil.disk_usage(work).free < 512 * 1024 * 1024:
    raise SystemExit('Need at least 512 MiB free for isolated source/fixture/build')
def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)
def download(key, name):
    spec = manifest[key]
    target = work / name
    if not target.exists():
        run('curl', '--fail', '--location', '--silent', '--show-error', '--max-filesize', '67108864', spec['url'], '-o', str(target))
    if hashlib.sha256(target.read_bytes()).hexdigest() != spec['sha256']:
        raise SystemExit(f'Hash mismatch: {target}')
    return target
archive = download('source', 'LibRaw-0.22.3.tar.gz')
fixture = download('fixture', 'pentax-k7.dng')
source = work / 'LibRaw-0.22.3'
if not source.exists():
    run('tar', '-xzf', str(archive), '-C', str(work))
with (work / 'build.log').open('w') as log:
    run('make', '-f', 'Makefile.dist', '-j4', 'lib/libraw_r.a', 'CXX=clang++', 'CC=clang', 'CFLAGS=-O2 -I. -w -DUSE_ZLIB', cwd=source, stdout=log, stderr=subprocess.STDOUT)
binary = work / 'decode'
run('clang++', '-std=c++17', '-O2', '-I' + str(source), str(root / 'decode.cpp'), str(source / 'lib/libraw_r.a'), '-lz', '-o', str(binary))
# Every run gets a fresh negative-test output path so a stale artifact cannot pass.
with tempfile.TemporaryDirectory(prefix='invalid-', dir=work) as negative:
    invalid = pathlib.Path(negative) / 'not-raw.bin'
    output = pathlib.Path(negative) / 'must-not-exist.ppm'
    invalid.write_bytes(b'not a RAW image')
    rejected = subprocess.run([str(binary), str(invalid), str(output)], capture_output=True, text=True)
    if rejected.returncode == 0 or output.exists():
        raise SystemExit('Malformed input was accepted or produced an output artifact')
    negative_result = {'exit': rejected.returncode, 'artifact_created': False, 'error': rejected.stderr.strip()}
result = subprocess.check_output([str(binary), str(fixture), str(work / 'pentax-k7.ppm')], text=True)
metadata = json.loads(result)
preview = work / 'pentax-k7.ppm'
metadata['invalid_input'] = negative_result
metadata['preview_sha256'] = hashlib.sha256(preview.read_bytes()).hexdigest()
metadata['source_sha256'] = manifest['source']['sha256']
metadata['fixture_sha256'] = manifest['fixture']['sha256']
(work / 'result.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps({'work': str(work), 'result': metadata}, indent=2))
