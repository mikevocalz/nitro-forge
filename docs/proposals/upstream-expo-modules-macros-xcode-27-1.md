# Draft upstream issue: expo/expo-modules-macros

Status: DRAFT. Not filed. The owner files it, after checking the reproduction against a fresh Xcode 27.1.
Date: 2026-11-13

Title: `ExpoModulesMacrosCore` builds for the iOS Simulator on Xcode 27.1 and cannot resolve the macOS-only swift-syntax prebuilt

## Summary

With expo-modules-macros 0.33.0 on Xcode 27.1 (27A9269), an iOS Simulator build fails in `ExpoModulesMacrosCore` with `Unable to resolve module dependency: 'SwiftSyntax'`. `-IDEPackageEnablePrebuilts=NO` makes the build succeed. Versions 0.34.0 and 0.35.0 have the same `Package.swift`; their builds were not reproduced.

## Environment

- Xcode 27.1 (27A9269), macOS 27.0 host
- expo 58.0.24, expo-modules-core 58.1.0, expo-modules-macros 0.33.0
- Destination: `generic/platform=iOS Simulator`, iOS deployment target 15.0

## Reproduction

1. Create a one-target Swift package that depends on the `ExpoModulesMacrosPlugin` product from the 0.33.0 tarball.
2. Run `xcodebuild -scheme <target> -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`.
3. The build fails with five errors, one each for `SwiftSyntax`, `SwiftDiagnostics`, `SwiftSyntaxMacros`, `SwiftSyntaxBuilder` and `SwiftCompilerPluginMessageHandling`, in target `ExpoModulesMacrosCore`. Each follows a note that the `swiftlang-6.4.0.34.1-macosx27.0-MacroSupport` swiftmodule is "incompatible with this Swift compiler: built for incompatible target".
4. Repeat with `-IDEPackageEnablePrebuilts=NO`. The build succeeds.

## Cause (our reading)

#144 moved the `ExpoModulesMacrosPlugin` product onto a plain target that depends on the macro target. Xcode 27.1 now builds `ExpoModulesMacrosCore` for the iOS Simulator as well as the host. SwiftPM's swift-syntax prebuilt has macOS slices only, so the simulator build has nothing to link. We did not confirm this against Xcode's build logs beyond the error text above.

## Expected

`ExpoModulesMacrosCore` is built for the host only, as before #144, so the macOS-only prebuilt is enough and consumers need no flag.

## Impact

Reproduced on Expo 58.0.24 with Xcode 27.1; expected on later Expo versions that retain the same macro-package target structure. Later Expo versions were not reproduced. We worked around the CI build with `-IDEPackageEnablePrebuilts=NO`. We have not tried `npx expo run:ios` or EAS Build.

## Evidence

Failing CI run: https://github.com/mikevocalz/nitro-forge/actions/runs/43156219593
