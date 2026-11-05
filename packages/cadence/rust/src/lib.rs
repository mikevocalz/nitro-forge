//! Cadence engine — the DAW core for Nitro-Forge.
//!
//! Single source of truth for a music document: tempo, time signature,
//! tracks (midi | audio) containing clips containing notes, plus real offline
//! synthesis in the `render` op (sine oscillator, 20 ms linear attack/release,
//! velocity gain, equal-power stereo pan, track gain, mute/solo semantics).
//!
//! Contracts: docs/ARCHITECTURE.md + docs/ENGINE_OPS.md (`cadence-engine`).

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Event, HeapSize, Journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::f64::consts::PI;

const PPQ: u32 = 960;
const JOURNAL_CAPACITY: usize = 64;
const MIN_BPM: f64 = 20.0;
const MAX_BPM: f64 = 400.0;
const DEFAULT_BPM: f64 = 120.0;
const DEFAULT_VELOCITY: u8 = 100;
/// Note attack/release ramp length, seconds.
const ENVELOPE_S: f64 = 0.020;

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Midi,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Note {
    pub pitch: u8,
    pub velocity: u8,
    pub start_ticks: u64,
    pub length_ticks: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: u64,
    pub start_ticks: u64,
    pub length_ticks: u64,
    #[serde(default)]
    pub notes: Vec<Note>,
}

impl Clip {
    fn end_ticks(&self) -> u64 {
        // Saturate rather than overflow: a corrupt/huge clip end counts as
        // "extends forever" for overlap and length purposes.
        self.start_ticks.saturating_add(self.length_ticks)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: u64,
    pub name: String,
    pub kind: TrackKind,
    pub volume: f64,
    pub pan: f64,
    pub muted: bool,
    pub solo: bool,
    #[serde(default)]
    pub clips: Vec<Clip>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Doc {
    tempo_bpm: f64,
    time_sig: [u32; 2],
    ppq: u32,
    playhead_ticks: u64,
    next_id: u64,
    tracks: Vec<Track>,
}

impl Doc {
    fn fresh(tempo_bpm: f64) -> Self {
        Self {
            tempo_bpm,
            time_sig: [4, 4],
            ppq: PPQ,
            playhead_ticks: 0,
            next_id: 1,
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

    /// Locate a clip by id across all tracks → (track_idx, clip_idx).
    fn clip_location(&self, id: u64) -> Option<(usize, usize)> {
        for (ti, t) in self.tracks.iter().enumerate() {
            if let Some(ci) = t.clips.iter().position(|c| c.id == id) {
                return Some((ti, ci));
            }
        }
        None
    }

    /// Would a clip spanning [start, start+len) overlap an existing clip on the
    /// track? `exclude` skips the clip being moved/resized.
    fn overlaps(&self, track_idx: usize, start: u64, len: u64, exclude: Option<u64>) -> bool {
        let end = start.saturating_add(len);
        self.tracks[track_idx].clips.iter().any(|c| {
            Some(c.id) != exclude && start < c.end_ticks() && c.start_ticks < end
        })
    }

    fn length_ticks(&self) -> u64 {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .map(Clip::end_ticks)
            .max()
            .unwrap_or(0)
    }
}

// ---------------------------------------------------------------------------
// Payload helpers — missing/malformed fields are InvalidCommand, domain
// violations are Validation/OutOfBounds/NotFound per the shared rules.
// ---------------------------------------------------------------------------

fn req_u64(p: &Value, key: &str) -> Result<u64, EngineError> {
    p.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn req_i64(p: &Value, key: &str) -> Result<i64, EngineError> {
    p.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

/// Tick fields: must be an integer ≥ 0.
fn req_ticks(p: &Value, key: &str) -> Result<u64, EngineError> {
    match p.get(key) {
        Some(v) => {
            if let Some(u) = v.as_u64() {
                Ok(u)
            } else if v.as_f64().map(|f| f < 0.0).unwrap_or(false) {
                Err(EngineError::validation(format!("'{key}' must be >= 0")))
            } else {
                Err(EngineError::invalid(format!("missing or invalid '{key}'")))
            }
        }
        None => Err(EngineError::invalid(format!("missing or invalid '{key}'"))),
    }
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

fn req_bool(p: &Value, key: &str) -> Result<bool, EngineError> {
    p.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
}

fn req_str<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    p.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid(format!("missing or invalid '{key}'")))
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

// ---------------------------------------------------------------------------
// Base64 (ignition_core::protocol is private to ignition-core, so engines carry
// the same minimal codec locally — byte-compatible with protocol::base64_*).
// ---------------------------------------------------------------------------

const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
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

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/// DAW document engine. See ENGINE_OPS.md § `cadence-engine`.
impl HeapSize for Note {
    fn heap_size(&self) -> usize {
        0
    }
}

impl HeapSize for Clip {
    fn heap_size(&self) -> usize {
        self.notes.heap_size()
    }
}

impl HeapSize for Track {
    fn heap_size(&self) -> usize {
        self.name.heap_size() + self.clips.heap_size()
    }
}

impl HeapSize for Doc {
    fn heap_size(&self) -> usize {
        self.tracks.heap_size()
    }
}

pub struct CadenceEngine {
    doc: Doc,
    /// Undo entries are whole-doc snapshots: simple, exhaustive, and correct
    /// for a document of this size (capacity 64 per shared rules).
    journal: Journal<Doc>,
}

impl CadenceEngine {
    pub fn new() -> Self {
        Self {
            doc: Doc::fresh(DEFAULT_BPM),
            journal: Journal::new(JOURNAL_CAPACITY),
        }
    }

    /// Record undo *after* validation, immediately before mutation.
    fn record(&mut self) {
        self.journal.record(self.doc.clone());
    }

    fn changed(data: Value) -> CommandResult {
        CommandResult {
            events: vec![Event::new("document:changed", Value::Null)],
            data,
        }
    }

    fn read_only(data: Value) -> CommandResult {
        CommandResult {
            events: vec![],
            data,
        }
    }
}

impl Default for CadenceEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for CadenceEngine {
    /// Undo entries here are whole-document clones, so each is charged at the
    /// live document's size rather than walked: O(live doc), no allocation.
    fn heap_size_estimate(&self) -> usize {
        let live = self.doc.heap_size();
        // The engine itself lives in a host-owned Box.
        std::mem::size_of::<Self>()
            + live
            + self.journal.reserved_bytes()
            + self.journal.entries().count() * live
    }

    fn kind(&self) -> EngineKind {
        EngineKind::Cadence
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
            // ---- document lifecycle --------------------------------------
            "new" => {
                let bpm = opt_f64(p, "tempo_bpm")?.unwrap_or(DEFAULT_BPM);
                if !(MIN_BPM..=MAX_BPM).contains(&bpm) {
                    return Err(EngineError::validation(format!(
                        "tempo_bpm must be in {MIN_BPM}..={MAX_BPM}"
                    )));
                }
                self.record();
                self.doc = Doc::fresh(bpm);
                Ok(Self::changed(json!({ "ok": true })))
            }
            "describe" => {
                let data = serde_json::to_value(&self.doc)?;
                Ok(Self::read_only(data))
            }

            // ---- transport / tempo ---------------------------------------
            "setTempo" => {
                let bpm = req_f64(p, "bpm")?;
                if !(MIN_BPM..=MAX_BPM).contains(&bpm) {
                    return Err(EngineError::validation(format!(
                        "bpm must be in {MIN_BPM}..={MAX_BPM}"
                    )));
                }
                self.record();
                self.doc.tempo_bpm = bpm;
                Ok(Self::changed(json!({ "ok": true })))
            }
            "setTimeSig" => {
                let n = req_i64(p, "n")?;
                let d = req_i64(p, "d")?;
                if n < 1 {
                    return Err(EngineError::validation("time signature numerator must be >= 1"));
                }
                if d < 1 || !(d as u64).is_power_of_two() || d > 128 {
                    return Err(EngineError::validation(
                        "time signature denominator must be a power of two <= 128",
                    ));
                }
                if n > u32::MAX as i64 {
                    return Err(EngineError::validation(
                        "time signature numerator too large",
                    ));
                }
                self.record();
                self.doc.time_sig = [n as u32, d as u32];
                Ok(Self::changed(json!({ "ok": true })))
            }
            "transport" => {
                let to = req_ticks(p, "to_ticks")?;
                self.record();
                self.doc.playhead_ticks = to;
                Ok(Self::changed(json!({ "ok": true })))
            }

            // ---- tracks ---------------------------------------------------
            "addTrack" => {
                let name = opt_str(p, "name")?;
                let kind = match p.get("kind") {
                    None | Some(Value::Null) => TrackKind::Midi,
                    Some(Value::String(s)) if s == "midi" => TrackKind::Midi,
                    Some(Value::String(s)) if s == "audio" => TrackKind::Audio,
                    Some(_) => {
                        return Err(EngineError::validation(
                            "kind must be \"midi\" or \"audio\"",
                        ))
                    }
                };
                self.record();
                let id = self.doc.alloc_id();
                let name = name.unwrap_or_else(|| format!("Track {}", self.doc.tracks.len() + 1));
                self.doc.tracks.push(Track {
                    id,
                    name,
                    kind,
                    volume: 1.0,
                    pan: 0.0,
                    muted: false,
                    solo: false,
                    clips: Vec::new(),
                });
                Ok(Self::changed(json!({ "track_id": id })))
            }
            "removeTrack" => {
                let id = req_u64(p, "id")?;
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks.remove(idx);
                Ok(Self::changed(json!({ "ok": true })))
            }
            "renameTrack" => {
                let id = req_u64(p, "id")?;
                let name = req_str(p, "name")?.to_string();
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks[idx].name = name;
                Ok(Self::changed(json!({ "ok": true })))
            }
            "setTrackGain" => {
                let id = req_u64(p, "id")?;
                let volume = req_f64(p, "volume")?;
                if !(0.0..=1.0).contains(&volume) {
                    return Err(EngineError::validation("volume must be in 0..=1"));
                }
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks[idx].volume = volume;
                Ok(Self::changed(json!({ "ok": true })))
            }
            "setTrackPan" => {
                let id = req_u64(p, "id")?;
                let pan = req_f64(p, "pan")?;
                if !(-1.0..=1.0).contains(&pan) {
                    return Err(EngineError::validation("pan must be in -1..=1"));
                }
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks[idx].pan = pan;
                Ok(Self::changed(json!({ "ok": true })))
            }
            "setMuted" => {
                let id = req_u64(p, "id")?;
                let muted = req_bool(p, "muted")?;
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks[idx].muted = muted;
                Ok(Self::changed(json!({ "ok": true })))
            }
            "setSolo" => {
                let id = req_u64(p, "id")?;
                let solo = req_bool(p, "solo")?;
                let idx = self
                    .doc
                    .track_index(id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {id}")))?;
                self.record();
                self.doc.tracks[idx].solo = solo;
                Ok(Self::changed(json!({ "ok": true })))
            }

            // ---- clips ----------------------------------------------------
            "addClip" => {
                let track_id = req_u64(p, "track")?;
                let start = req_ticks(p, "start_ticks")?;
                let len = req_ticks(p, "length_ticks")?;
                if len == 0 {
                    return Err(EngineError::validation("length_ticks must be > 0"));
                }
                let ti = self
                    .doc
                    .track_index(track_id)
                    .ok_or_else(|| EngineError::not_found(format!("no track {track_id}")))?;
                if self.doc.overlaps(ti, start, len, None) {
                    return Err(EngineError::validation(
                        "clip overlaps an existing clip on this track",
                    ));
                }
                self.record();
                let id = self.doc.alloc_id();
                self.doc.tracks[ti].clips.push(Clip {
                    id,
                    start_ticks: start,
                    length_ticks: len,
                    notes: Vec::new(),
                });
                // Keep clips in timeline order for deterministic describe/render.
                self.doc.tracks[ti]
                    .clips
                    .sort_by_key(|c| c.start_ticks);
                Ok(Self::changed(json!({ "clip_id": id })))
            }
            "removeClip" => {
                let id = req_u64(p, "id")?;
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                self.record();
                self.doc.tracks[ti].clips.remove(ci);
                Ok(Self::changed(json!({ "ok": true })))
            }
            "moveClip" => {
                let id = req_u64(p, "id")?;
                let start = req_ticks(p, "start_ticks")?;
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let len = self.doc.tracks[ti].clips[ci].length_ticks;
                if self.doc.overlaps(ti, start, len, Some(id)) {
                    return Err(EngineError::validation(
                        "move would overlap an existing clip on this track",
                    ));
                }
                self.record();
                self.doc.tracks[ti].clips[ci].start_ticks = start;
                self.doc.tracks[ti].clips.sort_by_key(|c| c.start_ticks);
                Ok(Self::changed(json!({ "ok": true })))
            }
            "resizeClip" => {
                let id = req_u64(p, "id")?;
                let len = req_ticks(p, "length_ticks")?;
                if len == 0 {
                    return Err(EngineError::validation("length_ticks must be > 0"));
                }
                let (ti, ci) = self
                    .doc
                    .clip_location(id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {id}")))?;
                let start = self.doc.tracks[ti].clips[ci].start_ticks;
                if self.doc.overlaps(ti, start, len, Some(id)) {
                    return Err(EngineError::validation(
                        "resize would overlap an existing clip on this track",
                    ));
                }
                self.record();
                let clip = &mut self.doc.tracks[ti].clips[ci];
                clip.length_ticks = len;
                // Notes outside the new bounds are trimmed/dropped.
                clip.notes.retain(|n| n.start_ticks < len);
                for n in &mut clip.notes {
                    if n.start_ticks.saturating_add(n.length_ticks) > len {
                        n.length_ticks = len - n.start_ticks;
                    }
                }
                Ok(Self::changed(json!({ "ok": true })))
            }

            // ---- notes ----------------------------------------------------
            "addNote" => {
                let clip_id = req_u64(p, "clip")?;
                let pitch = req_i64(p, "pitch")?;
                let velocity = match p.get("velocity") {
                    None | Some(Value::Null) => DEFAULT_VELOCITY,
                    Some(v) => {
                        let vel = v
                            .as_i64()
                            .ok_or_else(|| EngineError::invalid("invalid 'velocity'"))?;
                        if !(0..=127).contains(&vel) {
                            return Err(EngineError::validation("velocity must be in 0..=127"));
                        }
                        vel as u8
                    }
                };
                let start = req_ticks(p, "start_ticks")?;
                let len = req_ticks(p, "length_ticks")?;
                if !(0..=127).contains(&pitch) {
                    return Err(EngineError::validation("pitch must be in 0..=127"));
                }
                if len == 0 {
                    return Err(EngineError::validation("length_ticks must be > 0"));
                }
                let (ti, ci) = self
                    .doc
                    .clip_location(clip_id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {clip_id}")))?;
                if self.doc.tracks[ti].kind != TrackKind::Midi {
                    return Err(EngineError::validation(
                        "addNote requires a clip on a midi track",
                    ));
                }
                if start.saturating_add(len) > self.doc.tracks[ti].clips[ci].length_ticks {
                    return Err(EngineError::out_of_bounds(
                        "note extends past the end of the clip",
                    ));
                }
                self.record();
                let notes = &mut self.doc.tracks[ti].clips[ci].notes;
                let index = notes.len();
                notes.push(Note {
                    pitch: pitch as u8,
                    velocity,
                    start_ticks: start,
                    length_ticks: len,
                });
                Ok(Self::changed(json!({ "index": index })))
            }
            "removeNote" => {
                let clip_id = req_u64(p, "clip")?;
                let index = req_u64(p, "index")?;
                let (ti, ci) = self
                    .doc
                    .clip_location(clip_id)
                    .ok_or_else(|| EngineError::not_found(format!("no clip {clip_id}")))?;
                if index >= self.doc.tracks[ti].clips[ci].notes.len() as u64 {
                    return Err(EngineError::out_of_bounds(format!(
                        "note index {index} out of range"
                    )));
                }
                self.record();
                self.doc.tracks[ti].clips[ci].notes.remove(index as usize);
                Ok(Self::changed(json!({ "ok": true })))
            }

            // ---- queries --------------------------------------------------
            "project" => {
                let clips: usize = self.doc.tracks.iter().map(|t| t.clips.len()).sum();
                let notes: usize = self
                    .doc
                    .tracks
                    .iter()
                    .flat_map(|t| t.clips.iter())
                    .map(|c| c.notes.len())
                    .sum();
                Ok(Self::read_only(json!({
                    "tempo_bpm": self.doc.tempo_bpm,
                    "time_sig": self.doc.time_sig,
                    "ppq": self.doc.ppq,
                    "playhead_ticks": self.doc.playhead_ticks,
                    "track_count": self.doc.tracks.len(),
                    "clip_count": clips,
                    "note_count": notes,
                    "length_ticks": self.doc.length_ticks(),
                })))
            }
            "render" => {
                let from = req_ticks(p, "from_ticks")?;
                let to = req_ticks(p, "to_ticks")?;
                let sample_rate = req_u64(p, "sample_rate")?;
                if to <= from {
                    return Err(EngineError::validation("to_ticks must be > from_ticks"));
                }
                if sample_rate == 0 {
                    return Err(EngineError::validation("sample_rate must be > 0"));
                }
                let (bytes, frames) = render_audio(&self.doc, from, to, sample_rate)?;
                Ok(Self::read_only(json!({
                    "samples_b64": base64_encode(&bytes),
                    "frames": frames,
                    "channels": 2,
                })))
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
        // A stale snapshot can carry a next_id below live ids → collisions.
        let max_id = doc
            .tracks
            .iter()
            .map(|t| t.id)
            .chain(doc.tracks.iter().flat_map(|t| t.clips.iter().map(|c| c.id)))
            .max()
            .unwrap_or(0);
        doc.next_id = doc.next_id.max(max_id.saturating_add(1));
        // Commit only after the payload fully decoded; document is a new
        // session state, so undo history is reset.
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
// Offline render — sine-oscillator mixdown, f32le stereo interleaved.
// ---------------------------------------------------------------------------

/// Synthesize `[from_ticks, to_ticks)` into interleaved f32 stereo frames.
/// Sample-accurate: note boundaries are converted to fractional sample
/// positions via `seconds = ticks / (ppq * bpm / 60)`; a note contributes to
/// output frame `i` while `i` falls inside its (fractional) sample span.
fn render_audio(
    doc: &Doc,
    from_ticks: u64,
    to_ticks: u64,
    sample_rate: u64,
) -> Result<(Vec<u8>, usize), EngineError> {
    let sr = sample_rate as f64;
    let seconds_per_tick = 60.0 / (doc.ppq as f64 * doc.tempo_bpm);
    let frames = ((to_ticks - from_ticks) as f64 * seconds_per_tick * sr).round();
    if frames > (usize::MAX / 16) as f64 {
        return Err(EngineError::validation("render range too large"));
    }
    let frames = frames as usize;
    let mut mix = vec![0.0f64; frames * 2];

    let any_solo = doc.tracks.iter().any(|t| t.solo);
    let ramp_samples = ENVELOPE_S * sr;

    for track in &doc.tracks {
        // Solo takes precedence over mute: with any soloed track only soloed
        // tracks sound; otherwise every non-muted track sounds.
        let audible = if any_solo { track.solo } else { !track.muted };
        if !audible {
            continue;
        }
        // Equal-power pan: pan -1..1 → angle 0..π/2.
        let angle = (track.pan.clamp(-1.0, 1.0) + 1.0) * PI / 4.0;
        let gain_l = angle.cos() * track.volume;
        let gain_r = angle.sin() * track.volume;

        for clip in &track.clips {
            let clip_start = clip.start_ticks;
            let clip_end = clip.end_ticks();
            if clip_end <= from_ticks || clip_start >= to_ticks {
                continue;
            }
            for note in &clip.notes {
                let note_start = clip_start.saturating_add(note.start_ticks);
                // Clip the note's sounding end to the clip boundary.
                let note_end = note_start.saturating_add(note.length_ticks).min(clip_end);
                if note_end <= note_start {
                    continue;
                }
                // Fractional sample positions relative to the render window.
                let s0 = (note_start as f64 - from_ticks as f64) * seconds_per_tick * sr;
                let s1 = (note_end as f64 - from_ticks as f64) * seconds_per_tick * sr;
                let i0 = s0.ceil().max(0.0) as usize;
                let i1 = s1.ceil().min(frames as f64) as usize;
                if i0 >= i1 {
                    continue;
                }
                let freq = 440.0 * 2f64.powf((note.pitch as f64 - 69.0) / 12.0);
                let vel = note.velocity as f64 / 127.0;
                for i in i0..i1 {
                    let x = i as f64 - s0; // samples since note-on (fractional)
                    let attack = if x < ramp_samples {
                        (x / ramp_samples).max(0.0)
                    } else {
                        1.0
                    };
                    let rel = s1 - i as f64;
                    let release = if rel < ramp_samples {
                        (rel / ramp_samples).max(0.0)
                    } else {
                        1.0
                    };
                    let env = attack.min(release);
                    let s = (2.0 * PI * freq * x / sr).sin() * env * vel;
                    mix[i * 2] += s * gain_l;
                    mix[i * 2 + 1] += s * gain_r;
                }
            }
        }
    }

    let mut bytes = Vec::with_capacity(frames * 8);
    for v in &mix {
        bytes.extend_from_slice(&(*v as f32).to_le_bytes());
    }
    Ok((bytes, frames))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
    use serde_json::json;

    fn eng() -> CadenceEngine {
        CadenceEngine::new()
    }

    fn apply(e: &mut CadenceEngine, op: &str, payload: Value) -> Result<Value, EngineError> {
        e.apply(Command::new(op, payload)).map(|r| r.data)
    }

    fn expect_err(e: &mut CadenceEngine, op: &str, payload: Value) -> EngineError {
        e.apply(Command::new(op, payload)).unwrap_err()
    }

    fn describe(e: &CadenceEngine) -> Value {
        let mut e2 = CadenceEngine {
            doc: e.doc.clone(),
            journal: Journal::new(JOURNAL_CAPACITY),
        };
        apply(&mut e2, "describe", json!({})).unwrap()
    }

    fn b64_decode(s: &str) -> Vec<u8> {
        let mut table = [255u8; 256];
        for (i, &c) in B64_ALPHABET.iter().enumerate() {
            table[c as usize] = i as u8;
        }
        let s = s.trim_end_matches('=');
        let mut out = Vec::new();
        let mut acc = 0u32;
        let mut bits = 0u32;
        for &c in s.as_bytes() {
            let v = table[c as usize];
            assert!(v != 255, "bad base64 char");
            acc = (acc << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((acc >> bits) as u8);
            }
        }
        out
    }

    fn f32s(b: &[u8]) -> Vec<f32> {
        b.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    }

    /// Build a doc: one midi track (id returned), one clip [0, 960) with notes.
    fn doc_with_clip(e: &mut CadenceEngine) -> (u64, u64) {
        let tid = apply(e, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let cid = apply(
            e,
            "addClip",
            json!({"track": tid, "start_ticks": 0, "length_ticks": 960}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        (tid, cid)
    }

    // ---- basics -----------------------------------------------------------

    #[test]
    fn new_defaults_and_describe() {
        let mut e = eng();
        let d = describe(&e);
        assert_eq!(d["tempo_bpm"], 120.0);
        assert_eq!(d["time_sig"], json!([4, 4]));
        assert_eq!(d["ppq"], 960);
        assert_eq!(d["tracks"], json!([]));

        apply(&mut e, "new", json!({"tempo_bpm": 90.0})).unwrap();
        assert_eq!(describe(&e)["tempo_bpm"], 90.0);
        assert_eq!(e.kind(), EngineKind::Cadence);
    }

    #[test]
    fn unknown_op_and_bad_version() {
        let mut e = eng();
        let err = expect_err(&mut e, "bogus", json!({}));
        assert_eq!(err.code, ErrorCode::InvalidCommand);
        let mut cmd = Command::new("describe", json!({}));
        cmd.v = 2;
        let err = e.apply(cmd).unwrap_err();
        assert_eq!(err.code, ErrorCode::Unsupported);
    }

    #[test]
    fn set_tempo_validates() {
        let mut e = eng();
        apply(&mut e, "setTempo", json!({"bpm": 140.0})).unwrap();
        assert_eq!(describe(&e)["tempo_bpm"], 140.0);
        for bad in [json!({"bpm": 5.0}), json!({"bpm": 401.0}), json!({}), json!({"bpm":"x"})] {
            let before = describe(&e);
            assert!(expect_err(&mut e, "setTempo", bad).code != ErrorCode::NotFound);
            assert_eq!(describe(&e), before, "state changed on invalid setTempo");
        }
    }

    #[test]
    fn set_time_sig_validates_denominator() {
        let mut e = eng();
        apply(&mut e, "setTimeSig", json!({"n": 6, "d": 8})).unwrap();
        assert_eq!(describe(&e)["time_sig"], json!([6, 8]));
        for bad in [json!({"n":3,"d":3}), json!({"n":0,"d":4}), json!({"n":4,"d":0})] {
            let before = describe(&e);
            expect_err(&mut e, "setTimeSig", bad);
            assert_eq!(describe(&e), before);
        }
    }

    #[test]
    fn transport_moves_playhead() {
        let mut e = eng();
        apply(&mut e, "transport", json!({"to_ticks": 480})).unwrap();
        assert_eq!(describe(&e)["playhead_ticks"], 480);
        let before = describe(&e);
        expect_err(&mut e, "transport", json!({"to_ticks": -1}));
        assert_eq!(describe(&e), before);
    }

    // ---- tracks -----------------------------------------------------------

    #[test]
    fn track_crud() {
        let mut e = eng();
        let t1 = apply(&mut e, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let t2 = apply(&mut e, "addTrack", json!({"name":"Keys","kind":"audio"}))
            .unwrap()["track_id"]
            .as_u64()
            .unwrap();
        assert_ne!(t1, t2);
        let d = describe(&e);
        assert_eq!(d["tracks"].as_array().unwrap().len(), 2);
        assert_eq!(d["tracks"][0]["kind"], "midi");
        assert_eq!(d["tracks"][1]["kind"], "audio");
        assert_eq!(d["tracks"][1]["name"], "Keys");

        let before = describe(&e);
        expect_err(&mut e, "addTrack", json!({"kind": "flugelhorn"}));
        assert_eq!(describe(&e), before);

        apply(&mut e, "renameTrack", json!({"id": t1, "name": "Drums"})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["name"], "Drums");

        let err = expect_err(&mut e, "removeTrack", json!({"id": 999}));
        assert_eq!(err.code, ErrorCode::NotFound);
        apply(&mut e, "removeTrack", json!({"id": t2})).unwrap();
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 1);
        // undo restores the removed track
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn track_mix_fields_validate() {
        let mut e = eng();
        let t = apply(&mut e, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setTrackGain", json!({"id": t, "volume": 0.5})).unwrap();
        apply(&mut e, "setTrackPan", json!({"id": t, "pan": -0.5})).unwrap();
        apply(&mut e, "setMuted", json!({"id": t, "muted": true})).unwrap();
        apply(&mut e, "setSolo", json!({"id": t, "solo": true})).unwrap();
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["volume"], 0.5);
        assert_eq!(d["tracks"][0]["pan"], -0.5);
        assert_eq!(d["tracks"][0]["muted"], true);
        assert_eq!(d["tracks"][0]["solo"], true);

        for (op, bad) in [
            ("setTrackGain", json!({"id": t, "volume": 1.5})),
            ("setTrackGain", json!({"id": t, "volume": -0.1})),
            ("setTrackPan", json!({"id": t, "pan": 2.0})),
            ("setMuted", json!({"id": 999, "muted": true})),
            ("setSolo", json!({"id": t})),
        ] {
            let before = describe(&e);
            expect_err(&mut e, op, bad);
            assert_eq!(describe(&e), before, "{op} mutated state on error");
        }
    }

    // ---- clips ------------------------------------------------------------

    #[test]
    fn clip_overlap_rejected() {
        let mut e = eng();
        let (t, c1) = doc_with_clip(&mut e);
        // overlapping add
        let before = describe(&e);
        let err = expect_err(
            &mut e,
            "addClip",
            json!({"track": t, "start_ticks": 480, "length_ticks": 960}),
        );
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
        // adjacent (touching) is fine
        let c2 = apply(
            &mut e,
            "addClip",
            json!({"track": t, "start_ticks": 960, "length_ticks": 960}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        // moving c2 back over c1 rejected
        let before = describe(&e);
        expect_err(&mut e, "moveClip", json!({"id": c2, "start_ticks": 100}));
        assert_eq!(describe(&e), before);
        apply(&mut e, "moveClip", json!({"id": c2, "start_ticks": 1920})).unwrap();
        // clips remain sorted by start
        let d = describe(&e);
        assert_eq!(d["tracks"][0]["clips"][0]["id"], c1);
        assert_eq!(d["tracks"][0]["clips"][1]["id"], c2);
        // overlap across *different* tracks is legal
        let t2 = apply(&mut e, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({"track": t2, "start_ticks": 0, "length_ticks": 960}),
        )
        .unwrap();
        // removeClip
        let err = expect_err(&mut e, "removeClip", json!({"id": 424242}));
        assert_eq!(err.code, ErrorCode::NotFound);
        apply(&mut e, "removeClip", json!({"id": c2})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn resize_clip_trims_notes() {
        let mut e = eng();
        let (t, c) = doc_with_clip(&mut e);
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 60, "start_ticks": 0, "length_ticks": 480}),
        )
        .unwrap();
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 64, "start_ticks": 480, "length_ticks": 480}),
        )
        .unwrap();
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 67, "start_ticks": 240, "length_ticks": 480}),
        )
        .unwrap();
        apply(&mut e, "resizeClip", json!({"id": c, "length_ticks": 480})).unwrap();
        let d = describe(&e);
        let notes = d["tracks"][0]["clips"][0]["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 2); // note at 480 dropped
        assert_eq!(notes[1]["length_ticks"], 240); // straddler clamped
        // growing again must not overlap a following clip
        apply(
            &mut e,
            "addClip",
            json!({"track": t, "start_ticks": 480, "length_ticks": 480}),
        )
        .unwrap();
        let before = describe(&e);
        expect_err(&mut e, "resizeClip", json!({"id": c, "length_ticks": 481}));
        assert_eq!(describe(&e), before);
    }

    // ---- notes ------------------------------------------------------------

    #[test]
    fn note_ops() {
        let mut e = eng();
        let (_, c) = doc_with_clip(&mut e);
        let i0 = apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 60, "velocity": 100, "start_ticks": 0, "length_ticks": 240}),
        )
        .unwrap()["index"]
            .as_u64()
            .unwrap();
        assert_eq!(i0, 0);
        // default velocity
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 62, "start_ticks": 240, "length_ticks": 240}),
        )
        .unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"][0]["notes"][1]["velocity"], 100);

        for bad in [
            json!({"clip": c, "pitch": 128, "start_ticks": 0, "length_ticks": 10}),
            json!({"clip": c, "pitch": -1, "start_ticks": 0, "length_ticks": 10}),
            json!({"clip": c, "pitch": 60, "velocity": 200, "start_ticks": 0, "length_ticks": 10}),
            json!({"clip": c, "pitch": 60, "start_ticks": 900, "length_ticks": 100}), // past end
            json!({"clip": c, "pitch": 60, "start_ticks": 0, "length_ticks": 0}),
        ] {
            let before = describe(&e);
            expect_err(&mut e, "addNote", bad);
            assert_eq!(describe(&e), before);
        }
        let err = expect_err(&mut e, "removeNote", json!({"clip": c, "index": 5}));
        assert_eq!(err.code, ErrorCode::OutOfBounds);
        apply(&mut e, "removeNote", json!({"clip": c, "index": 0})).unwrap();
        assert_eq!(describe(&e)["tracks"][0]["clips"][0]["notes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn add_note_rejects_audio_track() {
        let mut e = eng();
        let t = apply(&mut e, "addTrack", json!({"kind": "audio"})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let c = apply(
            &mut e,
            "addClip",
            json!({"track": t, "start_ticks": 0, "length_ticks": 960}),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        let before = describe(&e);
        let err = expect_err(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 60, "start_ticks": 0, "length_ticks": 240}),
        );
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(describe(&e), before);
    }

    // ---- project ----------------------------------------------------------

    #[test]
    fn project_meta() {
        let mut e = eng();
        let (t, c) = doc_with_clip(&mut e);
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 60, "start_ticks": 0, "length_ticks": 240}),
        )
        .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({"track": t, "start_ticks": 960, "length_ticks": 480}),
        )
        .unwrap();
        let d = apply(&mut e, "project", json!({})).unwrap();
        assert_eq!(d["track_count"], 1);
        assert_eq!(d["clip_count"], 2);
        assert_eq!(d["note_count"], 1);
        assert_eq!(d["length_ticks"], 1440);
        assert_eq!(d["tempo_bpm"], 120.0);
    }

    // ---- render -----------------------------------------------------------

    #[test]
    fn render_silence_and_length() {
        let mut e = eng();
        let (_, _) = doc_with_clip(&mut e); // clip with no notes
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        assert_eq!(r["channels"], 2);
        // 960 ticks @ 120bpm, ppq 960 = 1 quarter = 0.5 s = 24000 frames
        assert_eq!(r["frames"], 24000);
        let bytes = b64_decode(r["samples_b64"].as_str().unwrap());
        assert_eq!(bytes.len(), 24000 * 8);
        assert!(f32s(&bytes).iter().all(|&v| v == 0.0));
    }

    #[test]
    fn render_note_produces_sine() {
        let mut e = eng();
        let (_, c) = doc_with_clip(&mut e);
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 69, "velocity": 127, "start_ticks": 0, "length_ticks": 960}),
        )
        .unwrap();
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        let s = f32s(&b64_decode(r["samples_b64"].as_str().unwrap()));
        let frames = r["frames"].as_u64().unwrap() as usize;
        assert_eq!(s.len(), frames * 2);
        // mid-note (well past the 20ms attack): steady-state amplitude ≈ vel * pan gain
        let mid = frames / 2;
        // find peak magnitude in a window around mid
        let mut peak = 0.0f32;
        for i in mid - 240..mid + 240 {
            peak = peak.max(s[i * 2].abs());
        }
        let expected = (std::f32::consts::PI / 4.0).cos(); // center pan gain ≈ 0.7071
        assert!((peak - expected).abs() < 0.02, "peak {peak} ≈ {expected}");
        // stereo identical at center pan
        for i in [mid - 100, mid, mid + 100] {
            assert!((s[i * 2] - s[i * 2 + 1]).abs() < 1e-6);
        }
        // attack: sample 0 is silence, early samples ramp up
        assert!(s[0] == 0.0);
        let late_attack = s[(0.01 * 48000.0) as usize * 2].abs();
        let steady = s[mid * 2].abs();
        assert!(late_attack < steady || steady < 0.1); // phase may cross zero; just check envelope ramp indirectly
        // release tail ends at silence
        let tail = s[(frames - 2) * 2].abs();
        assert!(tail < 0.05, "release tail {tail}");
    }

    #[test]
    fn render_mute_solo_pan() {
        let mut e = eng();
        let (t1, c1) = doc_with_clip(&mut e);
        apply(
            &mut e,
            "addNote",
            json!({"clip": c1, "pitch": 69, "velocity": 127, "start_ticks": 0, "length_ticks": 960}),
        )
        .unwrap();
        // muted → silence
        apply(&mut e, "setMuted", json!({"id": t1, "muted": true})).unwrap();
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        assert!(f32s(&b64_decode(r["samples_b64"].as_str().unwrap()))
            .iter()
            .all(|&v| v == 0.0));
        // solo overrides mute
        apply(&mut e, "setSolo", json!({"id": t1, "solo": true})).unwrap();
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        assert!(f32s(&b64_decode(r["samples_b64"].as_str().unwrap()))
            .iter()
            .any(|&v| v != 0.0));
        // hard right pan → left channel ~0
        apply(&mut e, "setSolo", json!({"id": t1, "solo": false})).unwrap();
        apply(&mut e, "setMuted", json!({"id": t1, "muted": false})).unwrap();
        apply(&mut e, "setTrackPan", json!({"id": t1, "pan": 1.0})).unwrap();
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        let s = f32s(&b64_decode(r["samples_b64"].as_str().unwrap()));
        let mut l = 0f32;
        let mut rr = 0f32;
        for i in 0..s.len() / 2 {
            l = l.max(s[i * 2].abs());
            rr = rr.max(s[i * 2 + 1].abs());
        }
        assert!(l < 1e-6, "left {l}");
        assert!(rr > 0.5, "right {rr}");
        // volume 0 → silence
        apply(&mut e, "setTrackPan", json!({"id": t1, "pan": 0.0})).unwrap();
        apply(&mut e, "setTrackGain", json!({"id": t1, "volume": 0.0})).unwrap();
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        assert!(f32s(&b64_decode(r["samples_b64"].as_str().unwrap()))
            .iter()
            .all(|&v| v == 0.0));
    }

    #[test]
    fn render_partial_window_and_validation() {
        let mut e = eng();
        let (_, c) = doc_with_clip(&mut e);
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 69, "start_ticks": 480, "length_ticks": 480}),
        )
        .unwrap();
        // render only the second half of the clip — note starts at its start
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 480, "to_ticks": 960, "sample_rate": 48000}),
        )
        .unwrap();
        let s = f32s(&b64_decode(r["samples_b64"].as_str().unwrap()));
        assert!(s.iter().any(|&v| v != 0.0));
        // render only the first half — no notes in window → silence
        let r = apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 480, "sample_rate": 48000}),
        )
        .unwrap();
        assert!(f32s(&b64_decode(r["samples_b64"].as_str().unwrap()))
            .iter()
            .all(|&v| v == 0.0));
        // bad ranges
        expect_err(
            &mut e,
            "render",
            json!({"from_ticks": 960, "to_ticks": 960, "sample_rate": 48000}),
        );
        expect_err(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 0}),
        );
    }

    // ---- undo / redo --------------------------------------------------------

    #[test]
    fn undo_redo_chain() {
        let mut e = eng();
        assert_eq!(e.undo().unwrap(), false);
        assert_eq!(e.redo().unwrap(), false);
        apply(&mut e, "setTempo", json!({"bpm": 140.0})).unwrap();
        let t = apply(&mut e, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setTrackGain", json!({"id": t, "volume": 0.25})).unwrap();
        // undo gain → volume back to 1.0
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"][0]["volume"], 1.0);
        // undo addTrack → empty
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 0);
        // undo setTempo
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tempo_bpm"], 120.0);
        assert_eq!(e.undo().unwrap(), false);
        // redo all the way forward
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        assert_eq!(describe(&e)["tracks"][0]["volume"], 0.25);
        assert_eq!(e.redo().unwrap(), false);
        // a new apply clears the redo stack
        assert!(e.undo().unwrap());
        apply(&mut e, "setTempo", json!({"bpm": 100.0})).unwrap();
        assert_eq!(e.redo().unwrap(), false);
    }

    #[test]
    fn read_only_ops_record_no_undo() {
        let mut e = eng();
        apply(&mut e, "setTempo", json!({"bpm": 99.0})).unwrap();
        apply(&mut e, "describe", json!({})).unwrap();
        apply(&mut e, "project", json!({})).unwrap();
        apply(
            &mut e,
            "render",
            json!({"from_ticks": 0, "to_ticks": 960, "sample_rate": 8000}),
        )
        .unwrap();
        // exactly one undo step exists (setTempo)
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tempo_bpm"], 120.0);
        assert_eq!(e.undo().unwrap(), false);
    }

    // ---- snapshot / restore -------------------------------------------------

    #[test]
    fn snapshot_restore_describe_equality() {
        let mut e = eng();
        apply(&mut e, "setTempo", json!({"bpm": 133.0})).unwrap();
        apply(&mut e, "setTimeSig", json!({"n": 7, "d": 8})).unwrap();
        apply(&mut e, "transport", json!({"to_ticks": 1234})).unwrap();
        let (t, c) = doc_with_clip(&mut e);
        apply(&mut e, "setTrackPan", json!({"id": t, "pan": 0.5})).unwrap();
        apply(
            &mut e,
            "addNote",
            json!({"clip": c, "pitch": 72, "velocity": 90, "start_ticks": 10, "length_ticks": 200}),
        )
        .unwrap();
        apply(
            &mut e,
            "addTrack",
            json!({"name": "Bass", "kind": "audio"}),
        )
        .unwrap();

        let snap = e.snapshot().unwrap();
        let before = describe(&e);
        let mut e2 = eng();
        e2.restore(&snap).unwrap();
        assert_eq!(describe(&e2), before, "snapshot→restore→describe mismatch");

        // round-trip: restore then keep mutating
        let t3 = apply(&mut e2, "addTrack", json!({})).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        assert!(t3 > 0);
        assert_eq!(describe(&e2)["tracks"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn restore_rejects_garbage_and_keeps_state() {
        let mut e = eng();
        apply(&mut e, "setTempo", json!({"bpm": 88.0})).unwrap();
        let before = describe(&e);
        for bad in [
            &b""[..],
            b"XXXX\x00\x00\x00\x00\x00",
            b"NFD1\x00\x03\x00\x00\x00ab",
            b"NFD1\x07\x00\x00\x00\x00",
        ] {
            assert!(e.restore(bad).is_err());
            assert_eq!(describe(&e), before);
        }
        // valid envelope, non-doc payload
        let bad_payload = encode_envelope(b"\"not a doc\"");
        assert!(e.restore(&bad_payload).is_err());
        assert_eq!(describe(&e), before);
    }

    #[test]
    fn new_op_resets_document() {
        let mut e = eng();
        apply(&mut e, "addTrack", json!({})).unwrap();
        apply(&mut e, "new", json!({"tempo_bpm": 150.0})).unwrap();
        let d = describe(&e);
        assert_eq!(d["tempo_bpm"], 150.0);
        assert_eq!(d["tracks"].as_array().unwrap().len(), 0);
        // undo of new restores the prior document
        assert!(e.undo().unwrap());
        assert_eq!(describe(&e)["tracks"].as_array().unwrap().len(), 1);
    }
}
