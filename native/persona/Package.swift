// swift-tools-version: 5.9
import PackageDescription
// Direct native consumption: no React Native, JSI, Nitro or JavaScript runtime.
let package = Package(
  name: "NitroForgePersonaCore",
  products: [.library(name: "NitroForgePersonaCore", targets: ["NitroForgePersonaCore"])],
  targets: [.target(name: "NitroForgePersonaCore", path: ".",
    exclude: ["nitro", "tests", "README.md", "CMakeLists.txt", "test.sh"],
    sources: ["src/persona.cpp", "src/persona_c.cpp"], publicHeadersPath: "include")],
  cxxLanguageStandard: .cxx17
)
