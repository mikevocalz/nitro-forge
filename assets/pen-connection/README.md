# Pen pairing Rive CLI artboards

The Rive CLI source includes Searching, Pairing, Linked, Connected and Error artboards. Only a trusted native ready event is permitted to play Connected. Bluetooth discovery or an unverified BLE link must not select the success scene.

## Build

Use the official Rive CLI: https://rive.app/docs/cli/getting-started

From the assets folder:

    rive pen-connection --verify
    rive pen-connection

This is source only. Rive CLI, rendering, a signed .riv export and hardware animation playback have NOT been run or verified. The shipping dialog falls back to a native status glyph/spinner until a compiled asset is tested. Publishing signed files requires a Rive account. Prefer the existing Viro Rive runtime over installing an incompatible Nitro v0.x runtime in the Nitro v1 app.
