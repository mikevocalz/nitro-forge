#!/usr/bin/env python3
"""Headset/companion-side receiver for the persona capture transfer.

Accepts POST /capture (multipart/form-data: `manifest` JSON field plus one
file part per `sample_<stepId>`), stores the bundle under --out, and returns
{"acknowledgement": <uuid>} on HTTP 200. The phone maps that 2xx response to
`PersonaCapture.transferAcknowledged()`; processing then proceeds on this
host. This is our own transport contract — not any proprietary sync
protocol.

Usage:
  python transfer_server.py --out ./received --port 8777
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 64 * 1024 * 1024  # 64 MB capture bundle cap


class Handler(BaseHTTPRequestHandler):
    out_dir: Path = Path('.')
    token: str | None = None

    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == '/health':
            self._send(200, {'ok': True})
        else:
            self._send(404, {'error': 'not found'})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != '/capture':
            self._send(404, {'error': 'not found'})
            return
        if self.token and self.headers.get('authorization') != f'Bearer {self.token}':
            self._send(401, {'error': 'unauthorized'})
            return
        length = int(self.headers.get('content-length') or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(413, {'error': 'bad content-length'})
            return
        ctype = self.headers.get('content-type', '')
        if 'multipart/form-data' not in ctype:
            self._send(415, {'error': 'expected multipart/form-data'})
            return
        body = self.rfile.read(length)
        msg = BytesParser().parsebytes(
            f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n'.encode() + body
        )
        if not msg.is_multipart():
            self._send(400, {'error': 'not multipart'})
            return

        manifest_raw = None
        samples: list[tuple[str, bytes]] = []
        for part in msg.get_payload():
            if not isinstance(part, type(msg)):
                continue
            name = part.get_param('name', header='content-disposition')
            filename = part.get_filename()
            data = part.get_payload(decode=True) or b''
            if name == 'manifest':
                manifest_raw = data
            elif filename and name and str(name).startswith('sample_'):
                safe = re.sub(r'[^A-Za-z0-9._-]', '_', filename)
                samples.append((safe, data))

        if manifest_raw is None or not samples:
            self._send(400, {'error': 'manifest and at least one sample required'})
            return
        try:
            manifest = json.loads(manifest_raw)
            epoch = int(manifest.get('epoch', 0))
        except Exception:
            self._send(400, {'error': 'invalid manifest'})
            return

        ack = uuid.uuid4().hex
        dest = self.out_dir / f'epoch_{epoch}_{ack[:8]}'
        dest.mkdir(parents=True, exist_ok=True)
        (dest / 'manifest.json').write_bytes(manifest_raw)
        for fname, data in samples:
            (dest / fname).write_bytes(data)
        (dest / 'ACK').write_text(ack)

        self._send(200, {'acknowledgement': ack, 'epoch': epoch, 'files': len(samples)})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', type=Path, default=Path('./received'))
    ap.add_argument('--port', type=int, default=8777)
    ap.add_argument('--token', default=None, help='optional bearer token')
    args = ap.parse_args()
    Handler.out_dir = args.out
    Handler.token = args.token
    args.out.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('0.0.0.0', args.port), Handler)
    print(f'persona transfer receiver on :{args.port} -> {args.out}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
