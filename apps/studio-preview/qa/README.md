# Canonical UI browser checks

Start the local preview on127.0.0.1:4173 with the adjacent canonical NYC checkout.
Run a recorded script through the official Craft Anything CLI, for example:

```sh
craft-anything-cli --project artifacts/studio-ui.cany --allow-run web-walkthrough-record @apps/studio-preview/qa/quill-phone.json
```

Scripts launch a fresh private browser profile; they create local test sessions.
No credentials, existing browser profile, external target or file upload is used.
The phone essay script finds the textarea by its accessible name, types a safe
QA sentence, applies it and captures the result. Dock scripts exercise actual
tabs and segmented dock-position choices. Check screenshots for the recorded
state changes; dispatched clicks alone do not establish visual correctness.

Native runtime, screen readers and the full browser/OS matrix need separate
evidence. Raw successful runs are indexed in docs/ux/studio-refresh/UI_COMPONENT_AUDIT.md.
