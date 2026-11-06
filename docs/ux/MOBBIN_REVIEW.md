# Mobbin and Affinity research ledger (selection, not redistribution)

**Research source:** Mobbin searches on 2026-11-02 focused on design-editor workspaces and native creative tools. Individual links are canonical Mobbin screen URLs. The initial ledger required opening each screen before implementation. The November 3 follow-up inspected all seven exact images; observed details and source boundaries are recorded in [DESIGN_REFERENCE_AUDIT.md](./DESIGN_REFERENCE_AUDIT.md). Do **not** infer exact spacing, color values or proprietary component anatomy from a result's app name alone. Do not embed, redistribute or vendor screenshot assets in NitroForge.

| Reference | Canonical Mobbin screen | Question for hands-on visual review | Proposed NitroForge hypothesis / proof requirement |
| --- | --- | --- | --- |
| Framer web | https://mobbin.com/screens/1edcc2ea-d2e4-41a8-97d3-b8b4feca2735 | How are canvas, assets and inspector separated without excessive chrome? | Validate stage prominence and resizable panel affordances in real screenshot |
| Rive web | https://mobbin.com/screens/0deb9a56-af1f-4697-a912-ff87f5ccd09f | Which animation properties and timeline controls are contextual? | Test bottom dock + Inspector modes for Splice/Cadence/Pitch |
| Canva web | https://mobbin.com/screens/3f507e35-c583-41b5-afc0-c0422e00e068 | Which controls remain approachable for casual creation? | Test discoverable tool labels and progressive disclosure |
| Adobe Express web | https://mobbin.com/screens/64d24cec-61c2-4907-8d75-84fcbc4314ce | How are quick editing tasks separated from expert controls? | Test compact contextual bar, not seven permanent ribbons |
| Jitter web | https://mobbin.com/screens/6c71f040-3f15-43ef-8faf-6e21442f898a | How can a dense animation sequence remain legible? | Test timeline as optional expandable dock |
| Freeform iOS | https://mobbin.com/screens/30867762-fa72-4721-9ad3-d2bae601e48d | How should touch/Pencil access tools without hiding the canvas? | Test native tablet/phone contextual controls |
| Craft iOS | https://mobbin.com/screens/145386bb-3aac-42cb-8d75-501170233bef | How does writing maintain focus and accessible structure? | Test Quill compact layout |

**Official Affinity product research:** 
- https://www.affinity.studio/help/workspace-interface/
- https://www.affinity.studio/help/workspace-about-studios/
- https://www.affinity.studio/help/design-aids-snapping/
- https://www.canva.com/newsroom/news/all-new-affinity/

Affinity's unified Vector/Pixel/Layout studio concepts motivate switchable toolsets over a stable workspace. NitroForge's identities, icons, spacing, dock mechanics and accessibility must be original and better suited to its seven engine APIs. One brand suite does **not** imply one universal file format.

## Review protocol
1. Open each Mobbin link in an authorized design session; inspect actual image and record what is visible (not its inferred behavior).
2. Record observed workflow, number of visible primary actions and panes, contrast, document stage proportions and keyboard/touch affordances when visible.
3. Reproduce **principles** in original NitroForge sketches using shared `@expo/ui` and Tailwind semantic tokens. Do not trace the exact layout, icons, branded color, assets or screenshots.
4. Check the same design concept on phone web, tablet, desktop and a native Expo UI implementation. A web screenshot does not prove native Compose/SwiftUI support.
5. Apply [Impeccable](https://github.com/pbakaus/impeccable/tree/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285), [Expo design system](https://github.com/expo/skills/blob/a9e5bd3fa00b4e61f632e43f85da73aee1942582/plugins/expo/skills/expo-design-system/SKILL.md) and [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/000650b156983f5159695b441477f4e63b25dc85/skills/no-ai-slop/SKILL.md) before approving any PR description or design review.
6. Attach screenshots/notes captured for review where licensing allows; include task, device, viewport size and what changed. **No images from Mobbin are committed here.**

Status: the seven original screen images have now been inspected in Chrome. Additional Craft writing screens were inspected through the Mobbin tool. This is not a claim that every product named in the icon taxonomy was audited. See DESIGN_REFERENCE_AUDIT.md for the actual observations, failed article extraction, applied changes and pending native evidence.
