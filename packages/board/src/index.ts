// Cross-platform portable API. This entry point never imports a native
// module or visionOS/Android dependency; use @nitro-forge/board/native only
// in a React Native build with generated Nitro v1 files.
export { createInkOutlineEncoder } from "./renderer/createInkOutlineEncoder";
export type { InkOutlineEncoder } from "./renderer/createInkOutlineEncoder";
export { createWhiteboardRendererBinding } from "./renderer/createWhiteboardRendererBinding";
export type { BoardEditorSource, BoardOverlay } from "./renderer/BoardOverlay";
export type { WhiteboardRendererBinding } from "./renderer/WhiteboardRendererBinding";
export type { WhiteboardRendererBindingOptions } from "./renderer/WhiteboardRendererBindingOptions";
export type { WhiteboardRendererTarget } from "./renderer/WhiteboardRendererTarget";
export type { WhiteboardRendererStatus } from "./renderer/WhiteboardRendererStatus";
export type { UseWhiteboardRendererOptions } from "./renderer/UseWhiteboardRendererOptions";
export type { BoardCamera } from "./specs/BoardCamera";
export type { WhiteboardRendererOptions } from "./specs/WhiteboardRendererOptions";
export type { WhiteboardRendererState } from "./specs/WhiteboardRendererState";
