# F6 iOS picker correction: measured centering overhead and preserved timeout

Source head 722a2fef3746c96817388aa3380f83619325d710; executed merge 6d8b13fc90396683b251cc6d929d6d6a06d51515. [Run 43598783276](https://github.com/mikevocalz/nitro-forge/actions/runs/43598783276), attempt 1. Source job 132458865945 passed actual 65/65 Node tests, zero failures/skips. Both producers, license/archive assembly, external bundle, ordinary prebuild and Release compilations passed. This is not a full F6 pass.

## Actual iOS failure

Job 132461833658 FAILED. Runtime ZIP 14117400679 is 25,016,217 bytes, SHA256 9c3160a2583ca6940ce2de14ee95d0b0502e170258e7fdcff165fa81fd3b83c7, fully streamed and verified before bounded member reads. Compile ZIP 14117450426 is 30,118,649 bytes, metadata SHA256 3e5c89ca0e57e24eccd4bb09eecc789e220bd2988b04588da0659370edb9732a; not independently downloaded.

The picker passed and every studio's exact selected/closed assertion passed. The native log completed 770 commands with no semantic assertion failure before the unchanged 1,200,000ms process deadline interrupted Quill's redo-result capture. Its command receipt records 1,206,494ms elapsed, status143, ETIMEDOUT. The full first flow did not complete, there is no completed pass-1 JUnit report, OS document extraction and pass 2 did not run, and no full native acceptance is inferred from these partial callbacks or images.

Thirteen completed picker centering operations consumed 210,572ms. Each made six geometry attempts and ended at y106, including ten that already started there. In three cases it restored a picker from y10 or -5 to y106, avoiding the earlier status-area tap; repeatedly trying to center at the scroll boundary then spent the full-pass budget. The regression fixture contains an original unchanged-y106 block and the whole native log is retained here. Source/driver/run identities and original failure screenshot/hierarchy are preserved unchanged.

The proposed protocol restores and asserts the actual app heading before the original noncentering picker-group scroll, option tap and exact studio/closed assertion. It keeps every engine action, capture/result guard, second pass and the 20-minute deadline. It adds two bounded ordinary UI commands before each selection and removes the repeated picker-centering request; result capture centering remains intact. This is a measured source correction requiring fresh native execution, not a timeout waiver or passing receipt. Five targeted pure VM cases passed, with negative controls rejecting both the old missing-heading protocol and restored centering loops. Local Node:test/native builds were NOT RUN under the disk hold; fresh CI remains required.

## Separate Android result

Android job 132461833625 PASSED both full seven-studio OS-touch flows at 320px using the same candidate. Runtime artifact 14117147917 is 6,432,624 bytes, metadata SHA256 b880b179b45399ba8fa0e45453e379fedb1d49efdc2d6af7fff41365b174ec44. Its raw job result/log and artifact metadata were retained before this follow-up; this packet does not claim an independent decode of that Android ZIP yet. Earlier source-bound Android byte audits remain separate.

Shared candidate 14116415229 is 147,259,336 bytes, SHA256 823655102b8e2462f68c28bbc39f46ee20c5a25ef77883301b9cba8d675c6d5c, fully author-verified in memory. Candidate version 1.0.0-f6.43598783276.1 contains eight archives, explicit five adapter deferrals and publicationAuthorized:false. Author independently decoded seven small adapter TGZs and matched actual LICENSE, recorded notice and archive hashes; Ignition's large TGZ was not separately decoded locally. Actual strict CI packed/native provenance checks passed; full independent license/source/runtime/visual review and final F1 graph reconciliation remain pending.

No product/native/API/dependency/config/window/orientation or gate/schema/validator change. No extra same-source rerun. F6 stays incomplete/draft; no readiness, merge, tag or publication. Local writes/builds/installs remain held below the owner's 10,000,000,000-byte floor; only bounded memory checks and leased remote Git objects were used.
