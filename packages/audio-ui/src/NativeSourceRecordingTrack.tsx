/**
 * Type entry for "@nitro-forge/audio-ui/pcm" and the relative import used by
 * the root index. Runtime resolution:
 * - package export "./pcm": "react-native" -> .native.tsx, "browser" ->
 *   .web.tsx, anything else -> .unsupported.ts, which throws at import.
 * - relative "./NativeSourceRecordingTrack": Metro picks .native.tsx on
 *   iOS/Android and .web.tsx on web by platform extension; tools without
 *   platform extensions (tsc, vitest) land on this file and the web build.
 */
export { NativeSourceRecordingTrack } from "./NativeSourceRecordingTrack.web";
export type {
  NativeSourceRecordingTrackProps,
  SourceRecordingFile,
} from "./sourceRecordingTypes";
