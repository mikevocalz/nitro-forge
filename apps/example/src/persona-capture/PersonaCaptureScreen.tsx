import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Canvas,
  useCanvasRef,
  type NativeCanvas,
  type RNCanvasContext,
} from 'react-native-webgpu';
import {
  Camera,
  isScannedFace,
  useCameraDevices,
  useCameraPermission,
  useFrameOutput,
  useObjectOutput,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-worklets';
import { PersonaCapture } from '@nitro-forge/persona-native/capture';
import { CAPTURE_SOURCE, CAPTURE_STEPS, CAPTURE_STEP_IDS, CAPTURE_STEP_SKIPPABLE } from './steps';
import {
  lumaStats,
  qualityForCapture,
  type FaceDetection,
  type LumaStats,
} from './quality';

/**
 * Phone-hosted guided persona capture.
 *
 * Pipeline per frame (inside the VisionCamera frame-processor worklet):
 *   Frame -> getNativeBuffer() -> RNWebGPU.createVideoFrameFromNativeBuffer
 *   -> GPUDevice.importExternalTexture -> WGSL render pass -> WebGPU canvas
 *   preview. Orientation/mirroring stay as frame metadata and are applied as
 *   UV transforms in the shader — buffers are never physically rotated.
 * Every Nth frame also reads the Y plane (pixelFormat 'yuv' keeps it
 * CPU-accessible) for luma statistics -> quality gates -> runOnJS on pass.
 *
 * An accepted frame triggers a real capturePhotoToFile whose file path is the
 * opaque sample handle handed to the native PersonaCapture (Nitro v1)
 * CaptureSession. Generation/fitting is a separate host concern; this screen
 * stops honestly at `processing` until a real generation host calls
 * generated()/save().
 */

const PREVIEW_SHADER = /* wgsl */ `
struct Uniforms {
  scale: vec2f,   // cover-fit scale
  rot: f32,       // quarter turns: 0,1,2,3
  mirror: f32,    // 1.0 flips horizontally
};
@group(0) @binding(0) var tex: texture_external;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var uv = vec2f((p[i].x + 1) * 0.5, (1 - p[i].y) * 0.5);
  // Rotate around center by u.rot quarter turns (counter-clockwise in uv space).
  var r = u32(u.rot + 0.5);
  var c = uv - vec2f(0.5);
  var cr = cos(1.5707963 * f32(r));
  var sr = sin(1.5707963 * f32(r));
  uv = vec2f(c.x * cr - c.y * sr, c.x * sr + c.y * cr) + vec2f(0.5);
  if (u.mirror > 0.5) { uv.x = 1 - uv.x; }
  // Cover-fit: scale uv around center.
  uv = (uv - vec2f(0.5)) * u.scale + vec2f(0.5);
  var out: VsOut;
  out.pos = vec4f(p[i], 0, 1);
  out.uv = uv;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(tex, samp, in.uv);
}
`;

const LUMA_EVERY_N_FRAMES = 6;

type PipelineState = {
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
  uniformBuffer: GPUBuffer;
  context: RNCanvasContext;
  canvasWidth: number;
  canvasHeight: number;
  dummyView: GPUTextureView;
} | null;

export function PersonaCaptureScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const canvasRef = useCanvasRef();
  const [device, setDevice] = useState<GPUDevice | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(null);
  const [stage, setStage] = useState<string>('prepare');
  const [completed, setCompleted] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<PersonaCapture | null>(null);
  const epochRef = useRef(0);
  const busyRef = useRef(false);
  const frameCounter = useRef({ n: 0 });
  const faceRef = useRef<FaceDetection | null>(null);

  const devices = useCameraDevices();
  const cameraDevice = useMemo(
    () => devices.find((d) => d.position === 'front') ?? devices[0],
    [devices],
  );

  const photoOutput = usePhotoOutput({
    targetResolution: { width: 1280, height: 720 },
    qualityPrioritization: 'quality',
  });

  // Platform-native face detection (bounding box + yaw/roll). Runs on the
  // JS thread; the latest snapshot is read by the quality gate on pass.
  const objectOutput = useObjectOutput({
    types: ['face'],
    onObjectsScanned: (objects) => {
      const faces = objects.filter(isScannedFace);
      const primary = faces[0];
      faceRef.current = {
        faceCount: faces.length,
        box: primary
          ? {
              x: primary.boundingBox.x,
              y: primary.boundingBox.y,
              width: primary.boundingBox.width,
              height: primary.boundingBox.height,
            }
          : null,
        yawDeg: primary?.hasYawAngle ? primary.yawAngle : null,
        rollDeg: primary?.hasRollAngle ? primary.rollAngle : null,
        at: Date.now(),
      };
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('no WebGPU adapter');
        const dev = await adapter.requestDevice();
        if (cancelled) return;
        setDevice(dev);
      } catch (e) {
        setNotice(`WebGPU unavailable: ${String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!device || pipelineState) return;
    const context = canvasRef.current?.getContext('webgpu');
    if (!context) return;
    const canvas = context.canvas as unknown as NativeCanvas;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * PixelRatio.get()));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * PixelRatio.get()));
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const module = device.createShaderModule({ code: PREVIEW_SHADER });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dummyTexture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    setPipelineState({
      pipeline, sampler, uniformBuffer, context,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      dummyView: dummyTexture.createView(),
    });
  }, [device, canvasRef, pipelineState]);

  useEffect(() => {
    if (!hasPermission || captureRef.current) return;
    try {
      const capture = new PersonaCapture(
        [...CAPTURE_STEP_IDS],
        [...CAPTURE_STEP_SKIPPABLE],
        CAPTURE_SOURCE,
      );
      epochRef.current = capture.start(true);
      captureRef.current = capture;
      setStage(capture.stage());
    } catch (e) {
      setNotice(`Capture init failed: ${String(e)}`);
    }
  }, [hasPermission]);

  /** JS-side handler invoked from the frame worklet with luma stats. */
  const onLumaStats = useCallback(
    async (mean: number, darkRatio: number, samples: number) => {
      const capture = captureRef.current;
      if (!capture || busyRef.current) return;
      if (capture.stage() !== 'capture') return;
      const stats: LumaStats = { mean, darkRatio, samples };
      const verdict = qualityForCapture(stats, faceRef.current, Date.now());
      if (!verdict.gatePassed.every(Boolean)) return;
      const step = CAPTURE_STEPS[completed];
      if (!step) return;
      busyRef.current = true;
      setCapturing(true);
      try {
        const file = await photoOutput.capturePhotoToFile({}, {});
        const ok = capture.observe(
          epochRef.current,
          step.id,
          file.filePath,
          verdict.gateNames,
          verdict.gatePassed,
        );
        if (ok) {
          setCompleted((n) => n + 1);
          setNotice(null);
        } else {
          const rej = capture.hasRejection()
            ? `${capture.rejectionStep()}:${capture.rejectionGate() || 'quality'}`
            : 'rejected';
          setNotice(`Frame rejected (${rej}) — hold the pose`);
        }
        setStage(capture.stage());
      } catch (e) {
        setNotice(`Capture failed: ${String(e)}`);
      } finally {
        busyRef.current = false;
        setCapturing(false);
      }
    },
    [completed, photoOutput],
  );

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    targetResolution: { width: 640, height: 480 },
    dropFramesWhileBusy: true,
    onFrame: (frame) => {
      'worklet';
      const state = pipelineState;
      const dev = device;
      try {
        if (state && dev && frame.hasNativeBuffer) {
          const nativeBuffer = frame.getNativeBuffer();
          try {
            const videoFrame = RNWebGPU.createVideoFrameFromNativeBuffer(nativeBuffer.pointer);
            try {
              let rotIndex = 0;
              if (frame.orientation === 'right') rotIndex = 1;
              else if (frame.orientation === 'down') rotIndex = 2;
              else if (frame.orientation === 'left') rotIndex = 3;
              const externalTex = dev.importExternalTexture({ source: videoFrame });
              const cw = state.canvasWidth;
              const ch = state.canvasHeight;
              const rotated = rotIndex === 1 || rotIndex === 3;
              const dispW = rotated ? videoFrame.height : videoFrame.width;
              const dispH = rotated ? videoFrame.width : videoFrame.height;
              const canvasAR = cw / ch;
              const frameAR = dispW / dispH;
              const sx = frameAR > canvasAR ? canvasAR / frameAR : 1;
              const sy = frameAR > canvasAR ? 1 : frameAR / canvasAR;
              dev.queue.writeBuffer(
                state.uniformBuffer, 0,
                new Float32Array([sx, sy, rotIndex, frame.isMirrored ? 1 : 0]),
              );
              const bindGroup = dev.createBindGroup({
                layout: state.pipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: externalTex },
                  { binding: 1, resource: state.sampler },
                  { binding: 2, resource: { buffer: state.uniformBuffer } },
                  { binding: 3, resource: state.dummyView },
                ],
              });
              const encoder = dev.createCommandEncoder();
              const pass = encoder.beginRenderPass({
                colorAttachments: [{
                  view: state.context.getCurrentTexture().createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                  loadOp: 'clear',
                  storeOp: 'store',
                }],
              });
              pass.setPipeline(state.pipeline);
              pass.setBindGroup(0, bindGroup);
              pass.draw(3);
              pass.end();
              dev.queue.submit([encoder.finish()]);
            } finally {
              videoFrame.release();
            }
          } finally {
            nativeBuffer.release();
          }
        }
        // CPU-side luma metrics on a cadence (state-only, not frame-coupled).
        // The JS side combines these with the latest face detection and only
        // then decides whether a photo should be captured for this step.
        frameCounter.current.n += 1;
        if (frameCounter.current.n % LUMA_EVERY_N_FRAMES === 0 && frame.isPlanar) {
          const planes = frame.getPlanes();
          const y = planes[0];
          if (y && y.isValid) {
            const stats = lumaStats(y.getPixelBuffer(), y.width, y.height, y.bytesPerRow);
            runOnJS(onLumaStats)(stats.mean, stats.darkRatio, stats.samples);
          }
        }
      } catch {
        // Per-frame failures must never stall the camera pipeline.
      } finally {
        // Frame.dispose exists at runtime (HybridObject) but is not in the
        // generated Frame typings; dispose via the hybrid-object surface.
        (frame as unknown as { dispose(): void }).dispose();
      }
    },
    onFrameDropped: () => {},
  });

  const outputs = useMemo(
    () => [frameOutput, photoOutput, objectOutput],
    [frameOutput, photoOutput, objectOutput],
  );

  const currentStep = CAPTURE_STEPS[Math.min(completed, CAPTURE_STEPS.length - 1)];
  const coverageDone = completed >= CAPTURE_STEPS.length;

  const onSkip = useCallback(() => {
    const capture = captureRef.current;
    if (!capture || capture.stage() !== 'capture') return;
    const step = CAPTURE_STEPS[completed];
    if (!step?.skippable) return;
    if (capture.skip(epochRef.current, step.id)) {
      setCompleted((n) => n + 1);
      setStage(capture.stage());
    }
  }, [completed]);

  const onGenerate = useCallback(() => {
    const capture = captureRef.current;
    if (!capture || capture.stage() !== 'capture') return;
    try {
      epochRef.current = capture.generate();
      setStage(capture.stage());
      if (capture.stage() === 'handoff') {
        epochRef.current = capture.transferAcknowledged();
        setStage(capture.stage());
      }
    } catch (e) {
      setNotice(`Generate failed: ${String(e)}`);
    }
  }, []);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission is required for persona capture.</Text>
      </View>
    );
  }
  if (!cameraDevice) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>No camera device found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={cameraDevice}
          isActive
          outputs={outputs}
          constraints={[{ fps: 30 }]}
        />
        {pipelineState ? (
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />
        ) : null}
      </View>
      <View style={styles.panel}>
        <Text style={styles.stage}>stage: {stage}</Text>
        {!coverageDone && currentStep ? (
          <>
            <Text style={styles.prompt}>
              {completed + 1}/{CAPTURE_STEPS.length} — {currentStep.prompt}
            </Text>
            {currentStep.skippable ? (
              <TouchableOpacity style={styles.button} onPress={onSkip}>
                <Text style={styles.buttonText}>Skip this expression</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : coverageDone ? (
          <TouchableOpacity style={styles.button} onPress={onGenerate}>
            <Text style={styles.buttonText}>Generate persona</Text>
          </TouchableOpacity>
        ) : null}
        {stage === 'processing' ? (
          <Text style={styles.hint}>
            Processing — generation host pending (fitting module not yet wired).
          </Text>
        ) : null}
        {capturing ? <Text style={styles.hint}>Capturing frame…</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1 },
  panel: { padding: 16, gap: 8, backgroundColor: '#111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: '#eee', textAlign: 'center' },
  stage: { color: '#8f8', fontSize: 12, textTransform: 'uppercase' },
  prompt: { color: '#fff', fontSize: 16 },
  hint: { color: '#aaa', fontSize: 12 },
  notice: { color: '#f88', fontSize: 12 },
  button: {
    backgroundColor: '#2a6df4',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
