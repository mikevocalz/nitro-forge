# Xcode 27.1 and expo-modules-macros 0.33.0

Reproduced on Expo 58.0.24 with Xcode 27.1 (27A9269); expected on later Expo versions that retain the same macro-package target structure. Later Expo versions were not reproduced.

## Symptom

The iOS build fails in target `ExpoModulesMacrosCore` with `Unable to resolve module dependency: 'SwiftSyntax'`. The same error appears for `SwiftDiagnostics`, `SwiftSyntaxMacros`, `SwiftSyntaxBuilder` and `SwiftCompilerPluginMessageHandling`, for both `arm64-apple-ios15.0-simulator` and `x86_64-apple-ios15.0-simulator`. Each is followed by a note that the `macosx27.0-MacroSupport` swiftmodule "is incompatible with this Swift compiler: built for incompatible target".

## Cause

Expo 58.0.24 requires expo-modules-core ~58.1.0, which pins expo-modules-macros 0.33.0. In that release the `ExpoModulesMacrosPlugin` product holds a plain target that depends on the macro target (expo/expo-modules-macros#144). Xcode 27.1 then also builds `ExpoModulesMacrosCore` for the iOS Simulator. SwiftPM's swift-syntax prebuilt contains macOS slices only, so the simulator build cannot resolve it. expo-modules-macros 0.34.0 and 0.35.0 have the same `Package.swift`; their builds were not reproduced.

## Workaround

Turn off SwiftPM prebuilts so swift-syntax builds from source for the host and the simulator.

- `xcodebuild`: pass `-IDEPackageEnablePrebuilts=NO`. `.github/workflows/cadence-native-consumer.yml` does this.
- Xcode app: `defaults write com.apple.dt.Xcode IDEPackageEnablePrebuilts -bool NO`, then restart Xcode.

The cost is a longer first build, because swift-syntax compiles from source.

## Consumers outside Forge CI

Forge CI only covers the `xcodebuild` path. `npx expo run:ios` and EAS Build run the same SwiftPM resolution, so they are expected to hit the same failure on Xcode 27.1 unless the flag or default is set. This has not been reproduced on either path: NOT RUN. For EAS, the build image's Xcode version decides whether it applies.

## Removal condition

Remove the flag and this note once an expo-modules-macros release keeps `ExpoModulesMacrosCore` host-only on Xcode 27.1. The draft upstream report is `docs/proposals/upstream-expo-modules-macros-xcode-27-1.md`. It has not been filed.

Debug record with run IDs: `docs/release/RELEASE_TRAIN.md`, "Expo 58.0.24 iOS consumer compile".
