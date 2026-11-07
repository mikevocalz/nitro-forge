// Loopback-only acceptance service. Its policy permits generated fixture IDs,
// not application documents; production hosts supply their own identity/ACL policy.
import { startCollaborationServer } from "../packages/collaboration-server/src/index";
const databasePath = process.argv[2];
if (!databasePath) throw new Error("Pass an acceptance-only SQLite database path");
const service = await startCollaborationServer({ databasePath, port: 4187,
  authorize: (_request, id) => /^native:(ios|android):\d+$/.test(id) });
console.log(`Acceptance collaboration service: ${service.url}`);
process.on("SIGTERM", () => { void service.close().then(() => process.exit(0)); });
