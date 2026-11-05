//! Splice engine — the video timeline model for Nitro-Forge.
//!
//! Pure timeline state: media sources, video/audio tracks, and clips that
//! reference source sub-spans at a playback speed. No media decoding — the
//! `renderPlan` op produces the ordered, resolved clip list an encoder would
//! consume.
//!
//! Contracts: docs/ARCHITECTURE.md + docs/ENGINE_OPS.md (`splice-engine`).

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Event, saturating_sum, HeapSize, Journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const JOURNAL_CAPACITY: usize = 64;
const DEFAULT_FPS: f64 = 30.0;
const MIN_SPEED: f64 = 0.1;
const MAX_SPEED: f64 = 10.0;
/// Tolerance for float comparisons on timeline boundaries.
const EPS: f64 = 1e-9;

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub name: String,
    pub duration_s: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: u64,
    pub source_id: u64,
    /// Timeline placement (seconds).
    pub timeline_start_s: f64,
    /// Source span (seconds, source-relative).
    pub in_s: f64,
    pub out_s: f64,
    pub speed: f64,
}

impl Clip {
    /// Timeline footprint: (out_s - in_s) / speed.
    fn timeline_len(&self) -> f64 {
        (self.out_s - self.in_s) / self.speed
    }

    fn timeline_end(&self) -> f64 {
        self.timeline_start_s + self.timeline_len()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: u64,
    pub kind: TrackKind,
    #[serde(default)]
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Doc {
    fps: f64,
    next_id: u64,
    sources: BTreeMap<u64, Source>,
    tracks: Vec<Track>,
}

impl Doc {
    fn fresh(fps: f64) -> Self {
        Self {
            fps,
            next_id: 1,
            sources: BTreeMap::new(),
            tracks: Vec::new(),
        }
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn track_index(&self, id: u64) -> Option<usize> {
        self.tracks.iter().position(|t| t.id == id)
    }

    fn clip_location(&self, id: u64) -> Option<(usize, usize)> {
        for (ti, t) in self.tracks.iter().enumerate() {
            if let Some(ci) = t.clips.iter().position(|c| c.id == id) {
                return Some((ti, ci));
            }
        }
        None
    }

    /// Would a clip occupying [start, start+len) on `track_idx` overlap an
    /// existing clip? `exclude` skips the clip being edited.
    fn overlaps(&self, track_idx: usize, start: f64, len: f64, exclude: Option<u64>) -> bool {
        let end = start + len;
        self.tracks[track_idx].clips.iter().any(|c| {
            Some(c.id) != exclude
                && start < c.timeline_end() - EPS
                && c.timeline_start_s < end - EPS
        })
    }

    fn track_end(&self, track_idx: usize) -> f64 {
        self.tracks[track_idx]
            .clips
            .iter()
            .map(Clip::timeline_end)
            .fold(0.0, f64::max)
    }

    fn source_in_use(&self, source_id: u64) -> bool {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .any(|c| c.source_id == source_id)
    }
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

fn req_u64(p: &Value, key: &str) -> Result<u64, EngineError> {
    p.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn req_f64(p: &Value, key: &str) -> Result<f64, EngineError> {
    p.get(key)
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite())
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn opt_f64(p: &Value, key: &str) -> Result<Option<f64>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|f| f.is_finite())
            .map(Some)
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
    }
}

fn opt_str(p: &Value, key: &str) -> Result<Option<String>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_str()
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
    }
}

fn check_speed(speed: f64) -> Result<(), EngineError> {
    if !(MIN_SPEED..=MAX_SPEED).contains(&speed) {
        return Err(EngineError::validation(format!(
            "speed must be in {MIN_SPEED}..={MAX_SPEED}"
        )));
    }
    Ok(())
}

/// Validate a clip's source span against its source duration.
fn check_span(in_s: f64, out_s: f64, src: &Source) -> Result<(), EngineError> {
    if in_s < 0.0 {
        return Err(EngineError::validation("in_s must be >= 0"));
    }
    if !(in_s < out_s) {
        return Err(EngineError::validation("in_s must be < out_s"));
    }
    if out_s > src.duration_s + EPS {
        return Err(EngineError::out_of_bounds(format!(
            "out_s exceeds source duration {}",
            src.duration_s
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// Video timeline engine. See ENGINE_OPS.md § `splice-engine`.
impl HeapSize for Source {
    fn heap_size(&self) -> usize {
        self.name.heap_size()
    }
}

impl HeapSize for Clip {
    const FLAT: bool = true;

    fn heap_size(&self) -> usize {
        0
    }
}

impl HeapSize for Track {
    fn heap_size(&self) -> usize {
        self.clips.heap_size()
    }
}

impl HeapSize for Doc {
    fn heap_size(&self) -> usize {
        self.sources.heap_size().saturating_add(self.tracks.heap_size())
    }
}

pub struct SpliceEngine {
    doc: Doc,
    /// Whole-doc snapshots as undo entries (capacity 64).
    journal: Journal<Doc>,
}

impl SpliceEngine {
    pub fn new() -> Self {
        Self {
            doc: Doc::fresh(DEFAULT_FPS),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    fn record(&mut self) {
        self.journal.record(self.doc.clone());
    }

    fn changed(data: Value, structural: bool) -> CommandResult {
        let mut events = vec![Event::new("document:changed", Value::Null)];
        if structural {
            events.push(Event::new("timeline:changed", Value::Null));
        }
        CommandResult { events, data }
    }

    fn read_only(data: Value) -> CommandResult {
        CommandResult {
            events: vec![],
            data,
        }
    }
}

impl Default for SpliceEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for SpliceEngine {
    /// Undo entries here are whole-document clones, so each is charged at the
    /// live document's size rather than walked: O(live doc), no allocation.
    fn heap_size_estimate(&self) -> usize {
        let live = self.doc.heap_size();
        // The engine itself lives in a host-owned Box.
        saturating_sum([
            std::mem::size_of::<Self>(),
            live,
            self.journal.reserved_bytes(),
            self.journal.entries().count().saturating_mul(live),
        ])
    }

    fn kind(&self) -> EngineKind {
        EngineKind::Splice
    }

    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.v != 1 {
            return Err(EngineError::unsupported(format!(
                "unsupported command version {}",
                cmd.v
            )));
        }
        let p = &cmd.payload;
        match cmd.op.as_str() {
            // ---- lifecycle -------------------------------------------------
            "new" => {
                let fps = opt_f64(p, "fps")?.unwrap_or(DEFAULT_FPS);
                if fps <= 0.0 {
                    return Err(EngineError::validation("fps must be > 0"));
                }
                self.record();
                self.doc = Doc::fresh(fps);
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "describe" => Ok(Self::read_only(serde_json::to_value(&self.doc)?)),

            // ---- sources ---------------------------------------------------
            "addSource" => {
                let duration = req_f64(p, "duration_s")?;
                if duration <= 0.0 {
                    return Err(EngineError::validation("duration_s must be > 0"));
                }
                let name = opt_str(p, "name")?;
                self.record();
                let id = self.doc.alloc_id();
                let name = name.unwrap_or_else(|| format!("Source {}", self.doc.sources.len() + 1));
                self.doc.sources.insert(id, Source { name, duration_s: duration });
                Ok(Self::changed(json!({ "source_id": id }), false))
            }
            "removeSource" => {
                let id = req_u64(p, "id")?;
                if !self.doc.sources.contains_key(&id) {
                    return Err(EngineError::not_found(format!("no source {id}")));
                }
                if self.doc.source_in_use(id) {
                    return Err(EngineError::validation(
                        "source is referenced by a clip",
                    ));
                }
                self.record();
                self.doc.sources.remove(&id);
                Ok(Self::changed(json!({ "ok": true }), false))
            }

            // ---- tracks ----------------------------------------------------
            "addTrack" => {
                let kind = match p.get("kind").and_then(Value::as_str) {
                    Some("video") => TrackKind::Video,
                    Some("audio") => TrackKind::Audio,
                    Some(_) => {
                        return Err(EngineError::validation(
                            "kind must be \"video\" or \"audio\"",
                        ))
                    }
                    None => return Err(EngineError::invalid("missing or invalid 'kind'")),
                };
                self.record();
                let id = self.doc.alloc_id();
                self.doc.tracks.push(Track {
                    id,
                    kind,
                    clips: Vec::new(),
                });
                Ok(Self::changed(json!({ "track_id": id }), true))
            }
            "removeTrack" => {
                let id = req_u64(p, "id")?;
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks.remove(idx);
                Ok(Self::changed(json!({ "ok": true }), true))
            }

            // ---- clips -----------------------------------------------------
            "addClip" => {
                let track_id = req_u64(p, "track")?;
                let source_id = req_u64(p, "source")?;
                let in_s = req_f64(p, "in_s")?;
                let out_s = req_f64(p, "out_s")?;
                let speed = opt_f64(p, "speed")?.unwrap_or(1.0);
                check_speed(speed)?;
                let ti = self
                    .doc
                    .track_index(track_id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {track_id}")))?;
                let src = self
                    .doc
                    .sources
                    .get(&source_id)
                    .ok_or_else(|| EngineError::not_found(format!("no source {source_id}")))?;
                check_span(in_s, out_s, src)?;
                let start = opt_f64(p, "start_s")?.unwrap_or_else(|| self.doc.track_end(ti));
                if start < 0.0 {
                    return Err(EngineError::validation("start_s must be >= 0"));
                }
                let len = (out_s - in_s) / speed;
                if self.doc.overlaps(ti, start, len, None) {
                    return Err(EngineError::validation(
                        "clip overlaps an existing clip on this track",
                    ));
                }
                self.record();
                let id = self.doc.alloc_id();
                self.doc.tracks[ti].clips.push(Clip {
                    id,
                    source_id,
                    timeline_start_s: start,
                    in_s,
                    out_s,
                    speed,
                });
                self.doc.tracks[ti]
                    .clips
                    .sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
                Ok(Self::changed(json!({ "clip_id": id }), true))
            }
            "removeClip" => {
                let id = req_u64(p, "id")?;
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                self.record();
                self.doc.tracks[ti].clips.remove(ci);
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "moveClip" => {
                let id = req_u64(p, "id")?;
                let start = req_f64(p, "start_s")?;
                if start < 0.0 {
                    return Err(EngineError::validation("start_s must be >= 0"));
                }
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let len = self.doc.tracks[ti].clips[ci].timeline_len();
                if self.doc.overlaps(ti, start, len, Some(id)) {
                    return Err(EngineError::validation(
                        "move would overlap an existing clip on this track",
                    ));
                }
                self.record();
                self.doc.tracks[ti].clips[ci].timeline_start_s = start;
                self.doc.tracks[ti]
                    .clips
                    .sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "trimClip" => {
                let id = req_u64(p, "id")?;
                let in_s = opt_f64(p, "in_s")?;
                let out_s = opt_f64(p, "out_s")?;
                if in_s.is_none() && out_s.is_none() {
                    return Err(EngineError::invalid(
                        "trimClip requires at least one of 'in_s', 'out_s'",
                    ));
                }
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let clip = &self.doc.tracks[ti].clips[ci];
                let new_in = in_s.unwrap_or(clip.in_s);
                let new_out = out_s.unwrap_or(clip.out_s);
                let src = self
                    .doc
                    .sources
                    .get(&clip.source_id)
                    .ok_or_else(|| EngineError::internal("clip references missing source"))?;
                check_span(new_in, new_out, src)?;
                // Trimming the in-point shifts where the clip's media starts;
                // the timeline start stays fixed and the footprint changes.
                let new_len = (new_out - new_in) / clip.speed;
                let start = clip.timeline_start_s;
                if self.doc.overlaps(ti, start, new_len, Some(id)) {
                    return Err(EngineError::validation(
                        "trim would overlap an existing clip on this track",
                    ));
                }
                self.record();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                clip.in_s = new_in;
                clip.out_s = new_out;
                Ok(Self::changed(json!({ "ok": true }), true))
            }
            "splitClip" => {
                let id = req_u64(p, "id")?;
                let at = req_f64(p, "at_s")?;
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let clip = &self.doc.tracks[ti].clips[ci];
                let start = clip.timeline_start_s;
                let end = clip.timeline_end();
                if !(at > start + EPS && at < end - EPS) {
                    return Err(EngineError::validation(
                        "at_s must be strictly inside the clip's timeline span",
                    ));
                }
                // Source-time at the split point (speed-aware).
                let split_media = clip.in_s + (at - start) * clip.speed;
                let left_id = clip.id;
                self.record();
                let right_id = self.doc.alloc_id();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                let right = Clip {
                    id: right_id,
                    source_id: clip.source_id,
                    timeline_start_s: at,
                    in_s: split_media,
                    out_s: clip.out_s,
                    speed: clip.speed,
                };
                clip.out_s = split_media;
                self.doc.tracks[ti].clips.insert(ci + 1, right);
                Ok(Self::changed(
                    json!({ "left_id": left_id, "right_id": right_id }),
                    true,
                ))
            }
            "setSpeed" => {
                let id = req_u64(p, "id")?;
                let speed = req_f64(p, "speed")?;
                check_speed(speed)?;
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let clip = &self.doc.tracks[ti].clips[ci];
                let new_len = (clip.out_s - clip.in_s) / speed;
                let start = clip.timeline_start_s;
                if self.doc.overlaps(ti, start, new_len, Some(id)) {
                    return Err(EngineError::validation(
                        "speed change would overlap an existing clip on this track",
                    ));
                }
                self.record();
                self.doc.tracks[ti].clips[ci].speed = speed;
                Ok(Self::changed(json!({ "ok": true }), true))
            }

            // ---- queries ---------------------------------------------------
            "duration" => {
                let seconds = self
                    .doc
                    .tracks
                    .iter()
                    .enumerate()
                    .map(|(i, _)| self.doc.track_end(i))
                    .fold(0.0, f64::max);
                Ok(Self::read_only(json!({ "seconds": seconds })))
            }
            "timeline" => Ok(Self::read_only(serde_json::to_value(&self.doc)?)),
            "renderPlan" => {
                let tracks: Vec<Value> = self
                    .doc
                    .tracks
                    .iter()
                    .map(|t| {
                        let mut clips: Vec<&Clip> = t.clips.iter().collect();
                        clips.sort_by(|a, b| a.timeline_start_s.total_cmp(&b.timeline_start_s));
                        Value::Array(
                            clips
                                .into_iter()
                                .map(|c| {
                                    json!({
                                        "clip_id": c.id,
                                        "track_id": t.id,
                                        "track_kind": match t.kind {
                                            TrackKind::Video => "video",
                                            TrackKind::Audio => "audio",
                                        },
                                        "source_id": c.source_id,
                                        "timeline_start_s": c.timeline_start_s,
                                        "timeline_end_s": c.timeline_end(),
                                        "in_s": c.in_s,
                                        "out_s": c.out_s,
                                        "speed": c.speed,
                                    })
                                })
                                .collect(),
                        )
                    })
                    .collect();
                Ok(Self::read_only(json!({ "tracks": tracks })))
            }

            other => Err(EngineError::invalid(format!("unknown op '{other}'"))),
        }
    }

    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        let payload = serde_json::to_vec(&self.doc)?;
        Ok(encode_envelope(&payload))
    }

    fn restore(&mut self, data: &[u8]) -> Result<(), EngineError> {
        let (_fmt, payload) = decode_envelope(data)?;
        let mut doc: Doc = serde_json::from_slice(payload)?;
        // A stale snapshot can carry next_id below live ids → collisions.
        let max_id = doc
            .sources
            .keys()
            .copied()
            .chain(doc.tracks.iter().map(|t| t.id))
            .chain(doc.tracks.iter().flat_map(|t| t.clips.iter().map(|c| c.id)))
            .max()
            .unwrap_or(0);
        doc.next_id = doc.next_id.max(max_id.saturating_add(1));
        self.doc = doc;
        self.journal = Journal::new(JOURNAL_CAPACITY);
        Ok(())
    }

    fn undo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_undo() {
            Some(prev) => {
                let current = std::mem::replace(&mut self.doc, prev);
                self.journal.push_redo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn redo(&mut self) -> Result<bool, EngineError> {
        match self.journal.pop_redo() {
            Some(next) => {
                let current = std::mem::replace(&mut self.doc, next);
                self.journal.push_undo(current);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
    use serde_json::json;

    fn eng() -> SpliceEngine {
        SpliceEngine::new()
    }

    fn apply(e: &mut SpliceEngine, op: &str, payload: Value) -> Result<Value, EngineError> {
        e.apply(Command::new(op, payload)).map(|r| r.data)
    }

    fn apply_full(
        e: &mut SpliceEngine,
        op: &str,
        payload: Value,
    ) -> Result<CommandResult, EngineError> {
        e.apply(Command::new(op, payload))
    }

    fn expect_err(e: &mut SpliceEngine, op: &str, payload: Value) -> EngineError {
        e.apply(Command::new(op, payload)).unwrap_err()
    }

    fn describe(e: &SpliceEngine) -> Value {
        serde_json::to_value(&e.doc).unwrap()
    }

    /// Engine with one 10s source (id returned) and one video track.
    fn setup(e: &mut SpliceEngine) -> (u64, u64) {
        let sid = apply(e, "addSource", json!({"duration_s": 10.0, "name": "a.mov"}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        let tid = apply(e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        (sid, tid)
    }

    // ---- basics ------------------------------------------------------------

    #[test]
    fn new_defaults() {
        let mut e = eng();
        assert_eq!(describe(&e)["fps"], 30.0);
        apply(&mut e, "new", json!({"fps": 24.0})).unwrap();
        assert_eq!(describe(&e)["fps"], 24.0);
        assert_eq!(e.kind(), EngineKind::Splice);
        let before = describe(&e);
        expect_err(&mut e, "new", json!({"fps": 0.0}));
        expect_err(&mut e, "new", json!({"fps": -24.0}));
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn unknown_op_and_bad_version() {
        let mut e = eng();
        assert_eq!(
            expect_err(&mut e, "nope", json!({})).code,
            ErrorCode::InvalidCommand
        );
        let mut cmd = Command::new("describe", json!({}));
        cmd.v = 99;
        assert_eq!(e.apply(cmd).unwrap_err().code, ErrorCode::Unsupported);
    }

    // ---- sources ------------------------------------------------------------

    #[test]
    fn source_lifecycle() {
        let mut e = eng();
        let before = describe(&e);
        expect_err(&mut e, "addSource", json!({"duration_s": 0.0}));
        expect_err(&mut e, "addSource", json!({"duration_s": -2.0}));
        expect_err(&mut e, "addSource", json!({}));
        assert_eq!(describe(&e), before);

        let sid = apply(&mut e, "addSource", json!({"duration_s": 5.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert_eq!(describe(&e)["sources"][sid.to_string()]["duration_s"], 5.0);

        let err = expect_err(&mut e, "removeSource", json!({"id": 777}));
        assert_eq!(err.code, ErrorCode::NotFound);

        // referenced source cannot be removed
        let tid = apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap();
        let before = describe(&e);
        let err = expect_err(&mut e, "removeSource", json!({"id": sid}));
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
    }

    // ---- tracks -------------------------------------------------------------

    #[test]
    fn track_lifecycle() {
        let mut e = eng();
        expect_err(&mut e, "addTrack", json!({}));
        expect_err(&mut e, "addTrack", json!({"kind": "subtitle"}));
        let v = apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let a = apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        assert_ne!(v, a);
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 2);
        assert_eq!(describe(&e)["tracks"][1]["kind"], "audio");
        let err = expect_err(&mut e, "removeTrack", json!({"id": 55}));
        assert_eq!(err.code, ErrorCode::NotFound);
        apply(&mut e, "removeTrack", json!({"id": v})).unwrap();
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 2);
    }

    // ---- clips ---------------------------------------------------------------

    #[test]
    fn add_clip_validates_and_appends() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        // bad spans
        for bad in [
            json!({"track": tid, "source": sid, "in_s": 5.0, "out_s": 2.0}),  // in>=out
            json!({"track": tid, "source": sid, "in_s": -1.0, "out_s": 2.0}), // negative in
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 11.0}), // past source end
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "speed": 0.0}),
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "speed": 11.0}),
            json!({"track": 999, "source": sid, "in_s": 0.0, "out_s": 2.0}),
            json!({"track": tid, "source": 999, "in_s": 0.0, "out_s": 2.0}),
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0, "start_s": -1.0}),
        ] {
            let before = describe(&e);
            expect_err(&mut e, "addClip", bad);
            assert_eq!(describe(&e), before);
        }
        // default start_s = end of track (0 on empty)
        let c1 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // second clip appends at end of track → start 4.0
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 1.0, "out_s": 3.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][1]["timeline_start_s"], 4.0);
        // overlap rejected
        let before = describe(&e);
        expect_err(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 3.5}),
        );
        assert_eq!(describe(&e), before);
        // explicit gap start ok
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0, "start_s": 10.0}),
        )
        .unwrap();
        // speed affects footprint: 2s media at 2x = 1s timeline len
        let _ = (c1, c2);
    }

    #[test]
    fn move_clip_overlap() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap();
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let before = describe(&e);
        expect_err(&mut e, "moveClip", json!({"id": c2, "start_s": 3.0}));
        expect_err(&mut e, "moveClip", json!({"id": c2, "start_s": -5.0}));
        assert_eq!(describe(&e), before);
        apply(&mut e, "moveClip", json!({"id": c2, "start_s": 8.0})).unwrap();
        assert_eq!(
            describe(&e)["tracks"][0]["clips"][1]["timeline_start_s"],
            8.0
        );
        let err = expect_err(&mut e, "moveClip", json!({"id": 42, "start_s": 0.0}));
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn trim_clip() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 2.0, "out_s": 6.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "trimClip", json!({"id": c, "in_s": 3.0})).unwrap();
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][0]["in_s"], 3.0);
        assert_eq!(d["tracks"][0]["clips"][0]["out_s"], 6.0);
        // duration now 3s
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            3.0
        );
        // invalid trims leave state unchanged
        for bad in [
            json!({"id": c, "out_s": 3.0}),   // out <= in
            json!({"id": c, "out_s": 20.0}),  // beyond source
            json!({"id": c, "in_s": -0.5}),
            json!({"id": c}),                 // nothing to trim
        ] {
            let before = describe(&e);
            expect_err(&mut e, "trimClip", bad);
            assert_eq!(describe(&e), before);
        }
        // trim growth overlapping a neighbor rejected
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap(); // starts at 3.0, len 2 → ends 5
        let before = describe(&e);
        expect_err(&mut e, "trimClip", json!({"id": c, "out_s": 8.0})); // would end at 8-3=5? no: in=3,out=8 → len5, start0 → overlap c2 at 3..5
        assert_eq!(describe(&e), before);
        expect_err(&mut e, "removeClip", json!({"id": 987}));
        apply(&mut e, "removeClip", json!({"id": c2})).unwrap();
    }

    #[test]
    fn split_clip() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 8.0, "speed": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // timeline len = (8-0)/2 = 4s → clip spans 0..4
        let r = apply(&mut e, "splitClip", json!({"id": c, "at_s": 1.0})).unwrap();
        let left = r["left_id"].as_u64().unwrap();
        let right = r["right_id"].as_u64().unwrap();
        assert_eq!(left, c);
        assert_ne!(right, c);
        let d = describe(&e);
        let clips = &d["tracks"][0]["clips"];
        // split at t=1s → media point = in + 1*speed = 2.0
        assert_eq!(clips[0]["id"], left);
        assert_eq!(clips[0]["in_s"], 0.0);
        assert_eq!(clips[0]["out_s"], 2.0);
        assert_eq!(clips[1]["id"], right);
        assert_eq!(clips[1]["in_s"], 2.0);
        assert_eq!(clips[1]["out_s"], 8.0);
        assert_eq!(clips[1]["timeline_start_s"], 1.0);
        assert_eq!(clips[1]["speed"], 2.0);
        // splits outside the clip rejected
        for bad in [0.0, -1.0, 4.0, 10.0, 1.0_f64.min(0.0)] {
            let before = describe(&e);
            expect_err(&mut e, "splitClip", json!({"id": c, "at_s": bad}));
            assert_eq!(describe(&e), before);
        }
        // boundary of right half also rejected (strictly inside)
        let before = describe(&e);
        expect_err(&mut e, "splitClip", json!({"id": right, "at_s": 4.0}));
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn set_speed() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setSpeed", json!({"id": c, "speed": 2.0})).unwrap();
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            2.0
        );
        // speed growth overlapping a neighbor rejected
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 1.0}),
        )
        .unwrap(); // at t=2.0
        let before = describe(&e);
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 0.5})); // len 8 > 2 gap
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 0.05}));
        expect_err(&mut e, "setSpeed", json!({"id": c, "speed": 20.0}));
        assert_eq!(describe(&e), before);
    }

    // ---- queries -------------------------------------------------------------

    #[test]
    fn duration_and_timeline_and_render_plan() {
        let mut e = eng();
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            0.0
        );
        let (sid, tid) = setup(&mut e);
        apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0, "start_s": 2.0}),
        )
        .unwrap();
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 4.0, "out_s": 6.0, "start_s": 10.0, "speed": 2.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // clip2: 2s media at 2x → 1s footprint → timeline ends 11.0
        assert_eq!(
            apply(&mut e, "duration", json!({})).unwrap()["seconds"],
            11.0
        );
        let tl = apply(&mut e, "timeline", json!({})).unwrap();
        assert_eq!(tl["tracks"].as_array().unwrap().len(), 1);
        assert_eq!(tl["sources"][sid.to_string()]["name"], "a.mov");

        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        let clips = plan["tracks"][0].as_array().unwrap();
        assert_eq!(clips.len(), 2);
        // ordered by timeline position
        assert_eq!(clips[0]["timeline_start_s"], 2.0);
        assert_eq!(clips[0]["timeline_end_s"], 6.0);
        assert_eq!(clips[1]["clip_id"], c2);
        assert_eq!(clips[1]["timeline_start_s"], 10.0);
        assert_eq!(clips[1]["timeline_end_s"], 11.0);
        assert_eq!(clips[1]["in_s"], 4.0);
        assert_eq!(clips[1]["out_s"], 6.0);
        assert_eq!(clips[1]["speed"], 2.0);
    }

    #[test]
    fn events_emitted() {
        let mut e = eng();
        let r = apply_full(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        let kinds: Vec<&str> = r.events.iter().map(|e| e.kind.as_str()).collect();
        assert!(kinds.contains(&"document:changed"));
        assert!(kinds.contains(&"timeline:changed"));
        // read-only emits nothing
        let r = apply_full(&mut e, "duration", json!({})).unwrap();
        assert!(r.events.is_empty());
        let r = apply_full(&mut e, "renderPlan", json!({})).unwrap();
        assert!(r.events.is_empty());
    }

    // ---- undo / snapshot ------------------------------------------------------

    #[test]
    fn undo_redo_chain() {
        let mut e = eng();
        assert_eq!(e.undo().unwrap(), false);
        assert_eq!(e.redo().unwrap(), false);
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 0.0, "out_s": 4.0}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "splitClip", json!({"id": c, "at_s": 2.0})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 2);
        assert!(e.undo().unwrap()); // undo split
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap()); // undo addClip
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 0);
        assert!(e.undo().unwrap()); // undo addTrack
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 0);
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 2);
        // new apply clears redo
        assert!(e.undo().unwrap());
        apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap();
        assert_eq!(e.redo().unwrap(), false);
    }

    #[test]
    fn read_only_ops_record_no_undo() {
        let mut e = eng();
        apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        apply(&mut e, "describe", json!({})).unwrap();
        apply(&mut e, "duration", json!({})).unwrap();
        apply(&mut e, "timeline", json!({})).unwrap();
        apply(&mut e, "renderPlan", json!({})).unwrap();
        assert!(e.undo().unwrap()); // undoes addTrack only
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 0);
        assert_eq!(e.undo().unwrap(), false);
    }

    #[test]
    fn snapshot_restore_describe_equality() {
        let mut e = eng();
        let (sid, tid) = setup(&mut e);
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": tid, "source": sid, "in_s": 1.0, "out_s": 5.0, "speed": 1.5, "start_s": 0.5}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "splitClip", json!({"id": c, "at_s": 1.0})).unwrap();
        apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap();
        let snap = e.snapshot().unwrap();
        let before = describe(&e);
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), before);
        // keep mutating after restore (ids continue from restored next_id)
        let new_src = apply(&mut e2, "addSource", json!({"duration_s": 3.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert!(new_src > sid);
    }

    #[test]
    fn restore_rejects_garbage() {
        let mut e = eng();
        apply(&mut e, "addTrack", json!({"kind": "video"})).unwrap();
        let before = describe(&e);
        for bad in [
            &b""[..],
            b"NFD1\x00\x03\x00\x00\x00ab",
            b"XXXX\x00\x00\x00\x00\x00",
        ] {
            assert!(e.restore(bad).is_err());
            assert_eq!(describe(&e), before);
        }
        let wrong_shape = encode_envelope(b"12345");
        assert!(e.restore(&wrong_shape).is_err());
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn ids_monotonic_across_ops() {
        let mut e = eng();
        let (sid, _) = setup(&mut e);
        let s2 = apply(&mut e, "addSource", json!({"duration_s": 1.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert!(s2 > sid);
        // undo returns to prior next_id per spec ("restore of prior value")
        assert!(e.undo().unwrap());
        let s3 = apply(&mut e, "addSource", json!({"duration_s": 1.0}))
            .unwrap()["source_id"]
            .as_u64()
            .unwrap();
        assert_eq!(s3, s2);
    }
}
