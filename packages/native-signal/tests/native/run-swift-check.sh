#!/usr/bin/env bash
# Compiles the WavPeaks enum from ios/ForgeSignalModule.swift with the host
# check appended, then runs it. Host Foundation (macOS), not an iOS device.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
pkg="$here/../.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
{
  echo "import Foundation"
  awk '/^private enum WavPeaks/{p=1} p' "$pkg/ios/ForgeSignalModule.swift"
  cat "$here/sandbox-check.swift"
} > "$work/main.swift"
grep -q "static func sandboxLocal" "$work/main.swift"
swiftc "$work/main.swift" -o "$work/check"
"$work/check"
