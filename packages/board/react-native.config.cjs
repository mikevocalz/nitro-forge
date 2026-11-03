/**
 * The board's Android Kotlin renderer is an OPTIONAL Viro XR CanvasSurfaces
 * backend. A normal React Native Skia v3 phone/tablet app must not require a
 * Viro Android AAR just because it imports @nitro-forge/board/skia/native.
 *
 * React Native autolinks the XR native module only when the host's actual
 * Viro AAR is present. The 2D Skia renderer is independently autolinked by
 * react-native-skia and does not use this Android module.
 */
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

function findViroAar() {
  // Explicit opt-out for isolated 2D build and GPU/device diagnostics.
  if (process.env.NITRO_FORGE_BOARD_VIRO_ANDROID === "off") return null;
  const searchPaths = [process.cwd(), __dirname];
  for (const root of searchPaths) {
    try {
      const manifest = require.resolve("@reactvision/react-viro/package.json", {
        paths: [root],
      });
      const aar = join(dirname(manifest), "android", "react_viro", "react_viro-release.aar");
      if (existsSync(aar)) return aar;
    } catch {
      // Viro is optional. A missing package is not a build error for Skia 2D.
    }
  }
  return null;
}

const viroAar = findViroAar();
// Build-only CI opt-in exercises the JSI/Prefab link without claiming an XR
// renderer exists. Gradle selects src/noViro, whose factory is unavailable.
const compileNativeBackend = process.env.NITRO_FORGE_BOARD_VIRO_ANDROID === "on";
module.exports = {
  dependency: {
    platforms: {
      // A Viro-free app uses Skia's own RN native view, not this XR backend.
      android: viroAar || compileNativeBackend ? {} : null,
      ios: null, // Apple board is Skia v3; no unimplemented Nitro iOS renderer.
    },
  },
};
