# Real Kotlin source contract gate

This intentionally small standalone Kotlin/JVM Gradle project compiles the
**actual** Kotlin files under packages/board/android; no reimplemented mocks or
algorithm copies. It runs original JUnit tests for geometry, deterministic
seeded randomness and revision atomicity. Android SDK, Nitro HybridObject,
Viro renderer, Android Surface and physical headset integration are not
represented by this check.

Run:
  cd tooling/board-kotlin-core
  gradle test --no-daemon

Requires Java 17+, Gradle 9.5 and Maven Central for Kotlin plugin/JUnit.
A passing test is proof of these *pure Kotlin* algorithms only. It is NOT
proof of Android assembleDebug / CMake / Kotlin Nitro-generated classes or
device ink latency. Those remain independent board PR #18 merge gates.

Skill references:
- Margelo Kotlin: https://github.com/margelo/react-native-skills/blob/1e9e17be6f41c838db472d6a4b943fc26355a3be/skills/kotlin/SKILL.md
- No AI Slop: https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md
