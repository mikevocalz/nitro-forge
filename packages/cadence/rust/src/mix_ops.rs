//! Mixer, routing, insert, group, automation, batch-note and analysis ops.
//! Each mutating op validates its whole payload before recording one undo
//! step, so a rejected command leaves the document untouched and an
//! accepted one undoes in one step.

use crate::analysis::{self, BeatOptions, SpectroOptions};
use crate::dsp::{compressor_out_db, eq_response_db};
use crate::mixer_model::{
    AutomationMode, AutomationParam, AutomationPoint, Effect, Insert, Send, MAX_GROUP_NAME,
    MAX_INSERTS,
};
use crate::presets;
use crate::render::{mixdown, mixdown_with_context};
use crate::{
    opt_f64, req_bool, req_f64, req_str, req_ticks, req_u64, CadenceEngine, TrackKind,
};
use ignition_core::{CommandResult, EngineError, TaskContext};
use serde_json::{json, Value};

type OpResult = Result<CommandResult, EngineError>;

fn not_found_track(id: u64) -> EngineError {
    EngineError::not_found(format!("no track {id}"))
}

fn unit(p: &Value, key: &str, min: f64, max: f64) -> Result<f64, EngineError> {
    let v = req_f64(p, key)?;
    if !(min..=max).contains(&v) {
        return Err(EngineError::validation(format!("{key} must be in {min}..={max}")));
    }
    Ok(v)
}

fn opt_bool(p: &Value, key: &str) -> Result<Option<bool>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_bool().map(Some).ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
    }
}

/// Group name: `null` clears, otherwise 1..=64 bytes after trimming.
fn group_name(p: &Value) -> Result<Option<String>, EngineError> {
    match p.get("group") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim();
            if s.is_empty() || s.len() > MAX_GROUP_NAME {
                return Err(EngineError::validation(format!(
                    "group must be 1..={MAX_GROUP_NAME} bytes, or null to clear"
                )));
            }
            Ok(Some(s.to_string()))
        }
        _ => Err(EngineError::invalid("missing or invalid 'group'")),
    }
}

/// Render-range payload shared by the analysis ops.
fn range(p: &Value) -> Result<(u64, u64, u64, bool), EngineError> {
    let from = req_ticks(p, "from_ticks")?;
    let to = req_ticks(p, "to_ticks")?;
    let sample_rate = req_u64(p, "sample_rate")?;
    if to <= from {
        return Err(EngineError::validation("to_ticks must be > from_ticks"));
    }
    if !(8000..=192_000).contains(&sample_rate) {
        return Err(EngineError::validation("sample_rate must be in 8000..=192000"));
    }
    let click = opt_bool(p, "include_metronome")?.unwrap_or(false);
    Ok((from, to, sample_rate, click))
}

impl CadenceEngine {
    fn track_idx(&self, p: &Value, key: &str) -> Result<usize, EngineError> {
        let id = req_u64(p, key)?;
        self.doc.track_index(id).ok_or_else(|| not_found_track(id))
    }

    fn bus_idx(&self, id: u64) -> Result<usize, EngineError> {
        let i = self.doc.track_index(id).ok_or_else(|| not_found_track(id))?;
        if self.doc.tracks[i].kind != TrackKind::Bus {
            return Err(EngineError::validation(format!("track {id} is not a bus")));
        }
        Ok(i)
    }

    fn source_idx(&self, p: &Value, key: &str) -> Result<usize, EngineError> {
        let i = self.track_idx(p, key)?;
        if self.doc.tracks[i].kind == TrackKind::Bus {
            return Err(EngineError::validation(
                "buses feed the master only; route source tracks into a bus",
            ));
        }
        Ok(i)
    }

    /// Locate an insert by id → (track_idx, slot).
    fn insert_location(&self, p: &Value) -> Result<(usize, usize), EngineError> {
        let id = req_u64(p, "id")?;
        for (ti, t) in self.doc.tracks.iter().enumerate() {
            if let Some(si) = t.inserts.iter().position(|i| i.id == id) {
                return Ok((ti, si));
            }
        }
        Err(EngineError::not_found(format!("no insert {id}")))
    }

    fn lane_target(&self, p: &Value) -> Result<(usize, AutomationParam), EngineError> {
        let ti = self.track_idx(p, "track")?;
        let param = AutomationParam::parse(req_str(p, "param")?)?;
        Ok((ti, param))
    }

    /// Mixer-family ops; `None` when `op` is not one of them.
    pub(crate) fn apply_mixer(&mut self, op: &str, p: &Value) -> Option<OpResult> {
        let r = match op {
            // ---- routing ------------------------------------------------
            "setTrackOutput" => self.set_track_output(p),
            "setSend" => self.set_send(p),
            "removeSend" => self.remove_send(p),
            // ---- inserts ------------------------------------------------
            "addInsert" => self.add_insert(p),
            "removeInsert" => self.remove_insert(p),
            "moveInsert" => self.move_insert(p),
            "setInsertBypass" => self.set_insert_bypass(p),
            "setInsertParams" => self.set_insert_params(p),
            "applyInsertPreset" => self.apply_insert_preset(p),
            "insertPresets" => presets::list(p).map(Self::read_only),
            "eqResponse" => self.eq_response(p),
            "dynamicsCurve" => self.dynamics_curve(p),
            // ---- groups and solo ----------------------------------------
            "setTrackGroup" => self.set_track_group(p),
            "setGroupSolo" => self.set_group_flag(p, "solo"),
            "setGroupMuted" => self.set_group_flag(p, "muted"),
            "setSoloSafe" => self.set_solo_safe(p),
            // ---- automation ---------------------------------------------
            "addAutomationPoint" => self.add_automation_point(p),
            "moveAutomationPoint" => self.move_automation_point(p),
            "removeAutomationPoint" => self.remove_automation_point(p),
            "setAutomationMode" => self.set_automation_mode(p),
            // ---- notes --------------------------------------------------
            "setVelocities" => self.set_velocities(p),
            "setNoteChannel" => self.set_note_channel(p),
            // ---- metronome ----------------------------------------------
            "setMetronome" => self.set_metronome(p),
            // ---- analysis (read-only) -----------------------------------
            "meter" => self.meter(p),
            "loudness" => self.loudness(p),
            "spectrogram" => self.spectrogram(p),
            "detectBeats" => self.detect_beats_op(p, None),
            _ => return None,
        };
        Some(r)
    }

    fn set_track_output(&mut self, p: &Value) -> OpResult {
        let ti = self.source_idx(p, "id")?;
        let output = match p.get("output") {
            Some(Value::Null) => None,
            Some(v) => {
                let bus = v.as_u64().ok_or_else(|| EngineError::invalid("invalid 'output'"))?;
                self.bus_idx(bus)?;
                Some(bus)
            }
            None => return Err(EngineError::invalid("missing 'output' (bus id or null for master)")),
        };
        self.record();
        self.doc.tracks[ti].output = output;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn set_send(&mut self, p: &Value) -> OpResult {
        let ti = self.source_idx(p, "track")?;
        let bus = req_u64(p, "bus")?;
        self.bus_idx(bus)?;
        let level = unit(p, "level", 0.0, 1.0)?;
        self.record();
        let sends = &mut self.doc.tracks[ti].sends;
        match sends.iter_mut().find(|s| s.bus == bus) {
            Some(s) => s.level = level,
            None => sends.push(Send { bus, level }),
        }
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn remove_send(&mut self, p: &Value) -> OpResult {
        let ti = self.track_idx(p, "track")?;
        let bus = req_u64(p, "bus")?;
        let si = self.doc.tracks[ti]
            .sends
            .iter()
            .position(|s| s.bus == bus)
            .ok_or_else(|| EngineError::not_found(format!("no send to bus {bus}")))?;
        self.record();
        self.doc.tracks[ti].sends.remove(si);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn add_insert(&mut self, p: &Value) -> OpResult {
        let ti = self.track_idx(p, "track")?;
        let kind = req_str(p, "kind")?;
        let base = Effect::default_for(kind).ok_or_else(|| {
            EngineError::validation("kind must be \"gain\", \"eq\" or \"compressor\"")
        })?;
        let effect = match p.get("params") {
            None | Some(Value::Null) => base,
            Some(params) => base.merged(params)?,
        };
        let len = self.doc.tracks[ti].inserts.len();
        if len >= MAX_INSERTS {
            return Err(EngineError::validation(format!("a track holds at most {MAX_INSERTS} inserts")));
        }
        let index = match p.get("index") {
            None | Some(Value::Null) => len,
            Some(v) => {
                let i = v.as_u64().ok_or_else(|| EngineError::invalid("invalid 'index'"))?;
                if i as usize > len {
                    return Err(EngineError::out_of_bounds(format!("insert index {i} out of range")));
                }
                i as usize
            }
        };
        self.record();
        let id = self.doc.alloc_id();
        self.doc.tracks[ti].inserts.insert(index, Insert { id, bypassed: false, effect });
        Ok(Self::changed(json!({ "insert_id": id, "index": index })))
    }

    fn remove_insert(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        self.record();
        self.doc.tracks[ti].inserts.remove(si);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn move_insert(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let to = req_u64(p, "index")? as usize;
        if to >= self.doc.tracks[ti].inserts.len() {
            return Err(EngineError::out_of_bounds(format!("insert index {to} out of range")));
        }
        self.record();
        let ins = self.doc.tracks[ti].inserts.remove(si);
        self.doc.tracks[ti].inserts.insert(to, ins);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn set_insert_bypass(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let bypassed = req_bool(p, "bypassed")?;
        self.record();
        self.doc.tracks[ti].inserts[si].bypassed = bypassed;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn set_insert_params(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let params = p.get("params").ok_or_else(|| EngineError::invalid("missing 'params'"))?;
        let next = self.doc.tracks[ti].inserts[si].effect.merged(params)?;
        self.record();
        self.doc.tracks[ti].inserts[si].effect = next;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn apply_insert_preset(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let name = req_str(p, "preset")?;
        let current = &self.doc.tracks[ti].inserts[si].effect;
        let next = presets::find(current.kind_name(), name).ok_or_else(|| {
            EngineError::not_found(format!("no {} preset '{name}'", current.kind_name()))
        })?;
        self.record();
        self.doc.tracks[ti].inserts[si].effect = next;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn eq_response(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let points = match p.get("points") {
            None | Some(Value::Null) => 128,
            Some(v) => v.as_u64().ok_or_else(|| EngineError::invalid("invalid 'points'"))? as usize,
        };
        if !(2..=1024).contains(&points) {
            return Err(EngineError::validation("points must be in 2..=1024"));
        }
        let sr = opt_f64(p, "sample_rate")?.unwrap_or(48000.0);
        if !(8000.0..=192_000.0).contains(&sr) {
            return Err(EngineError::validation("sample_rate must be in 8000..=192000"));
        }
        let Effect::Eq { bands } = &self.doc.tracks[ti].inserts[si].effect else {
            return Err(EngineError::validation("eqResponse needs an eq insert"));
        };
        let top = 20000f64.min(sr * 0.49);
        let curve: Vec<Value> = (0..points)
            .map(|i| {
                let hz = 20.0 * (top / 20.0).powf(i as f64 / (points - 1) as f64);
                let db = eq_response_db(bands, hz, sr);
                json!({ "hz": (hz * 10.0).round() / 10.0, "db": (db * 100.0).round() / 100.0 })
            })
            .collect();
        Ok(Self::read_only(json!({ "points": curve })))
    }

    fn dynamics_curve(&mut self, p: &Value) -> OpResult {
        let (ti, si) = self.insert_location(p)?;
        let Effect::Compressor(c) = &self.doc.tracks[ti].inserts[si].effect else {
            return Err(EngineError::validation("dynamicsCurve needs a compressor insert"));
        };
        let curve: Vec<Value> = (0..=60)
            .map(|i| {
                let in_db = -60.0 + i as f64;
                json!({ "in_db": in_db, "out_db": (compressor_out_db(c, in_db) * 100.0).round() / 100.0 })
            })
            .collect();
        Ok(Self::read_only(json!({ "points": curve })))
    }

    fn set_track_group(&mut self, p: &Value) -> OpResult {
        let ti = self.track_idx(p, "id")?;
        let group = group_name(p)?;
        self.record();
        self.doc.tracks[ti].group = group;
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// Sets `solo` or `muted` on every member of a group: one undo step.
    fn set_group_flag(&mut self, p: &Value, field: &str) -> OpResult {
        let group = req_str(p, "group")?.trim().to_string();
        let value = req_bool(p, field)?;
        let members: Vec<usize> = self
            .doc
            .tracks
            .iter()
            .enumerate()
            .filter(|(_, t)| t.group.as_deref() == Some(group.as_str()))
            .map(|(i, _)| i)
            .collect();
        if members.is_empty() {
            return Err(EngineError::not_found(format!("no tracks in group '{group}'")));
        }
        self.record();
        for i in &members {
            let t = &mut self.doc.tracks[*i];
            if field == "solo" {
                t.solo = value;
            } else {
                t.muted = value;
            }
        }
        Ok(Self::changed(json!({ "tracks": members.len() })))
    }

    fn set_solo_safe(&mut self, p: &Value) -> OpResult {
        let ti = self.track_idx(p, "id")?;
        let safe = req_bool(p, "safe")?;
        self.record();
        self.doc.tracks[ti].solo_safe = safe;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn automation_value(param: AutomationParam, p: &Value) -> Result<f64, EngineError> {
        let (min, max) = param.range();
        unit(p, "value", min, max)
    }

    fn add_automation_point(&mut self, p: &Value) -> OpResult {
        let (ti, param) = self.lane_target(p)?;
        let ticks = req_ticks(p, "ticks")?;
        let value = Self::automation_value(param, p)?;
        let lane = self.doc.tracks[ti].automation.lane(param);
        let index = lane.points.partition_point(|pt| pt.ticks < ticks);
        if lane.points.get(index).map(|pt| pt.ticks) == Some(ticks) {
            return Err(EngineError::validation("a point already exists at this tick; move it instead"));
        }
        self.record();
        self.doc.tracks[ti]
            .automation
            .lane_mut(param)
            .points
            .insert(index, AutomationPoint { ticks, value });
        Ok(Self::changed(json!({ "index": index })))
    }

    fn move_automation_point(&mut self, p: &Value) -> OpResult {
        let (ti, param) = self.lane_target(p)?;
        let index = req_u64(p, "index")? as usize;
        let ticks = req_ticks(p, "ticks")?;
        let value = Self::automation_value(param, p)?;
        let points = &self.doc.tracks[ti].automation.lane(param).points;
        if index >= points.len() {
            return Err(EngineError::out_of_bounds(format!("point index {index} out of range")));
        }
        // A point moves between its neighbours; it never jumps past them, so
        // indices held by an editor stay valid.
        let lo = if index == 0 { None } else { Some(points[index - 1].ticks) };
        let hi = points.get(index + 1).map(|pt| pt.ticks);
        if lo.is_some_and(|lo| ticks <= lo) || hi.is_some_and(|hi| ticks >= hi) {
            return Err(EngineError::validation("a point cannot move past its neighbours"));
        }
        self.record();
        self.doc.tracks[ti].automation.lane_mut(param).points[index] = AutomationPoint { ticks, value };
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn remove_automation_point(&mut self, p: &Value) -> OpResult {
        let (ti, param) = self.lane_target(p)?;
        let index = req_u64(p, "index")? as usize;
        if index >= self.doc.tracks[ti].automation.lane(param).points.len() {
            return Err(EngineError::out_of_bounds(format!("point index {index} out of range")));
        }
        self.record();
        self.doc.tracks[ti].automation.lane_mut(param).points.remove(index);
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn set_automation_mode(&mut self, p: &Value) -> OpResult {
        let (ti, param) = self.lane_target(p)?;
        let mode = match req_str(p, "mode")? {
            "off" => AutomationMode::Off,
            "read" => AutomationMode::Read,
            other => {
                return Err(EngineError::validation(format!(
                    "mode must be \"off\" or \"read\" (got \"{other}\"); write modes need live transport"
                )))
            }
        };
        self.record();
        self.doc.tracks[ti].automation.lane_mut(param).mode = mode;
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// Many velocity changes in one clip as one command and one undo step,
    /// for a velocity line drawn across several notes.
    fn set_velocities(&mut self, p: &Value) -> OpResult {
        let clip_id = req_u64(p, "clip")?;
        let (ti, ci) = self
            .doc
            .clip_location(clip_id)
            .ok_or_else(|| EngineError::not_found(format!("no clip {clip_id}")))?;
        let changes = p
            .get("changes")
            .and_then(Value::as_array)
            .ok_or_else(|| EngineError::invalid("missing or invalid 'changes'"))?;
        if changes.is_empty() {
            return Err(EngineError::validation("changes must not be empty"));
        }
        let count = self.doc.tracks[ti].clips[ci].notes.len() as u64;
        let mut parsed: Vec<(usize, u8)> = Vec::with_capacity(changes.len());
        for c in changes {
            let index = req_u64(c, "index")?;
            let velocity = crate::req_i64(c, "velocity")?;
            if index >= count {
                return Err(EngineError::out_of_bounds(format!("note index {index} out of range")));
            }
            if !(0..=127).contains(&velocity) {
                return Err(EngineError::validation("velocity must be in 0..=127"));
            }
            if parsed.iter().any(|(i, _)| *i == index as usize) {
                return Err(EngineError::validation(format!("note index {index} appears twice")));
            }
            parsed.push((index as usize, velocity as u8));
        }
        self.record();
        let notes = &mut self.doc.tracks[ti].clips[ci].notes;
        for (i, v) in &parsed {
            notes[*i].velocity = *v;
        }
        Ok(Self::changed(json!({ "changed": parsed.len() })))
    }

    fn set_note_channel(&mut self, p: &Value) -> OpResult {
        let (ti, ci, ni) = self.note_location(p)?;
        let channel = crate::req_i64(p, "channel")?;
        if !(0..=15).contains(&channel) {
            return Err(EngineError::validation("channel must be in 0..=15 (MIDI channels 1-16)"));
        }
        self.record();
        self.doc.tracks[ti].clips[ci].notes[ni].channel = channel as u8;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn set_metronome(&mut self, p: &Value) -> OpResult {
        let enabled = req_bool(p, "enabled")?;
        let volume = match opt_f64(p, "volume")? {
            None => self.doc.metronome.volume,
            Some(v) if (0.0..=1.0).contains(&v) => v,
            Some(_) => return Err(EngineError::validation("volume must be in 0..=1")),
        };
        self.record();
        self.doc.metronome.enabled = enabled;
        self.doc.metronome.volume = volume;
        Ok(Self::changed(json!({ "ok": true })))
    }

    fn meter(&mut self, p: &Value) -> OpResult {
        let (from, to, sr, click) = range(p)?;
        let window_ms = opt_f64(p, "window_ms")?.unwrap_or(50.0);
        if !(5.0..=1000.0).contains(&window_ms) {
            return Err(EngineError::validation("window_ms must be in 5..=1000"));
        }
        let mix = mixdown(&self.doc, from, to, sr, click, true)?;
        analysis::meter(&mix, sr, window_ms).map(Self::read_only)
    }

    fn loudness(&mut self, p: &Value) -> OpResult {
        let (from, to, sr, click) = range(p)?;
        let mix = mixdown(&self.doc, from, to, sr, click, false)?;
        Ok(Self::read_only(analysis::loudness(&mix, sr)))
    }

    fn spectrogram(&mut self, p: &Value) -> OpResult {
        let (from, to, sr, click) = range(p)?;
        let size = |key: &str, default: u64| -> Result<u64, EngineError> {
            match p.get(key) {
                None | Some(Value::Null) => Ok(default),
                Some(v) => v.as_u64().ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
            }
        };
        let fft_size = size("fft_size", 2048)?;
        if !(256..=8192).contains(&fft_size) || !fft_size.is_power_of_two() {
            return Err(EngineError::validation("fft_size must be a power of two in 256..=8192"));
        }
        let hop = size("hop", fft_size / 2)?;
        if hop == 0 || hop > fft_size {
            return Err(EngineError::validation("hop must be in 1..=fft_size"));
        }
        let bands = size("bands", 64)?;
        if !(8..=256).contains(&bands) {
            return Err(EngineError::validation("bands must be in 8..=256"));
        }
        let mix = mixdown(&self.doc, from, to, sr, click, false)?;
        let opts = SpectroOptions { fft_size: fft_size as usize, hop: hop as usize, bands: bands as usize };
        analysis::spectrogram(&mix, sr, &opts).map(Self::read_only)
    }

    /// `detectBeats` body; `ctx` lets the task path checkpoint inside the
    /// mixdown like `render` does. Read-only either way.
    pub(crate) fn detect_beats_op(&self, p: &Value, ctx: Option<&TaskContext>) -> OpResult {
        let (from, to, sr, click) = range(p)?;
        let size = |key: &str, default: u64| -> Result<u64, EngineError> {
            match p.get(key) {
                None | Some(Value::Null) => Ok(default),
                Some(v) => v.as_u64().ok_or_else(|| EngineError::invalid(format!("invalid '{key}'"))),
            }
        };
        let fft_size = size("fft_size", 1024)?;
        if !(256..=8192).contains(&fft_size) || !fft_size.is_power_of_two() {
            return Err(EngineError::validation("fft_size must be a power of two in 256..=8192"));
        }
        let hop = size("hop", fft_size / 2)?;
        if hop == 0 || hop > fft_size {
            return Err(EngineError::validation("hop must be in 1..=fft_size"));
        }
        let sensitivity = opt_f64(p, "sensitivity")?.unwrap_or(analysis::DEFAULT_BEAT_SENSITIVITY);
        if !(0.0..=1.0).contains(&sensitivity) {
            return Err(EngineError::validation("sensitivity must be in 0..=1"));
        }
        let mix = mixdown_with_context(&self.doc, from, to, sr, click, false, ctx)?;
        let opts = BeatOptions { fft_size: fft_size as usize, hop: hop as usize, sensitivity };
        analysis::detect_beats(&mix, sr, &opts).map(Self::read_only)
    }
}
