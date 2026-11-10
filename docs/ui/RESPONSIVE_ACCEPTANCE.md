# Responsive & adaptive acceptance sheet: native + web + foldables + XR

**Source:** [Moyo pinned foldable skill](https://github.com/mikevocalz/universal-spatial-starter/blob/256a97b132803fd2fb8049f7a120cef9cb641f41/.agents/skills/mikevocalz-foldable-layouts/SKILL.md), plus NitroForge's responsive editor requirements. The cases below are *not test results*. Every implementation PR fills observed result, platform, screenshot/log, commit SHA and reviewer.

## Core layout scenarios

| Scenario | Expectation | Platform evidence |
| --- | --- | --- |
| Phone portrait and landscape | Stage first; relevant tools via contextual toolbar/sheet; no hardcoded wide rail | NOT RUN |
| iPad full screen / Stage Manager split resize | Stage and Inspector dynamically fit, Pencil/keyboard/IME safe, document session survives | NOT RUN |
| Android tablet full screen / multiwindow | Same editor operations using Compose native controls and adaptive panes | NOT RUN |
| Surface Duo cover compact with absent active hinge | Stable physical-right *host* rail for Moyo, editor content collapses independently | NOT RUN |
| Surface Duo open book vertical hinge | No tool/selection/drag touch target straddles hinge, both pane boundary and focus correct | NOT RUN |
| Surface Duo tabletop horizontal hinge | Stage and tools arranged per editor needs, not a global one-size split | NOT RUN |
| Multiple separating hinges | Every relevant segment processed; no dropped hinge #2 or fabricated geometry | NOT RUN |
| Flat non-separating crease | No fake dead strip; editor can span permitted region | NOT RUN |
| Zero-width separating fold | Boundary respected although occluded area is zero | NOT RUN |
| Off-row hinge and offset host container | Normalize coordinates to pane host, ignore off-row fold | NOT RUN |
| Fold/open and rotate during editing | Same Rust document handle, undo stack, selection and viewport intent | NOT RUN |
| Fold/open during GPU render | Hidden stages pause render work and safely resume without stale textures | NOT RUN |
| Native foldable RTL | Moyo host right rail physically remains on right; logical text/reading order RTL | NOT RUN |
| Web phone width | Web header and small-screen bottom navigation belong to host; editor keeps accessible stage | NOT RUN |
| Web tablet / intermediate viewport | Contextual collapsed panel with keyboard/touch alternative to dragging | NOT RUN |
| Desktop web (resize) | Docked panel groups, Inspector and stage stay within measured usable viewport | NOT RUN |
| Browser SSR/hydration | No DOM access during server evaluation; stable canvas placeholder then supported render | NOT RUN |
| Text scaling / screen readers / reduced motion | Tool/actions remain reachable and labeled; high contrast, no keyboard trap | NOT RUN |
| Pencil / multi-touch / mouse/trackpad | Pressure and hover only when supported, pointer cancellation and no double edit | NOT RUN |
| Background/resume or Android Activity recreation | Rebind listeners; no duplicate sessions, stale fold geometry or stuck canvas | NOT RUN |
| XR scene panel | Actual native window/spatial capability gates, never use 2D dp as XR scene meters | NOT RUN |

### Evidence fields
For each real run provide: device/model/platform release, app revision, view/window dimensions and density, input mode, screenshot or recording link, accessibility inspection, test outcome and reviewer. A test fixture or browser screenshot is not native hardware proof. The acceptance matrix also requires inspecting all 18 scenarios from the pinned Moyo skill where they apply.

### Explicit exclusions
This workstream does not change or mandate Moyo global navigation, redefine user-facing editor features, migrate the Skia 2→v3 renderer, or mark Meta XR spatial windows as equivalent to folding-feature APIs. Those have their own owners and acceptance gates.
