//! JSON-lines host protocol shared by `nf-cli` and usable by tests.
//!
//! One request per line on stdin, one response per line on stdout:
//!   {"id":1,"handle":0,"op":"open","payload":{"kind":"tally"}}
//!   {"id":1,"ok":true,"data":{"handle":1}}
//!
//! Ops: `open`, `close`, `apply`, `snapshot`, `restore`, `undo`, `redo`.
//! `snapshot` returns base64 envelope bytes in `data.bytes`; `restore`
//! accepts the same. Any panic inside an engine call is converted into a
//! non-recoverable `internal` error and the session is closed.

use crate::command::{Command, OP_REDO, OP_SNAPSHOT, OP_UNDO};
use crate::engine::{Engine, EngineKind};
use crate::error::{EngineError, ErrorCode};
use crate::session::SessionRegistry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[derive(Debug, Deserialize)]
pub struct FrameRequest {
    pub id: u64,
    #[serde(default)]
    pub handle: u64,
    pub op: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
pub struct FrameResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub events: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<EngineError>,
}

impl FrameResponse {
    fn ok(id: u64, data: Value, events: Vec<Value>) -> Self {
        Self {
            id,
            ok: true,
            data: Some(data),
            events,
            error: None,
        }
    }

    fn err(id: u64, e: EngineError) -> Self {
        Self {
            id,
            ok: false,
            data: None,
            events: vec![],
            error: Some(e),
        }
    }
}

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Minimal base64 — avoids a dependency for a wire codec this small.
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64_ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64_ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn base64_decode(s: &str) -> Result<Vec<u8>, EngineError> {
    let mut table = [255u8; 256];
    for (i, &c) in B64_ALPHABET.iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = table[c as usize];
        if v == 255 {
            return Err(EngineError::serialization("invalid base64 in snapshot"));
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

fn err_resp(id: u64, e: EngineError) -> FrameResponse {
    FrameResponse::err(id, e)
}

fn handle_frame(
    reg: &mut SessionRegistry,
    factory: &dyn Fn(EngineKind) -> Option<Box<dyn Engine>>,
    req: &FrameRequest,
) -> FrameResponse {
    match req.op.as_str() {
        "open" => {
            let kind = req.payload.get("kind").and_then(Value::as_str);
            let Some(kind) = kind.and_then(EngineKind::parse) else {
                return err_resp(
                    req.id,
                    EngineError::invalid("open requires payload.kind (prism|cadence|splice|folio|pitch|tally|quill|photo|motion|design|draft)"),
                );
            };
            match factory(kind) {
                Some(engine) => {
                    let handle = reg.open(engine);
                    FrameResponse::ok(req.id, json!({ "handle": handle }), vec![])
                }
                None => err_resp(
                    req.id,
                    EngineError::unsupported(format!("engine '{}' not built into this host", kind.as_str())),
                ),
            }
        }
        "close" => FrameResponse::ok(req.id, json!({ "closed": reg.close(req.handle) }), vec![]),
        "apply" => {
            let cmd = match serde_json::from_value::<Command>(req.payload.clone()) {
                Ok(c) => c,
                Err(e) => return err_resp(req.id, e.into()),
            };
            match reg.require_mut(req.handle) {
                Ok(engine) => {
                    // Reserved ops route to trait methods, not engine.apply.
                    let res = match cmd.op.as_str() {
                        OP_UNDO => engine.undo().map(|did| (json!({ "undone": did }), vec![])),
                        OP_REDO => engine.redo().map(|did| (json!({ "redone": did }), vec![])),
                        OP_SNAPSHOT => engine
                            .snapshot()
                            .map(|b| (json!({ "bytes": base64_encode(&b) }), vec![])),
                        _ => engine
                            .apply(cmd)
                            .map(|r| (r.data, r.events.into_iter().map(|e| json!(e)).collect())),
                    };
                    match res {
                        Ok((data, events)) => FrameResponse::ok(req.id, data, events),
                        Err(e) => {
                            if !e.recoverable {
                                reg.close(req.handle);
                            }
                            err_resp(req.id, e)
                        }
                    }
                }
                Err(e) => err_resp(req.id, e),
            }
        }
        "snapshot" => match reg.require(req.handle) {
            Ok(engine) => match engine.snapshot() {
                Ok(b) => FrameResponse::ok(req.id, json!({ "bytes": base64_encode(&b) }), vec![]),
                Err(e) => err_resp(req.id, e),
            },
            Err(e) => err_resp(req.id, e),
        },
        "restore" => {
            let bytes = req
                .payload
                .get("bytes")
                .and_then(Value::as_str)
                .map(base64_decode);
            match bytes {
                Some(Ok(b)) => match reg.require_mut(req.handle) {
                    Ok(engine) => match engine.restore(&b) {
                        Ok(()) => FrameResponse::ok(req.id, Value::Null, vec![]),
                        Err(e) => err_resp(req.id, e),
                    },
                    Err(e) => err_resp(req.id, e),
                },
                Some(Err(e)) => err_resp(req.id, e),
                None => err_resp(req.id, EngineError::invalid("restore requires payload.bytes")),
            }
        }
        other => err_resp(
            req.id,
            EngineError::invalid(format!("unknown host op '{other}'")),
        ),
    }
}

/// Best-effort `id` recovery from a frame that failed JSON parsing, so the
/// caller can correlate the error instead of receiving an unmatchable id 0.
fn extract_frame_id(line: &str) -> Option<u64> {
    let pos = line.find("\"id\"")?;
    let rest = line[pos + 4..].trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Run the protocol on stdin/stdout until EOF. `factory` builds a fresh engine
/// for a kind, or `None` if this binary wasn't linked with it.
pub fn run_stdio(
    factory: impl Fn(EngineKind) -> Option<Box<dyn Engine>>,
) -> std::io::Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut reg = SessionRegistry::new();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<FrameRequest>(&line) {
            Ok(req) => {
                let id = req.id;
                match catch_unwind(AssertUnwindSafe(|| handle_frame(&mut reg, &factory, &req))) {
                    Ok(r) => r,
                    Err(_) => {
                        // Session safety: drop the engine if it was mid-command.
                        if req.handle != 0 {
                            reg.close(req.handle);
                        }
                        FrameResponse::err(
                            id,
                            EngineError {
                                code: ErrorCode::Internal,
                                message: "engine panicked; session closed".into(),
                                recoverable: false,
                            },
                        )
                    }
                }
            }
            Err(e) => FrameResponse::err(
                extract_frame_id(&line).unwrap_or(0),
                EngineError::serialization(e.to_string()),
            ),
        };
        writeln!(out, "{}", serde_json::to_string(&resp).unwrap())?;
        out.flush()?;
    }
    Ok(())
}
