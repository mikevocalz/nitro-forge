import { startCollaborationServer } from "../../src/index";
const service = await startCollaborationServer({ databasePath: process.argv[2]!,
  authorize: (_request, id) => id === "shared:cadence" });
console.log(JSON.stringify({ url: service.url }));
process.on("SIGTERM", () => { void service.close().then(() => process.exit(0)); });
