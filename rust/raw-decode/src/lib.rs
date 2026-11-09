//! raw-decode — host-side RAW probe/decode-preview service over `nf-raw`.
//!
//! This is **not** an `ignition_core::Engine`: no `EngineKind`, no
//! `Command`/`Journal`, no `NFD1` snapshot, no document mutations. Per
//! `docs/completion/reports/P10-raw-product-admission.md` it is the
//! admitted host-side provider boundary: the host asset store owns the
//! original bytes (resolved from the catalog's `asset_ref`), this service
//! runs `nf_raw::probe` / `nf_raw::decode_preview` over LibRaw, and the
//! returned bounded RGBA8 crosses into `photo-engine` exclusively through
//! the existing `processPreview` binary-input op. Nothing decoded enters
//! engine state, snapshots or `describe` output.
//!
//! LibRaw is only ever touched on one dedicated worker thread (the
//! admission's "single worker" rule — LibRaw decoder state is not
//! `Send`-shareable across concurrent decodes). `probe` and
//! `decodePreview` enqueue work; `jobStatus` polls; `cancelJob` sets the
//! cooperative `AtomicBool` the LibRaw progress callback polls at stage
//! boundaries. Jobs are one-shot: a terminal `jobStatus` consumes the
//! result and frees the slot.
//!
//! Bounds (fail-closed, folio-render/splice-render style): RAW input
//! ≤ 64 MiB (nf-raw's own cap, re-checked before enqueue), preview
//! `max_pixels` ∈ 1..=1_048_576 and ≤4096 px/side (the `processPreview`
//! budget), ≤ 8 live jobs, ≤ 256 MiB of queued input bytes, JSON-lines
//! frames ≤ 128 MiB raw (a max-size input is ~89.5 MiB of base64).
//!
//! Platform status: **macOS arm64 only verified** — same posture as
//! `nf-raw` itself. iOS/Android/visionOS/Quest/PICO/Linux/Windows/WASM
//! are NOT built; see `rust/nf-raw/README.md` for per-target requirements.

use ignition_core::{base64_decode, base64_encode, EngineError, ErrorCode, FrameRequest, FrameResponse};
use nf_raw::{decode_preview, probe, RawError, RawInfo, RawPreview};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::BufRead;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;

// ---- Bounds ------------------------------------------------------------

/// Provider version folded into `describe` output.
pub const PROVIDER_VERSION: &str = concat!("raw-decode/", env!("CARGO_PKG_VERSION"));
/// Maximum accepted JSON-lines frame size. Sized for a 64 MiB RAW input
/// base64-encoded (~89.5 MiB) plus JSON overhead; decoded output is at
/// most ~5.6 MiB of base64, so input dominates.
pub const MAX_FRAME_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
/// Maximum simultaneously live (queued + running) jobs.
pub const MAX_JOBS: usize = 8;
/// Maximum total input bytes held by live jobs (queue backpressure).
pub const MAX_QUEUED_INPUT_BYTES: usize = 256 * 1024 * 1024; // 256 MiB
/// Default `decodePreview` output budget: the `processPreview` pixel cap.
pub const DEFAULT_MAX_PIXELS: u64 = nf_raw::MAX_PREVIEW_PIXELS;

fn invalid(msg: impl Into<String>) -> EngineError {
    EngineError::invalid(msg)
}

fn out_of_bounds(msg: impl Into<String>) -> EngineError {
    EngineError::out_of_bounds(msg)
}

fn not_found(msg: impl Into<String>) -> EngineError {
    EngineError::not_found(msg)
}

// ---- Job model ---------------------------------------------------------
//
// One worker thread owns every LibRaw call. `probe` and `decodePreview`
// enqueue a `Work` item carrying the input bytes (by value — the host
// asset store keeps its own copy; nothing is retained here after the
// call), an optional cooperative cancel flag, and a one-shot reply
// channel. `jobStatus` drains the reply; `cancelJob` sets the flag and
// drops the entry (the worker's send then fails harmlessly and it moves
// to the next job).

#[derive(Clone, Copy, PartialEq, Eq)]
enum JobKind {
    Probe,
    Decode,
}

impl JobKind {
    fn as_str(self) -> &'static str {
        match self {
            JobKind::Probe => "probe",
            JobKind::Decode => "decode",
        }
    }
}

struct Work {
    kind: JobKind,
    max_pixels: u64,
    bytes: Vec<u8>,
    cancel: Arc<AtomicBool>,
    reply: mpsc::Sender<Outcome>,
}

enum Outcome {
    Probe(Result<RawInfo, RawError>),
    Decode(Result<RawPreview, RawError>),
    Panicked,
}

struct Job {
    kind: JobKind,
    input_bytes: usize,
    cancel: Arc<AtomicBool>,
    rx: mpsc::Receiver<Outcome>,
}

/// Map a typed `RawError` to the wire error shape. Codes are stable
/// strings so TS hosts can branch without parsing messages.
fn raw_error_json(e: &RawError) -> Value {
    let code = match e {
        RawError::InvalidInput(_) => "invalid-input",
        RawError::LimitExceeded(_) => "limit-exceeded",
        RawError::Probe(_) => "probe-failed",
        RawError::Unsupported(_) => "unsupported",
        RawError::Decode(_) => "decode-failed",
        RawError::Cancelled => "cancelled",
        RawError::Oom(_) => "out-of-memory",
    };
    json!({ "code": code, "message": e.to_string(), "recoverable": false })
}

fn info_json(info: &RawInfo) -> Value {
    json!({
        "make": info.make,
        "model": info.model,
        "format": info.format,
        "width": info.width,
        "height": info.height,
    })
}

/// The service: stateless dispatcher plus a bounded job table and one
/// LibRaw worker thread. Single-threaded by contract — hosts must not
/// share one `RawDecodeService` across threads without external
/// synchronization (same rule as `splice-render`'s `RenderService`).
pub struct RawDecodeService {
    /// Sender to the worker; `None` until the first job lazily spawns it.
    /// Dropped with the service so the worker exits after draining.
    tx: Option<mpsc::Sender<Work>>,
    jobs: HashMap<u64, Job>,
    next_job: u64,
    queued_input: usize,
}

impl RawDecodeService {
    pub fn new() -> Self {
        Self {
            tx: None,
            jobs: HashMap::new(),
            next_job: 1,
            queued_input: 0,
        }
    }

    fn worker(&mut self) -> &mpsc::Sender<Work> {
        if self.tx.is_none() {
            let (tx, rx) = mpsc::channel::<Work>();
            thread::Builder::new()
                .name("raw-decode-worker".into())
                .spawn(move || worker_main(rx))
                .expect("raw-decode: failed to spawn LibRaw worker thread");
            self.tx = Some(tx);
        }
        self.tx.as_ref().unwrap()
    }

    /// Decode `bytes_b64` (≤ [`nf_raw::MAX_INPUT_BYTES`] after decode),
    /// validate, and enqueue. Returns the job id.
    fn enqueue(&mut self, payload: &Value, kind: JobKind) -> Result<Value, EngineError> {
        let b64 = payload
            .get("bytes_b64")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid(format!("{} requires payload.bytes_b64", op_name(kind))))?;
        let bytes = base64_decode(b64)
            .map_err(|e| invalid(format!("payload.bytes_b64: {}", e.message)))?;
        if bytes.is_empty() {
            return Err(invalid("payload.bytes_b64 decodes to empty input"));
        }
        if bytes.len() > nf_raw::MAX_INPUT_BYTES {
            return Err(out_of_bounds(format!(
                "input {} bytes exceeds the {} byte RAW cap",
                bytes.len(),
                nf_raw::MAX_INPUT_BYTES
            )));
        }
        let max_pixels = match kind {
            JobKind::Probe => 0,
            JobKind::Decode => match payload.get("max_pixels") {
                None | Some(Value::Null) => DEFAULT_MAX_PIXELS,
                Some(v) => v
                    .as_u64()
                    .filter(|p| *p >= 1 && *p <= nf_raw::MAX_PREVIEW_PIXELS)
                    .ok_or_else(|| {
                        invalid(format!(
                            "max_pixels must be an integer in 1..={}",
                            nf_raw::MAX_PREVIEW_PIXELS
                        ))
                    })?,
            },
        };
        if self.jobs.len() >= MAX_JOBS {
            return Err(out_of_bounds(format!(
                "job limit reached ({MAX_JOBS}); cancel or poll existing jobs first"
            )));
        }
        if self.queued_input + bytes.len() > MAX_QUEUED_INPUT_BYTES {
            return Err(out_of_bounds(format!(
                "queued input exceeds {MAX_QUEUED_INPUT_BYTES} bytes; poll or cancel jobs first"
            )));
        }
        let (reply_tx, reply_rx) = mpsc::channel::<Outcome>();
        let cancel = Arc::new(AtomicBool::new(false));
        let job_id = self.next_job;
        self.next_job += 1;
        self.queued_input += bytes.len();
        self.jobs.insert(
            job_id,
            Job {
                kind,
                input_bytes: bytes.len(),
                cancel: cancel.clone(),
                rx: reply_rx,
            },
        );
        // Clone the sender so the `&mut self` borrow from `worker()` ends
        // before the error path touches `self.jobs`.
        let tx = self.worker().clone();
        // The worker channel is unbounded; admission is enforced above by
        // MAX_JOBS/MAX_QUEUED_INPUT_BYTES so the queue can never grow past
        // 8 jobs / 256 MiB of input.
        tx.send(Work {
            kind,
            max_pixels,
            bytes,
            cancel,
            reply: reply_tx,
        })
        .map_err(|_| {
            // Worker thread died — drop the job entry and report honestly.
            if let Some(j) = self.jobs.remove(&job_id) {
                self.queued_input -= j.input_bytes;
            }
            EngineError {
                code: ErrorCode::Internal,
                message: "raw-decode LibRaw worker is gone".into(),
                recoverable: false,
            }
        })?;
        Ok(json!({ "job": job_id }))
    }

    fn remove_job(&mut self, job_id: u64) -> Option<Job> {
        let job = self.jobs.remove(&job_id)?;
        self.queued_input -= job.input_bytes;
        Some(job)
    }

    fn job_status(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let job_id = payload
            .get("job")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("jobStatus requires payload.job"))?;
        // Take the entry out so a terminal poll consumes it; a "running"
        // poll puts it straight back.
        let job = self
            .jobs
            .remove(&job_id)
            .ok_or_else(|| not_found(format!("no raw-decode job {job_id}")))?;
        match job.rx.try_recv() {
            Err(mpsc::TryRecvError::Empty) => {
                // Still live: `queued_input` keeps counting its bytes.
                self.jobs.insert(job_id, job);
                Ok(json!({ "job": job_id, "state": "running" }))
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                self.queued_input -= job.input_bytes;
                Err(EngineError {
                    code: ErrorCode::Internal,
                    message: format!("raw-decode job {job_id} lost its worker"),
                    recoverable: false,
                })
            }
            Ok(outcome) => {
                self.queued_input -= job.input_bytes;
                Ok(match (job.kind, outcome) {
                    (JobKind::Probe, Outcome::Probe(Ok(info))) => json!({
                        "job": job_id,
                        "state": "done",
                        "kind": "probe",
                        "info": info_json(&info),
                    }),
                    (JobKind::Decode, Outcome::Decode(Ok(prev))) => json!({
                        "job": job_id,
                        "state": "done",
                        "kind": "decode",
                        "width": prev.width,
                        "height": prev.height,
                        "format": "rgba8",
                        "bytes_b64": base64_encode(&prev.rgba),
                        "info": info_json(&prev.info),
                    }),
                    (_, Outcome::Panicked) => json!({
                        "job": job_id,
                        "state": "failed",
                        "error": { "code": "internal", "message": "nf-raw panicked", "recoverable": false },
                    }),
                    (kind, Outcome::Probe(Err(e))) | (kind, Outcome::Decode(Err(e))) => {
                        if matches!(e, RawError::Cancelled) {
                            json!({
                                "job": job_id,
                                "state": "cancelled",
                                "kind": kind.as_str(),
                            })
                        } else {
                            json!({
                                "job": job_id,
                                "state": "failed",
                                "kind": kind.as_str(),
                                "error": raw_error_json(&e),
                            })
                        }
                    }
                    // Kind/outcome mismatch is impossible by construction
                    // (the worker echoes `work.kind`); treat as internal.
                    _ => json!({
                        "job": job_id,
                        "state": "failed",
                        "error": { "code": "internal", "message": "job kind/outcome mismatch", "recoverable": false },
                    }),
                })
            }
        }
    }

    fn cancel_job(&mut self, payload: &Value) -> Result<Value, EngineError> {
        let job_id = payload
            .get("job")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("cancelJob requires payload.job"))?;
        let Some(job) = self.remove_job(job_id) else {
            return Err(not_found(format!("no raw-decode job {job_id}")));
        };
        // Signal first: LibRaw's progress callback polls this flag at
        // stage boundaries and returns LIBRAW_CANCELLED_BY_CALLBACK.
        job.cancel.store(true, Ordering::Relaxed);
        // Dropping `job` drops the reply receiver; the worker's send
        // fails and it moves on to the next queued job.
        Ok(json!({ "job": job_id, "cancelled": true }))
    }

    /// Dispatch one protocol frame.
    pub fn handle_frame(&mut self, req: &FrameRequest) -> FrameResponse {
        let id = req.id;
        let result = match req.op.as_str() {
            "probe" => self.enqueue(&req.payload, JobKind::Probe),
            "decodePreview" => self.enqueue(&req.payload, JobKind::Decode),
            "jobStatus" => self.job_status(&req.payload),
            "cancelJob" => self.cancel_job(&req.payload),
            "describe" => Ok(json!({
                "service": "raw-decode",
                "backend": "nf-raw/libraw-0.22.3-cddl",
                "version": PROVIDER_VERSION,
                "platform": "macos-arm64-verified",
                "ops": ["probe", "decodePreview", "jobStatus", "cancelJob", "describe"],
                "bounds": {
                    "max_input_bytes": nf_raw::MAX_INPUT_BYTES,
                    "max_raw_pixels": nf_raw::MAX_RAW_PIXELS,
                    "max_raw_memory_mb": nf_raw::MAX_RAW_MEMORY_MB,
                    "max_preview_pixels": nf_raw::MAX_PREVIEW_PIXELS,
                    "max_preview_side": nf_raw::MAX_PREVIEW_SIDE,
                    "max_jobs": MAX_JOBS,
                    "max_queued_input_bytes": MAX_QUEUED_INPUT_BYTES,
                    "max_frame_bytes": MAX_FRAME_BYTES,
                },
            })),
            other => Err(invalid(format!("unknown raw-decode op '{other}'"))),
        };
        match result {
            Ok(data) => FrameResponse {
                id,
                ok: true,
                data: Some(data),
                events: vec![],
                error: None,
            },
            Err(e) => FrameResponse {
                id,
                ok: false,
                data: None,
                events: vec![],
                error: Some(e),
            },
        }
    }
}

fn op_name(kind: JobKind) -> &'static str {
    match kind {
        JobKind::Probe => "probe",
        JobKind::Decode => "decodePreview",
    }
}

impl Default for RawDecodeService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for RawDecodeService {
    fn drop(&mut self) {
        // Signal every live decode job before the senders go away; probe
        // jobs hold no decoder state worth cancelling but the flag is
        // harmless.
        for job in self.jobs.values() {
            job.cancel.store(true, Ordering::Relaxed);
        }
        // `tx` drops after `jobs` (field order is irrelevant here since we
        // only set flags); the worker finishes its current LibRaw call —
        // aborting at the next callback boundary thanks to the flags —
        // then exits on the closed channel.
    }
}

/// The single LibRaw worker. Runs `nf_raw` calls serially until the
/// service drops its sender. A panic inside nf-raw is contained per job
/// and reported as `Outcome::Panicked` rather than killing the worker.
fn worker_main(rx: mpsc::Receiver<Work>) {
    while let Ok(work) = rx.recv() {
        let outcome = match work.kind {
            JobKind::Probe => catch_unwind(AssertUnwindSafe(|| {
                Outcome::Probe(probe(&work.bytes))
            })),
            JobKind::Decode => catch_unwind(AssertUnwindSafe(|| {
                Outcome::Decode(decode_preview(&work.bytes, work.max_pixels, &work.cancel))
            })),
        };
        let outcome = outcome.unwrap_or(Outcome::Panicked);
        // A cancelled job's receiver is already dropped; the send error
        // carries the outcome back and is simply discarded.
        let _ = work.reply.send(outcome);
    }
}

/// Best-effort `id` recovery from a frame rejected before JSON parsing.
fn extract_frame_id(line: &str) -> Option<u64> {
    let pos = line.find("\"id\"")?;
    let rest = line[pos + 4..].trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Read one `\n`-terminated line, keeping at most `max` bytes of it.
/// Same semantics as folio-render's `read_frame_line`.
fn read_frame_line<R: BufRead>(
    reader: &mut R,
    max: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut buf = Vec::new();
    let mut truncated = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            break;
        }
        let nl = chunk.iter().position(|&b| b == b'\n');
        let end = nl.map(|i| i + 1).unwrap_or(chunk.len());
        if !truncated {
            let room = max.saturating_sub(buf.len());
            if end <= room {
                buf.extend_from_slice(&chunk[..end]);
            } else {
                buf.extend_from_slice(&chunk[..room]);
                truncated = true;
            }
        }
        reader.consume(end);
        if nl.is_some() {
            break;
        }
    }
    Ok((buf, truncated))
}

/// Run the JSON-lines protocol on stdin/stdout until EOF — same wire
/// shape as `nf-cli`/`folio-render`/`splice-render`
/// (`{"id","handle","op","payload"}` → `{"id","ok","data"|"error"}`).
/// Dispatch is instant; LibRaw work happens on the service's worker
/// thread so `cancelJob`/`jobStatus` frames are never blocked behind a
/// decode. Frames are capped at [`MAX_FRAME_BYTES`] raw bytes before
/// parsing; a panic drops all live jobs, matching `nf-cli`'s
/// session-safety rule.
pub fn run_stdio(service: &mut RawDecodeService) -> std::io::Result<()> {
    use std::io::Write;
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut reader = stdin.lock();
    loop {
        let (line_bytes, truncated) = read_frame_line(&mut reader, MAX_FRAME_BYTES)?;
        if line_bytes.is_empty() && !truncated {
            break;
        }
        let line = String::from_utf8_lossy(&line_bytes);
        if line.trim().is_empty() && !truncated {
            continue;
        }
        let resp = if truncated {
            FrameResponse {
                id: extract_frame_id(&line).unwrap_or(0),
                ok: false,
                data: None,
                events: vec![],
                error: Some(out_of_bounds(format!(
                    "frame exceeds {MAX_FRAME_BYTES} bytes"
                ))),
            }
        } else {
            match serde_json::from_str::<FrameRequest>(&line) {
                Ok(req) => {
                    let id = req.id;
                    match catch_unwind(AssertUnwindSafe(|| service.handle_frame(&req))) {
                        Ok(r) => r,
                        Err(_) => {
                            // Match nf-cli's session-safety rule: a panic
                            // poisons the service, so drop every live job.
                            // Decode jobs keep running on the worker until
                            // their next LibRaw callback boundary (the
                            // service is gone, so results are discarded).
                            service.jobs.clear();
                            service.queued_input = 0;
                            FrameResponse {
                                id,
                                ok: false,
                                data: None,
                                events: vec![],
                                error: Some(EngineError {
                                    code: ErrorCode::Internal,
                                    message: "raw-decode panicked; jobs dropped".into(),
                                    recoverable: false,
                                }),
                            }
                        }
                    }
                }
                Err(e) => FrameResponse {
                    id: extract_frame_id(&line).unwrap_or(0),
                    ok: false,
                    data: None,
                    events: vec![],
                    error: Some(EngineError::serialization(e.to_string())),
                },
            }
        };
        writeln!(out, "{}", serde_json::to_string(&resp).unwrap())?;
        out.flush()?;
    }
    Ok(())
}
