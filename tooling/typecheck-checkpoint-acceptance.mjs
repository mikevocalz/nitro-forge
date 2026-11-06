import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "examples/native-cadence");
const root = process.env.NYC_TRON_ROOT;
if (!root) throw new Error("Set NYC_TRON_ROOT to the companion NYC-Tron checkout");
const declaration = resolve(root, "packages/platform-services/dist/checkpoints/index.native.d.ts");
if (!existsSync(declaration)) throw new Error("Build the companion platform-services package first");
const temporary = mkdtempSync(join(tmpdir(), "forge-checkpoint-types-"));
try {
  const config = join(temporary, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    extends: join(app, "tsconfig.json"),
    compilerOptions: {
      typeRoots: [join(app, "node_modules/@types")],
      paths: { "@nyc-tron/platform-services/checkpoints": [declaration] },
    },
    include: [join(app, "CheckpointAcceptance.tsx"), join(app, "verify-checkpoints.ts"),
      join(app, "TransactionsAcceptance.tsx"), join(app, "verify-transactions.ts"),
      join(app, "TelemetryAcceptance.tsx"), join(app, "verify-telemetry.ts")],
  }, null, 2));
  const result = spawnSync(join(app, "node_modules/.bin/tsc"), ["--project", config], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
