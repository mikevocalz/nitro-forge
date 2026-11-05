#!/usr/bin/env python3
"""Symbol, architecture and CRT gate for desktop hosts of the nf_v1 C ABI.

Uses the symbol list shared with the Apple/Android gates
(tooling/native/nf_v1_symbols.txt). Exits non-zero on any failure.

  ELF/Mach-O:        nm --defined-only on the Rust archive and the linked
                     executable; every symbol must be a defined text (T) symbol
                     (Mach-O adds a leading underscore).
  COFF (Windows):    dumpbin /symbols on the archive (External, in a section);
                     the linker map of the executable (PE images carry no COFF
                     symbol table); dumpbin /headers for the machine type of
                     both; dumpbin /directives + /dependents for the CRT.

verify_nf_v1_host_link.py --archive LIB --binary EXE [--map EXE.map]
                          [--machine x64|ARM64] [--nm NM]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MACHINES = {"x64": "8664", "ARM64": "AA64"}


def fail(message: str) -> None:
    print(f"FAIL {message}", file=sys.stderr)
    sys.exit(1)


def required_symbols() -> list[str]:
    lines = (ROOT / "tooling/native/nf_v1_symbols.txt").read_text(encoding="utf-8").splitlines()
    symbols = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    if not symbols:
        fail("nf_v1_symbols.txt lists no symbols")
    return symbols


def run(*command: str, tolerate_errors: bool = False) -> str:
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    # nm exits non-zero when it cannot parse some unrelated archive member (for
    # example std objects from a newer LLVM). The symbol match below decides,
    # as in the Apple/Android gate.
    if result.returncode != 0 and not (tolerate_errors and result.stdout):
        fail(f"{' '.join(command)} exited {result.returncode}: {result.stderr.strip()}")
    return result.stdout


def check_elf(archive: Path, binary: Path, nm: str, symbols: list[str]) -> None:
    for path in (archive, binary):
        defined = run(nm, "--defined-only", str(path), tolerate_errors=True)
        missing = [s for s in symbols if not re.search(rf"^\S*\s*T _?{re.escape(s)}$", defined, re.M)]
        if missing:
            fail(f"{path} does not define {', '.join(missing)}")
        print(f"{path.name}: {len(symbols)}/{len(symbols)} nf_v1 symbols defined (T)")


def find_dumpbin() -> str:
    found = shutil.which("dumpbin")
    if found:
        return found
    vswhere = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                   "Microsoft Visual Studio", "Installer", "vswhere.exe")
    if not vswhere.is_file():
        fail("dumpbin is not on PATH and vswhere.exe is missing")
    candidates = run(str(vswhere), "-latest", "-products", "*", "-find",
                     r"VC\Tools\MSVC\**\bin\Host*\*\dumpbin.exe").splitlines()
    candidates = [c for c in candidates if c.strip()]
    if not candidates:
        fail("vswhere found no dumpbin.exe")
    return candidates[0].strip()


def machines(dumpbin: str, path: Path) -> set[str]:
    return set(re.findall(r"^\s*([0-9A-F]{3,4}) machine \(", run(dumpbin, "/headers", str(path)), re.M))


def check_coff(archive: Path, binary: Path, link_map: Path, machine: str, symbols: list[str]) -> None:
    dumpbin = find_dumpbin()
    expected = MACHINES[machine]

    archive_symbols = run(dumpbin, "/symbols", str(archive))
    missing = [s for s in symbols
               if not re.search(rf"\bSECT[0-9A-F]+\b.*\bExternal\s+\|\s+{re.escape(s)}\s*$", archive_symbols, re.M)]
    if missing:
        fail(f"{archive} does not define {', '.join(missing)}")
    print(f"{archive.name}: {len(symbols)}/{len(symbols)} nf_v1 symbols defined (External, in a section)")

    archive_machines = machines(dumpbin, archive)
    if archive_machines != {expected}:
        fail(f"{archive} object machine types {sorted(archive_machines)}; expected {expected} ({machine})")
    binary_machines = machines(dumpbin, binary)
    if binary_machines != {expected}:
        fail(f"{binary} machine type {sorted(binary_machines)}; expected {expected} ({machine})")
    print(f"machine {expected} ({machine}) for the archive objects and {binary.name}")

    mapped = link_map.read_text(encoding="utf-8", errors="replace")
    missing = [s for s in symbols if not re.search(rf"\s{re.escape(s)}\s", mapped)]
    if missing:
        fail(f"{link_map} shows {binary.name} did not link {', '.join(missing)}")
    print(f"{binary.name}: linker map resolves {len(symbols)}/{len(symbols)} nf_v1 symbols from the archive")

    # Rust's *-pc-windows-msvc std defaults to the dynamic CRT. The archive and
    # the host must agree, or the link mixes two heaps and two CRT states.
    # A static-CRT (crt-static) archive embeds /DEFAULTLIB:libcmt; that must
    # not be linked into a /MD host. The dynamic CRT request is reported by
    # `rustc --print native-static-libs`, which CI prints next to this gate.
    directives = run(dumpbin, "/directives", str(archive)).lower()
    if re.search(r"/defaultlib:\"?libcmt", directives):
        fail(f"{archive} requests the static CRT (libcmt); the host links /MD")
    dependents = run(dumpbin, "/dependents", str(binary)).lower()
    if "vcruntime140.dll" not in dependents or "vcruntime140d.dll" in dependents:
        fail(f"{binary} does not load the dynamic release CRT (vcruntime140.dll)")
    print("CRT: archive has no static-CRT directive; executable loads vcruntime140.dll (/MD)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--map", type=Path, help="MSVC linker map of --binary (Windows)")
    parser.add_argument("--machine", choices=sorted(MACHINES), help="expected COFF machine (Windows)")
    parser.add_argument("--nm", default="nm", help="nm for the target (ELF/Mach-O)")
    args = parser.parse_args()

    for path in (args.archive, args.binary):
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"missing or empty file: {path}")
    symbols = required_symbols()
    if args.map or args.machine:
        if not (args.map and args.machine):
            fail("--map and --machine are both required for a COFF check")
        if not args.map.is_file():
            fail(f"missing linker map: {args.map}")
        check_coff(args.archive, args.binary, args.map, args.machine, symbols)
    else:
        check_elf(args.archive, args.binary, args.nm, symbols)


if __name__ == "__main__":
    main()
