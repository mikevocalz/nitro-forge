# Corrected candidate execution, before follow-up fixes

Author head a1c14d4335aa521777501c876c74c12b9bb71e55; executed merge 0d326fcd87811ed0c12162cb48469362a6d79dc5 into dab27e177f05a747f2a234e3892f62e2f7b8c28b. Run 43540683497.

Source checks passed 28 Node tests. Apple and Android payload producers succeeded. Archives job 132283506754 failed when the collector tried to open Cargo's absent extracted-cache `.cargo-checksum.json` for adler2 2.0.1. This is a collector cache-layout assumption, separate from the original lipo failure, which the successful Apple producer resolves for these source bytes.

The archive stage did not succeed. Consumer bundle, prebuild, native compile and visible runtime were not reached. Producer success is not archive or F6 acceptance and is not transferable to later source commits. Raw job log and contemporaneous jobs/artifact metadata are preserved here without whitespace normalization.

The follow-up uses the Cargo.lock SHA256-verified `.crate`, rejects unsafe paths/types before fresh extraction, and binds metadata's registry source inventory and every source-file hash to that archive. Only Cargo-generated `.cargo-ok` and `.cargo-checksum.json` are excluded from that comparison. Notice requirements remain fail closed.

Local follow-up check: 30 combined Node tests attempted; 29 passed and the portable prepare regression was blocked by the unchanged 10 GB disk guard at 9,975,623,680 available bytes. The new crate present/absent-bookkeeping, wrong-hash/root and tampered/extra-cache-source cases passed. No local install/native build or guard bypass occurred. Collector/extraction syntax and changed source whitespace checks passed. Fresh CI remains required.
