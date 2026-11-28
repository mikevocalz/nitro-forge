// Runs the radius check and the v1 gate report, then fails if either failed.
// Both always run, so a radius failure never hides the gate report.
//
//   node tooling/validate-v1-all.mjs [--radius-report] [validate-v1 options]
//
// --radius-report runs the radius check in report-only mode (prerelease).
// Every other option is passed to tooling/validate-v1.mjs unchanged.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = name => fileURLToPath(new URL(`./${name}`, import.meta.url));
const args = process.argv.slice(2);
const radiusReport = args.includes("--radius-report");
const rest = args.filter(arg => arg !== "--radius-report");
const run = (script, scriptArgs) => spawnSync(process.execPath, [tool(script), ...scriptArgs], { stdio: "inherit" }).status ?? 1;

const radius = run("check-radius.mjs", radiusReport ? ["--report"] : []);
const gates = run("validate-v1.mjs", rest);
if (radius !== 0) console.error(`validate:v1: radius check failed (exit ${radius})`);
if (gates !== 0) console.error(`validate:v1: gate report failed (exit ${gates})`);
process.exitCode = radius || gates ? 1 : 0;
