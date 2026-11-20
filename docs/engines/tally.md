---
name: "Tally"
namespace: "@nitro-forge"
subpath: "@nitro-forge/tally"
tier: 2
docs: "generated"
platforms: []
category: "forge"
tokens: []
registryDependencies: []
a11yStatus: "unverified"
---

# Tally

## Purpose

<!-- generated:begin purpose source=packages/tally/package.json,packages/studio-workspace/src/app-manifest.ts -->
Nitro-Forge tally document API. Studio task line (APP_MANIFESTS): "Open a spreadsheet". Not a registry item. Decision 3. The engine needs the Rust binary through @nitro-forge/ignition and ships as a GitHub release tarball at 0.0.0. A source copy cannot carry the binary.
<!-- generated:end purpose -->

## Install

<!-- generated:begin install source=packages/tally/package.json,compatibility.v1.json -->
- Package: `@nitro-forge/tally`
- Import: `import {} from '@nitro-forge/tally';`
- Peers: none
- Requires: `@nitro-forge/ignition` (native host, install-order.md step 1)
- Command: not available. No tag, release or tarball exists (compatibility.v1.json distribution status NOT RUN), and the package is 0.1.0 inside a monorepo. Install by `workspace:*` inside this repo.
- Installs: none
- Files: `packages/tally` in the repo; nothing is copied by shadcn
<!-- generated:end install -->

## Props

<!-- generated:begin props source=packages/tally/package.json,packages/tally/src/index.ts -->
Not a component, so there are no props. 4 entry points: `@nitro-forge/tally`, `@nitro-forge/tally/grid-adapter`, `@nitro-forge/tally/grid-cluster`, `@nitro-forge/tally/transfer`. Top-level exports of `src/index.ts` (51): `OPS`, `CellValue`, `CellError`, `CellInfo`, `BorderSide`, `BorderStyle`, `CellBorder`, `CellFormat`, `CellFormatPatch`, `FormatTarget`, `SheetTabTone`, `WorkbookInfo`, `NamedRangeInfo`, `ValidationCriteria`, `ValidationRuleInfo`, `CellValidation`, `FunctionInfo`, `ConditionalFormat`, `ConditionalRuleInput`, `ConditionalRuleInfo`, `ConditionalMatch`, `SortKey`, `FilterRuleInfo`, `FilterRowVisibility`, `FilterRowMatch`, `ChartKind`, `ChartSeriesInput`, `ChartInput`, `ChartInfo`, `ChartPatch`, `SparklineKind`, `SparklineInfo`, `SparklineTarget`, `SheetViewFilter`, `SheetViewInfo`, `CommentInfo`, `CommentAnchor`, `PivotAgg`, `PivotValueInput`, `PivotFilterInput`, and more.
<!-- generated:end props -->

## Variants

<!-- generated:begin variants source=packages/tally/package.json -->
none
<!-- generated:end variants -->

## States

<!-- generated:begin states source=packages/tally/package.json -->
_Not documented._
<!-- generated:end states -->

## A11y

<!-- generated:begin a11y source=packages/tally/package.json -->
_Not documented._
<!-- generated:end a11y -->

## Example

<!-- generated:begin example source=packages/tally/package.json -->
_Not documented._
<!-- generated:end example -->

## Do/Don't

<!-- generated:begin dont source=registry-excluded.json -->
### Do

- Read `docs/ENGINE_OPS.md` for the op names and payloads of `tally` before calling `apply`.
- Treat `@nitro-forge/tally` as a monorepo dependency until a tarball release exists.

### Don't

- Do not run `shadcn add` for this package; it has no registry item (@nitro-forge/tally needs the Rust binary).
- Do not claim an npm install; `compatibility.v1.json` records npm as not used.
<!-- generated:end dont -->
