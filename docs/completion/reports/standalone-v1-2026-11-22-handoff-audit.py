"""Read-only paired handoff audit; paths are inputs and never printed."""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--tron-root", required=True, type=pathlib.Path)
parser.add_argument("--forge-root", required=True, type=pathlib.Path)
parser.add_argument("--source-root", required=True, type=pathlib.Path)
args = parser.parse_args()
archive = "docs/completion/reports/2026-11-22-forge-program"
revision = "0e09d3be8263b3dbb2eab1a78e5dd66b83b68e44"
forge_home = "5902e64d6ad01090f5e9a40f8402ec0cbcb39a71"
prefix = "https://github.com/mikevocalz/NYC-Tron-UI/blob/" + revision + "/"


def read(root, path):
    return json.loads((root / path).read_bytes())


def git_bytes(root, path, ref="HEAD"):
    return subprocess.check_output(["git", "-C", str(root), "show", ref + ":" + path])


def unpin(url, base=""):
    assert url.startswith(prefix + base), "Unpinned or mismatched source location"
    return url[len(prefix + base):]


def original_row(row):
    row = json.loads(json.dumps(row))
    row["sourceCandidates"] = [unpin(url) for url in row["sourceCandidates"]]
    row["evidence"] = [unpin(url, "docs/completion/") for url in row["evidence"]]
    if "decision" in row:
        row["decision"] = unpin(row["decision"], "docs/completion/")
    for gate in row.get("platformEvidence", {}).values():
        gate["evidence"] = [unpin(url, "docs/completion/") for url in gate["evidence"]]
    return row


pointer = read(args.tron_root, "docs/completion/library-progress.json")
assert pointer["status"] == "moved" and "components" not in pointer
assert pointer["commit"] == forge_home
assert pointer["url"] == "https://github.com/mikevocalz/nitro-forge/blob/" + forge_home + "/docs/completion/library-progress.json"
metadata = read(args.tron_root, archive + "/ARCHIVE.json")
for path, expected in metadata["sha256"].items():
    actual = (args.tron_root / archive / path).read_bytes()
    assert hashlib.sha256(actual).hexdigest() == expected
    assert actual == git_bytes(args.source_root, path, revision), "Archived source bytes changed"

original = read(args.tron_root, pointer["history"])
adopted = read(args.forge_root, "docs/completion/library-progress.json")
assert (args.forge_root / "docs/completion/library-progress.json").read_bytes() == git_bytes(args.forge_root, "docs/completion/library-progress.json", forge_home)
for key in ["schemaVersion", "scope", "baselineSha256", "requiredPlatforms"]:
    assert original[key] == adopted[key]
for key in ["components", "additions"]:
    assert original[key] == [original_row(row) for row in adopted[key]], "Row fields changed in " + key

completion = read(args.forge_root, "docs/completion/components.json")
assert (args.forge_root / "docs/completion/components.json").read_bytes() == git_bytes(args.forge_root, "docs/completion/components.json")
assert [(row["id"], row["name"]) for row in original["components"]] == [(row["id"], row["name"]) for row in completion["components"]]
assert len({row["id"] for row in original["components"]}) == len(original["components"])
assert len({row["id"] for row in original["additions"]}) == len(original["additions"])
assert (args.tron_root / "docs/completion/baseline-roster.tsv").read_bytes() == (args.forge_root / "docs/completion/baseline-roster.tsv").read_bytes()

fields = collections.Counter()
resolved = {}
for row in original["components"] + original["additions"]:
    refs = [("sourceCandidates", path) for path in row["sourceCandidates"]]
    refs += [("evidence", "docs/completion/" + path) for path in row["evidence"]]
    if "decision" in row:
        refs.append(("decision", "docs/completion/" + row["decision"]))
    for platform, gate in row.get("platformEvidence", {}).items():
        refs += [("platformEvidence." + platform, "docs/completion/" + path) for path in gate["evidence"]]
    for field, path in refs:
        assert re.fullmatch(r"[A-Za-z0-9_@+./-]+", path) and all(part not in ["", ".", ".."] for part in path.split("/"))
        fields[field] += 1
        if path not in resolved:
            source = git_bytes(args.source_root, path, revision)
            assert (args.tron_root / path).read_bytes() == source, "Retained source/evidence bytes changed"
            resolved[path] = hashlib.sha256(source).hexdigest()

gate_file = read(args.forge_root, "docs/release/v1-readiness.json")
prior_gates = json.loads(git_bytes(args.forge_root, "docs/release/v1-readiness.json"))
protected = ["id", "status", "evidence", "commit", "reviewer", "reviewedAt"]
assert [[gate.get(key) for key in protected] for gate in gate_file["gates"]] == [[gate.get(key) for key in protected] for gate in prior_gates["gates"]]
assert (args.forge_root / "tooling/nyc-tron.json").read_bytes() == git_bytes(args.forge_root, "tooling/nyc-tron.json")
assert (args.tron_root / "docs/completion/distribution-review.json").read_bytes() == git_bytes(args.tron_root, "docs/completion/distribution-review.json")

result = {
    "status": "passed",
    "scope": "Paired direct-link, original-byte, full-row and status preservation. No runtime or recursive link acceptance is inferred.",
    "tronSourceRevision": revision,
    "forgeHomeCommit": forge_home,
    "canonicalRowsOut": len(original["components"]),
    "canonicalRowsIn": len(adopted["components"]),
    "additionsOut": len(original["additions"]),
    "additionsIn": len(adopted["additions"]),
    "idNameOrderAndAllRowFieldsEqual": True,
    "acceptance": dict(collections.Counter(row["acceptance"] for row in original["components"] + original["additions"])),
    "forgeCompletion": dict(collections.Counter(row["completion"] for row in completion["components"])),
    "directReferenceCount": sum(fields.values()),
    "uniqueSourcePathsResolved": len(resolved),
    "referencesByField": dict(fields),
    "sourceAndEvidenceBytesEqualPinnedGitTree": True,
    "consumerPinAndGateStatusesAndOwnerReviewUnchanged": True,
    "nestedReportHyperlinksAndRuntimeAcceptance": "NOT RUN",
}
print(json.dumps(result, indent=2))
