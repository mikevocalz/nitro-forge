# Forge PR #81 real-engine browser verification

PR head: `c0b000aef9b91bd5d5cae6317a20fbd87caffe8f`. CI tested merge and local Rust source: `0c8ba55452fb7dd952d6c933dd56071862f350c3`. Studio CI run `43518003107`, artifact `14080689711`, ZIP SHA256 `ff34af5794a32398eb6547645c49f8ebf62d05aa6b24cbc9f957c4229a4bf3a7`. All eight retained dist files verified by size/hash with no extras. No frontend rebuild.

Actual nf-cli binary SHA256: `91aebc9b3168866fbb65e3e6701fa93163776b7e2a55a14f91079761df72a2dc`. Actual source engineBridge/CliHost serve loopback port 4193; see qa-host-provenance.json. Original bridge verifier ran successfully across all twelve engine kinds at this source. Browser: isolated Chrome 157 through Argent CDP 9222; images are original full-size captures, no edits. UI actions used normal controls; no application/store injection.

## Tally
- Created A1=5, A2=7, A3=SUM(A1:A2)=12 using the existing command.
- Selected A1:A3 through the name box. Pivot empty state captured.
- Used selection as pivot source, assigned Column A to filters and values (sum), refreshed.
- All filter explicitly admits every record. C1=sum:0 and C2=24, five populated cells. Combined information/output screenshot retained.
- Undo removed C1/C2 while retaining the pivot definition and the three source cells; Redo restored 24.

## Cadence
- Imported the eight-second accented .nfd fixture through the normal Open picker (native chooser via CUA). Input was generated earlier at 530af1f; it is an older input document, not a build of this candidate. SHA256 `ad26db774220238eb60d21d105990858f6b351d9ad59227f788c000762df1400`.
- Analysis > Beat markers: sensitivity 0 found 15 onsets, added 15 in one undo step; total 16 with existing seed. Undo restored one seed; Redo restored 16.
- Sensitivity 1 found 31 onsets, added 16 new markers in one step; total 32. Undo restored 16; second Undo restored the seed alone.
- Selected seed, renamed through Marker name input to Reviewed seed and blurred. Observed browser network updateMarker request changed name only. Subsequent listMarkers returned ticks=943, same note and length_ticks=0. Exact observed request/response JSON retained, with initiator stack omitted for size.
- Remove marker reached the explicit empty-marker state.

## Limits
Browser + real Rust engine proof only. Native audio playback, native/mobile desktop acceptance, cancellation timing and loading/error visual states were not manually exercised here. Source/unit and CI claims remain separate. No F4/F7/F8 platform gate is implied. Independent R2 signed the exact head for the scoped F3 merge, conditional on all required exact-head CI finishing green. R2 independently verified all eleven images, network tick preservation, artifact/source/binary binding, and reran the original bridge verifier successfully across all twelve engine kinds. This does not promote broader platform acceptance.


Final merge outcome: all fourteen current-head workflows completed success, including native iOS and Android consumer builds. Root merged with expected-head guard to `a58994d4802de2db9067ae3cbe824912c4a50b9c`. Original proof remains tied to tested merge0c8ba55/headc0b, not relabeled as a fresh execution at the final merge.


Post-verification environment note: the owned QA host was stopped to clean its rebuildable Rust cache when local free space fell below the floor. The exact binary was retained unchanged at work/qa-host/retained-binary/nf-cli; relocated build-path metadata is work/qa-host/retained-binary/nf-cli-build.json. Original source/build/proof provenance is preserved; no fresh execution is implied.
