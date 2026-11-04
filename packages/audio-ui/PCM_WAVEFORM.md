# Source waveform capture

The native recorder is **react-native-audio-api 1.0.0 AudioRecorder**.
`enableFileOutput` configures 48 kHz mono PCM WAV in the document directory;
`onAudioReady` supplies actual planar Float32 samples for bounded min/max
accumulation. `stop()` must succeed with one finalized file path before
`onSaved` receives a `pcm-wav` result. Empty peak coverage is returned as an
empty list, never generated waveform data.

On web, direct browser MediaRecorder captures compressed bytes. Audio API's
browser decoder extracts source peaks when its codec supports the recording.
There is no browser AudioRecorder implementation upstream; this distinction
is explicit in `SourceRecordingFile`. Decode failure returns the real URI
with `waveform: unavailable`, not fabricated PCM.

The live 100 ms callback visualization is a recording preview. Hardware
callback continuity, exact full-file peak parity and long-duration streaming
remain acceptance checks; this is not a sample-accurate DAW timeline claim.
See [README](README.md) for architecture, platform limits, dependency age gate,
API sources, tests, and unverified device work.
