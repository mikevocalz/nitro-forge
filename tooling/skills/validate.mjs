/**
 * Repository-owned skills contract smoke gate. Checks the *presence and pinning*
 * of engineering guidance, not whether an AI agent read it or ran native tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(root, path), "utf8");
const agent = read("AGENTS.md");
const registry = read("docs/ENGINEERING_SKILLS.md");
const roster = read("docs/WORKSTREAM_ROSTER.md");
const template = read(".github/PULL_REQUEST_TEMPLATE.md");

const skills = [
  "skia-v3-graphite",
  "native-adaptive-ui",
  "artcraft-intake",
];

for (const skill of skills) {
  const source = read(`.agents/skills/${skill}/SKILL.md`);
  assert.match(source, /^---\nname:\s*\S+\n/m, `${skill} missing skill name`);
  assert.match(source, /^description:\s*.+$/m, `${skill} missing description`);
  assert.match(source, /## (Acceptance|Verification|Mandatory)/,
    `${skill} missing acceptance evidence section`);
}

for (const mention of ["No AI Slop","Expo UI","Margelo","Callstack","Argent",
  "TypeGPU","Meta","foldable","Mobbin","Skia v3","Kotlin","Swift"]) {
  assert.ok(registry.toLowerCase().includes(mention.toLowerCase()),
    `Missing required skill source category: ${mention}`);
}
for (const source of ["petergyang/no-ai-slop","margelo/react-native-skills",
  "expo/skills","callstackincubator/agent-skills","software-mansion/argent"]) {
  const link = registry.match(new RegExp(
    `https://github\\.com/${source.replaceAll("/", "\\/")}/(?:blob|tree)/([a-f0-9]{40})/`, "i",
  ));
  assert.ok(link, `Skill source must be pinned to a commit SHA: ${source}`);
}
for (let i = 0; i <= 14; i++) {
  const tag = "NF-" + String(i).padStart(2, "0");
  assert.ok(roster.includes(tag), `Workstream roster missing ${tag}`);
}
assert.ok(agent.includes("docs/ENGINEERING_SKILLS.md"));
assert.ok(agent.includes("docs/WORKSTREAM_ROSTER.md"));
for (const item of ["Skills actually read", "Workstream roster", "Acceptance matrix",
  "NOT RUN","Breaking change"]) {
  assert.ok(template.includes(item), `PR template missing evidence requirement: ${item}`);
}
console.log("NitroForge required local skills, pinned references, PR template and NF-00..NF-14 roster are present.");
console.log("Documentation integrity only; native/Expo/GPU and agent skill execution remain NOT RUN.");
