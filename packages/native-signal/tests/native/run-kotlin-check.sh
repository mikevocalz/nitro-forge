#!/usr/bin/env bash
# 1. Compiles the shipped Kotlin modules (native-signal, agpl-speed-curve) with
#    kotlinc against expo-modules-v2-react, android.jar and coroutines. The v2
#    compiler plugin is not applied, so this checks types and syntax, not the
#    generated JS bindings.
# 2. Runs the WavPeaks object from ForgeSignalModule.kt on the JVM with the
#    sandbox check appended.
# Inputs: ANDROID_JAR (path to an android.jar). Downloads are SHA-256 pinned.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
pkg="$here/../.."
repo="$pkg/../.."
: "${ANDROID_JAR:?set ANDROID_JAR to an SDK platform android.jar}"
work="${NATIVE_CHECK_CACHE:-$(mktemp -d)}"
mkdir -p "$work"

fetch() { # url sha256 dest
  if [ ! -f "$3" ]; then curl -fsSL "$1" -o "$3"; fi
  echo "$2  $3" | shasum -a 256 -c -
}
fetch https://github.com/JetBrains/kotlin/releases/download/v2.2.10/kotlin-compiler-2.2.10.zip \
  302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc "$work/kotlinc.zip"
fetch https://repo1.maven.org/maven2/io/github/expo/expo-modules-v2-react/0.2.7/expo-modules-v2-react-0.2.7.aar \
  ae8f26bbc6b6168a3caa3a36752cd3b500247fbc02a28cea283f641bf7062ea0 "$work/v2.aar"
fetch https://repo1.maven.org/maven2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.10.2/kotlinx-coroutines-core-jvm-1.10.2.jar \
  5ca175b38df331fd64155b35cd8cae1251fa9ee369709b36d42e0a288ccce3fd "$work/coroutines.jar"
[ -d "$work/kotlinc" ] || unzip -q "$work/kotlinc.zip" -d "$work"
unzip -o -q "$work/v2.aar" classes.jar -d "$work/v2"
kotlinc="$work/kotlinc/bin/kotlinc"
stdlib="$work/kotlinc/lib/kotlin-stdlib.jar"

rm -rf "$work/out-modules" "$work/out-check"
"$kotlinc" -no-reflect \
  -cp "$work/v2/classes.jar:$ANDROID_JAR:$work/coroutines.jar" \
  -d "$work/out-modules" \
  "$pkg/android/src/main/java/com/nitroforge/signal/ForgeSignalModule.kt" \
  "$repo/packages/agpl-speed-curve/android/src/main/java/com/nitroforge/capcurve/ForgeCapCurveModule.kt"

{
  printf 'import java.io.File\nimport java.net.URI\nimport java.nio.ByteBuffer\nimport java.nio.ByteOrder\nimport java.nio.file.Files\n'
  awk '/^private object WavPeaks/{p=1} p' "$pkg/android/src/main/java/com/nitroforge/signal/ForgeSignalModule.kt"
  cat "$here/SandboxCheck.kt"
} > "$work/SandboxCheckMain.kt"
grep -q "fun sandboxLocal" "$work/SandboxCheckMain.kt"
"$kotlinc" -no-reflect -d "$work/out-check" "$work/SandboxCheckMain.kt"
java -cp "$work/out-check:$stdlib" SandboxCheckMainKt
