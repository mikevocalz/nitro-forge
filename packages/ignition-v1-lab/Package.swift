// swift-tools-version: 6.4
import PackageDescription

let package = Package(
  name: "NitroForgeV1",
  platforms: [.iOS(.v16)]
)

// True Rust engine archive, not a stub. The archive must be built for the
// target device/simulator before SwiftPM resolves the native package.
package.targets.append(
  .binaryTarget(
    name: "NitroForgeRust",
    path: "native/apple/NitroForgeRust.xcframework"
  )
)

// Nitrogen replaces its generated helper between nitrogen:begin/end.
// Keep this invocation and generated entry points owned by Nitro codegen.
addNitrogenTargets(
  to: package,
  cxxSources: ["cpp"],
  dependencies: ["NitroForgeRust"]
)
