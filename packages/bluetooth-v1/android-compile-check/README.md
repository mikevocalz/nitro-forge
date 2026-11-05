Kotlin compile check for `@nitro-forge/bluetooth-v1`, used by CI.

This repo has no React Native host app for this package yet, so this Gradle
build compiles the package's Kotlin, the nitrogen-generated spec and the real
`react-native-nitro-modules` Kotlin runtime against `react-android` and the
Android SDK. It does not run CMake or link the C++ adapter; that needs a host
app build.

`nitro/stub/NativeNitroModulesSpec.kt` stands in for the React Native codegen
class that a host app normally generates for NitroModules.

Run after `pnpm install` and `pnpm --filter @nitro-forge/bluetooth-v1 codegen`:

    gradle -p packages/bluetooth-v1/android-compile-check :bt:compileDebugKotlin
