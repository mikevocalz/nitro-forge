# Persona isolated generator correction

The first #89 head `de1e36bd5ed425aa1c42203dfeaaf26fbd9733d0` failed actual
F1 graph CI run43542728201 / job132286752649 at Persona generation: TS2307,
`nitro-core` unresolved in both Persona specs. That failure is preserved rather
than called a full-suite pass. Artifact14092808562 (54,256bytes), GitHub ZIP
SHA25646b9cebfaf68f09a59e4f57a5b5ddf4df611e604a3dff770729533382fcf71a8,
retains21 command records. Original full log/provenance is retained in the
parent review outputs; selected actual failure lines are copied beside this
receipt. This receipt does not transfer any successful earlier step to the fix.

Root `pnpm-workspace.yaml` includes packages/* and apps/*, not native/persona.
Persona already declared exact nightly136 `nitro-core` as its runtime peer and
`nitrogen` as a dev dependency, but had no independently frozen install graph.
Running the root-installed generator in that directory did not make its direct
imports resolvable. The correction adds an explicit isolated workspace,
packageManager12.18 and exact nightly136 dev type dependency beside the unchanged
runtime peer, plus a real own lockfile. CI installs that graph frozen and invokes
its own codegen script. No global hoist, stub, ignored diagnostic or generation
bypass was introduced.

Actual bounded local `install --lockfile-only --ignore-scripts` returned0 with
200MB headroom guard; final free10,277,957,632bytes remained above the10GB floor.
There was no node_modules install or local generation/build. The new lock has
both a15-entry bootstrap document and a28-package active generator graph, parsed
with Ruby/Psych; the importer directly locks nitro-core and nitrogen to the same
136 build. Existing root/native-cadence locks are unchanged by this correction.
All32 manifests and all three workspace files are now inventoried;283 declarations,
zero unclassified items, including the new isolated lock's input hash.

29 source tests and actionlint pass. Actual corrected-head frozen install and
successful Persona regeneration remain CI prerequisites. Native trial remains
stacked separately; F1 is not passed, and public/native runtime/window contracts,
other gate objects, validators and the seven audit ignores remain unchanged.
