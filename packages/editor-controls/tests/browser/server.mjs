import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {readdirSync,readFileSync,realpathSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {dirname,relative,resolve} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const here=dirname(fileURLToPath(import.meta.url));
// packages/editor-controls: the moved sources, its examples, and its installed
// @nyc-tron/ui (the pinned release tarball with Forge's pnpm patch applied).
const pkg=resolve(here,"../..");
const pkgRequire=createRequire(resolve(pkg,"package.json"));
// Tron primitives ship as compiled dist JS; Tailwind has to see their class
// names too. node_modules/@nyc-tron/ui is a pnpm symlink, so hand Tailwind the
// real directory through a generated input that @imports theme.css.
// "@nyc-tron/ui" itself resolves to dist/index.js (package.json is not exported).
const tronDist=dirname(realpathSync(pkgRequire.resolve("@nyc-tron/ui")));
const cssInput=resolve(here,".theme.generated.css");
writeFileSync(cssInput,'@import "./theme.css";\n@source "'+relative(here,tronDist).split("\\").join("/")+'";\n');
const css=execFileSync(resolve(here,"node_modules/.bin/tailwindcss"),["-i",cssInput],{cwd:here,encoding:"utf8"});
// One bundle per fixture: fixture.tsx at "/" and each fixtures/<name>.tsx at "/<name>".
const fixtures=[["",resolve(here,"fixture.tsx")],
  ...readdirSync(resolve(here,"fixtures")).filter(f=>f.endsWith(".tsx")).map(f=>[f.slice(0,-4),resolve(here,"fixtures",f)])];
const bundleOf=entry=>build({
  // CanvasKit's browser branch never invokes its optional Node filesystem imports.
  external:['fs','path'],
  plugins:[{name:"package-exports",setup(builder){
    builder.onResolve({filter:/^react-native\/(?:asset-registry|Libraries\/Image\/AssetRegistry)$/},args=>({path:args.path,external:true}));
    // @nyc-tron/ui resolves through its (patched) exports map to the release's
    // dist files, the same module instances the moved controls import.
    // @nitro-forge/editor-controls is this package (the examples import it by
    // name) and resolves through its own exports map to src.
    builder.onResolve({filter:/^@(?:nyc-tron\/ui|nitro-forge\/editor-controls)(?:\/|$)/},args=>({path:pkgRequire.resolve(args.path)}));
  }}],entryPoints:[entry],bundle:true,write:false,
  format:"iife",jsx:"automatic",platform:"browser",
  // Match web-aware consumers when a package ships platform file siblings.
  resolveExtensions:[".web.tsx",".web.ts",".web.jsx",".web.js",".tsx",".ts",".jsx",".js",".json"],
  // Pin one React and one zustand: the sources and the installed @nyc-tron/ui
  // would otherwise each find their own copy in the pnpm store.
  alias:{"react-native":resolve(here,"rn-shim.tsx"),
    "react-native-gesture-handler":resolve(pkg,"node_modules/react-native-gesture-handler"),
    "react-native-skia":resolve(pkg,"node_modules/react-native-skia"),
    react:resolve(here,"node_modules/react"),"react-dom":resolve(here,"node_modules/react-dom"),
    zustand:resolve(here,"node_modules/zustand"),
    // Uniwind's web ScopedTheme, reproduced (see uniwind-shim.tsx).
    uniwind:resolve(here,"uniwind-shim.tsx"),
    // NativeSeekBar renders @expo/ui's universal web build (plain RN Views).
    "@expo/ui":resolve(here,"node_modules/@expo/ui/build/universal/index.js")},
  nodePaths:[resolve(here,"node_modules")],
  define:{global:"globalThis","process.env.NODE_ENV":'"development"',__DEV__:"true"}});
const entries=new Map(fixtures),bundles=new Map();
// A targeted run should compile its own fixtures, not every unrelated native/GPU example.
const bundleFor=name=>{
  if(!bundles.has(name))bundles.set(name,bundleOf(entries.get(name)).then(result=>result.outputFiles[0].contents).catch(error=>{bundles.delete(name);throw error;}));
  return bundles.get(name);
};
// Only the test document bootstrap is HTML. The rendered UI is React Native components.
const doc=script=>'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editor controls acceptance</title><link rel="stylesheet" href="/theme.css"></head><body><div id="root" style="min-height:100vh;display:flex"></div><script src="'+script+'"></script></body></html>';
createServer(async(req,res)=>{
 try{
  const path=(req.url??"/").split("?")[0];
  const name=path.slice(1);
  if(path==="/skia/canvaskit.wasm"){res.writeHead(200,{"Content-Type":"application/wasm"});res.end(readFileSync(createRequire(pkgRequire.resolve("react-native-skia/package.json")).resolve("canvaskit-wasm/bin/full/canvaskit.wasm")));}
  else if(path==="/bundle.js"){const script=await bundleFor("");res.writeHead(200,{"Content-Type":"text/javascript"});res.end(script);}
  else if(name.endsWith(".js")&&entries.has(name.slice(0,-3))){const script=await bundleFor(name.slice(0,-3));res.writeHead(200,{"Content-Type":"text/javascript"});res.end(script);}
  else if(path==="/theme.css"){res.writeHead(200,{"Content-Type":"text/css"});res.end(css);}
  else if(entries.has(name)){res.writeHead(200,{"Content-Type":"text/html"});res.end(doc(name?"/"+name+".js":"/bundle.js"));}
  else{res.writeHead(404);res.end();}
 }catch(error){console.error(error);if(!res.headersSent)res.writeHead(500,{"Content-Type":"text/plain"});res.end("Fixture could not be built");}
}).listen(Number(process.env.UI_ACCEPTANCE_PORT??4189),"127.0.0.1");
