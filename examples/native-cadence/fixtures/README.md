`decoder.mp4` contains only generated FFmpeg testsrc video and a 440 Hz sine.
No third-party media is included. Generate with:

```sh
ffmpeg -f lavfi -i testsrc=size=192x128:rate=20 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -c:v libx264 -pix_fmt yuv420p -bf 2 -c:a aac -movflags +faststart decoder.mp4
```

The native acceptance runner copies it to the lab's private cache as
`P03-decoder.mp4`; it never reads personal media. The fixture exercises B-frame
presentation timestamps, scaled JPEG output, AAC preroll, 48→24 kHz resampling,
PCM byte framing/tone content, past-end errors and cache cleanup. The MP4 file is
acceptance data, not an encoder/decoder shipped by Forge.
