# shadcn CLI 4.23.0 non-web registry spike

Verdict: GO. No workaround needed for resolving/installing; two small constraints below.

Docs read: ui.shadcn.com/docs/registry/namespace, /registry-item-json, /registry/mcp, /docs/mcp (registry, registry.json schema pages and changelog not fetched separately; behaviour verified empirically).

Setup: spike/reg (registry.json + src/{Card.tsx,styles.ts,tokens.ts}); `npx shadcn build registry.json -o r`; served by `python3 -m http.server 4873` in spike/reg. App: spike/app (package.json, tsconfig paths, components.json). Card.tsx is tron's packages/ui Card (react-native View).

Subcommands (--help): init|create, apply, add, diff(deprecated), docs, view, search|list (same command), migrate, eject, info, build, mcp (only `mcp init --client claude|cursor|vscode|codex|opencode`), preset, registry. No `--skip-install` flag on add.

components.json minimum (schema-validated): `style` AND `tailwind.baseColor` AND `tailwind.css` (string, file need not exist for add of plain files) AND `aliases`. `rsc`, `tsx`, `iconLibrary`, `tailwind.config` NOT required. Missing style/baseColor/css => "Invalid configuration".
{ "style":"new-york", "tailwind":{"baseColor":"neutral","css":"global.css"}, "aliases":{components,ui,lib,utils,hooks}, "registries":{"@nyc-tron":"http://localhost:4873/r/{name}.json"} }

Results (all exit 0):
- `shadcn info`: framework "Manual", no tailwind detected; no refusal.
- `shadcn search @nyc-tron` / `list @nyc-tron --json`: 3 items with types lib/file/ui.
- `shadcn view @nyc-tron/card`: prints JSON with content.
- `shadcn add @nyc-tron/card --dry-run`: resolves registryDependencies recursively, lists 3 files + dep react-native.
- `shadcn add @nyc-tron/card -y`: wrote src/lib/tron/styles.ts, src/theme/tron-tokens.ts, src/components/ui/card.tsx (src/ prefix used because src/ existed). Import `@/lib/tron/styles` preserved.
- Direct URL add also works.
- Framework detection is not a gate. registry:file with `~/...` target and registry:lib/ui with `@lib/` `@components/` targets all work. Even without target, ui/lib land via aliases.

Dependencies / install: if a dep is absent in package.json the CLI runs `npm install --no-audit --no-fund -- <dep>` (verified via PATH shim; package manager from lockfile). Avoid heavy install by (a) pre-declaring dep in package.json (CLI skips; used here), or (b) PATH shim. Real apps already have react-native so this is a non-issue.

cssVars/css: with items that carry cssVars, CLI patches tailwind.css file (`global.css`), and ENOENT-fails if the file does not exist. It emits `@layer base { :root { --brand: red } }`. Tailwind v4 web syntax; not useful for NativeWind unless global.css exists and you want it. For RN, omit cssVars/css and ship tokens as registry:lib/registry:file TS (verified: tron-tokens.ts). Cost: no automatic theme CSS merge; tokens live in TS.

MCP: `npx shadcn mcp` starts over stdio; initialize returns serverInfo shadcn 1.0.0; tools/list: get_project_registries, list_items_in_registries, search_items_in_registries, view_items_in_registries, get_item_examples_from_registries, get_add_command_for_items, get_audit_checklist. `mcp init --client claude` writes .mcp.json: {"mcpServers":{"shadcn":{"command":"npx","args":["shadcn@latest","mcp"]}}} then tries to `npm install -D shadcn@latest` (failed only because my fake package.json had react-native@1). Docs: registry must expose /r/registry.json for MCP search/list (build emits it).

Minimal RN item (built output shape):
{ "$schema":"https://ui.shadcn.com/schema/registry-item.json","name":"card","type":"registry:ui","title":"Card","description":"...",
  "dependencies":["react-native"],"registryDependencies":["@nyc-tron/tron-styles","@nyc-tron/tron-tokens"],
  "files":[{"path":"src/Card.tsx","type":"registry:ui","target":"@components/ui/card.tsx","content":"..."}] }
Source registry.json items use `files[].path` (no content); `shadcn build` inlines content. `build` takes registry path relative to cwd (-c breaks it).

Gotchas: use `</dev/null` in non-interactive runs; `@/lib` aliases only rewritten for known aliases, so author imports against the app's alias.
Cleanup: http server killed; npm cache cleaned (free 4.6 -> 4.8 GiB). Spike dir left in place.
