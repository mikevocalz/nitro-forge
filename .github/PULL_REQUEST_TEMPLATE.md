## Contract and implementation
- **Change type:** source admission / native bridge / UI / design / release / test / docs.
- **Existing behavior preserved:** commands, runtime exports, session and snapshot format.
- **Changed packages and platform adapters:**
- **Upstream versions and license review:**
- **Related prerequisite PRs:**

## Skills actually read
List exact pinned SKILL.md files from [ENGINEERING_SKILLS](../docs/ENGINEERING_SKILLS.md), plus sections of local skills. Use `NOT READ` when unavailable. Do not paste a skill name and call it an executed check.

| Skill / reference | Read? | Relevant decision |
| --- | --- | --- |
| no-ai-slop | | |
| Expo overview + Expo UI/native module (when applicable) | | |
| Margelo Nitro/Swift/Kotlin/C++ (when applicable) | | |
| Callstack / Argent + Moyo foldable (when applicable) | | |
| Skia v3 / TypeGPU / Dawn (when applicable) | | |
| Impeccable + Mobbin (UI work) | | |

## Workstream roster
| ID / role | Owner or unassigned | Deliverable | Evidence URL | Status |
| --- | --- | --- | --- | --- |
| | | | | NOT RUN |

## Acceptance matrix
- [ ] Existing `cargo test --workspace` and `pnpm -r test`, or explicit reason not applicable
- [ ] `pnpm -r typecheck` and frozen lockfile install (when dependencies change)
- [ ] Native codegen/build (iOS / Android, when native changes)
- [ ] Browser WASM and web screenshot/interaction (when web changes)
- [ ] Skia v3 Graphite/WebGPU Dawn, CPU parity and real device evidence (when graphics change)
- [ ] iPad/foldable/RTL/keyboard/IME/voiceover, measured responsive layout (when UI changes)
- [ ] Security: malformed input, memory lifetime, permissions, cancel/undo/restore where relevant
- [ ] Breaking change, semver and rollback strategy documented
- [ ] No AI slop pass on PR text/README; claims grounded in actual command output

## Evidence, blockers and disposition
Record commands, relevant SHA, build links and actual pass/fail/not-run. Separate source checks from simulator, browser and physical device. Mark draft while a blocking gate remains.
