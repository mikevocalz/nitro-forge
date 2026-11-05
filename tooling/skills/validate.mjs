/**
 * Repository-owned skills contract gate.
 *
 * What it proves:
 *   - every github.com link in docs/ENGINEERING_SKILLS.md is pinned to a
 *     40-hex commit SHA (blob/ or tree/). No link is exempt; Mobbin and local
 *     relative links are not github.com links and are not checked.
 *   - with --resolve (CI), each pinned SHA exists in its repository and the
 *     linked path exists at that SHA (GitHub REST API).
 *   - the local SKILL.md files have frontmatter and an evidence section; the
 *     roster lists NF-00..NF-14; the PR template carries the evidence headings.
 *
 * What it does NOT prove: the category keyword checks only show a word appears
 * in the registry text. Nothing here shows that an agent read a skill, that a
 * linked skill fits its row, or that any native/Expo/GPU work ran.
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

for (const mention of ["no-ai-slop","expo-ui","Margelo","Callstack","Argent",
  "TypeGPU","Meta","foldable","Mobbin","Skia v3","Kotlin","Swift"]) {
  assert.ok(registry.toLowerCase().includes(mention.toLowerCase()),
    `Missing required skill source category: ${mention}`);
}
// Every github.com link in the registry must be SHA-pinned.
const PINNED = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([0-9a-f]{40})(?:\/([^)#?\s]*))?$/;
const links = [...registry.matchAll(/https:\/\/github\.com\/[^)\s]+/g)].map((m) => m[0]);
const unpinned = links.filter((url) => !PINNED.test(url));
assert.deepEqual(unpinned, [], `Skill links must be pinned to a 40-hex commit SHA:\n  ${unpinned.join("\n  ")}`);
for (const source of ["petergyang/no-ai-slop","margelo/react-native-skills",
  "expo/skills","callstackincubator/agent-skills","software-mansion/argent"]) {
  assert.ok(links.some((url) => url.toLowerCase().startsWith(`https://github.com/${source.toLowerCase()}/`)),
    `Required skill source missing from registry: ${source}`);
}
if (process.argv.includes("--resolve")) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers = { accept: "application/vnd.github+json", ...(token && { authorization: `Bearer ${token}` }) };
  const api = async (path) => (await fetch(`https://api.github.com/${path}`, { headers })).status;
  const failures = [];
  for (const url of new Set(links)) {
    const [, owner, repo, sha, path = ""] = PINNED.exec(url);
    const commit = await api(`repos/${owner}/${repo}/commits/${sha}`);
    const clean = decodeURIComponent(path.replace(/\/$/, ""));
    const file = commit === 200 && clean ? await api(`repos/${owner}/${repo}/contents/${clean}?ref=${sha}`) : commit;
    if (commit !== 200 || file !== 200) failures.push(`${url} (commit ${commit}, path ${file})`);
  }
  assert.deepEqual(failures, [], `Pinned skill links that do not resolve:\n  ${failures.join("\n  ")}`);
  console.log(`${new Set(links).size} pinned skill links resolve to an existing commit and path.`);
}
// Every repo doc the guidance tells an agent to read must exist. A doc that
// arrives with an open PR is allowed only when its line says which PR, and the
// label must go once the doc lands.
{
  const { existsSync } = await import("node:fs");
  const guidance = { "AGENTS.md": agent, "docs/ENGINEERING_SKILLS.md": registry,
    "docs/WORKSTREAM_ROSTER.md": roster, ".github/PULL_REQUEST_TEMPLATE.md": template,
    ...Object.fromEntries(skills.map((s) => [`.agents/skills/${s}/SKILL.md`, read(`.agents/skills/${s}/SKILL.md`)])) };
  const problems = [];
  for (const [file, text] of Object.entries(guidance)) {
    for (const line of text.split("\n")) {
      for (const [, doc, label] of line.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.md)`( \(lands with PR #\d+\))?/g)) {
        const pending = label !== undefined;
        const exists = existsSync(join(root, doc));
        if (!exists && !pending) problems.push(`${file}: ${doc} does not exist`);
        if (exists && pending) problems.push(`${file}: ${doc} exists; drop its "lands with PR" label`);
      }
    }
  }
  assert.deepEqual(problems, [], `Guidance references broken docs:\n  ${problems.join("\n  ")}`);
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
console.log(`${links.length} registry links are SHA-pinned; local skills, PR template and NF-00..NF-14 roster are present.`);
console.log("Category keywords are text matches only. Agent skill reading and native/Expo/GPU work remain NOT RUN.");
