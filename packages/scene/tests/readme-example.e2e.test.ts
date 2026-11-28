import { expect, it, vi } from "vitest";
import { checkReadmeExample, formatLogged } from "../../../tooling/readme-example.mjs";

// The README example calls createNitroHost(), which needs the native module.
// Here it returns a CliHost instead, so the unmodified example drives the real
// Rust engine through nf-cli (`cargo build --locked -p nf-cli`, or set NF_CLI).
vi.mock("@nitro-forge/ignition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nitro-forge/ignition")>();
  const { CliHost } = await import("../../ignition/src/host-cli");
  return { ...actual, createNitroHost: () => new CliHost() };
});

it("runs the README example against the real engine", async () => {
  const expected = checkReadmeExample(
    new URL("../README.md", import.meta.url),
    new URL("./readme-example.ts", import.meta.url),
  );
  const logged: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(formatLogged(args));
  });
  try {
    await import("./readme-example");
  } finally {
    log.mockRestore();
  }
  expect(logged).toEqual(expected);
});
