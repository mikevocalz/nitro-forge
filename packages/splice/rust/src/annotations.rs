//! Sequence markers and the loop range: timeline annotations that edits to
//! clips never move. Ripples leave markers where they are, as sequence
//! markers do in other editors; a host that wants markers to follow a clip
//! moves them in the same `batch`.

use crate::{opt_f64, opt_str, req_f64, req_u64, Doc, MAX_TIME_S};
use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_NAME_CHARS: usize = 120;
const MAX_NOTE_CHARS: usize = 2000;

/// A point marker (`duration_s == 0`) or a range marker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Marker {
    pub id: u64,
    pub time_s: f64,
    #[serde(default)]
    pub duration_s: f64,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

/// The span playback loops over when the host's player has looping on.
/// Whether looping is on is player state, not document state.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LoopRange {
    pub in_s: f64,
    pub out_s: f64,
}

pub(crate) fn apply(doc: &mut Doc, op: &str, p: &Value) -> Result<Value, EngineError> {
    match op {
        "addMarker" => add_marker(doc, p),
        "updateMarker" => update_marker(doc, p),
        "removeMarker" => remove_marker(doc, p),
        "setLoopRange" => set_loop(doc, p),
        "clearLoopRange" => clear_loop(doc),
        other => Err(EngineError::internal(format!(
            "annotations cannot run '{other}'"
        ))),
    }
}

fn check_time(time_s: f64, duration_s: f64) -> Result<(), EngineError> {
    if time_s < 0.0 {
        return Err(EngineError::validation("time_s must be >= 0"));
    }
    if duration_s < 0.0 {
        return Err(EngineError::validation("duration_s must be >= 0"));
    }
    if time_s + duration_s > MAX_TIME_S {
        return Err(EngineError::out_of_bounds(format!(
            "marker must end by {MAX_TIME_S} s"
        )));
    }
    Ok(())
}

/// Marker invariants, for `restore`.
pub(crate) fn check_marker(m: &Marker) -> Result<(), EngineError> {
    check_time(m.time_s, m.duration_s)?;
    if m.name.trim().is_empty() {
        return Err(EngineError::validation("name must not be empty"));
    }
    check_text(&m.name, "name", MAX_NAME_CHARS)?;
    check_text(&m.note, "note", MAX_NOTE_CHARS)
}

/// `0 <= in_s < out_s <= MAX_TIME_S`.
pub(crate) fn check_loop(in_s: f64, out_s: f64) -> Result<(), EngineError> {
    if in_s < 0.0 {
        return Err(EngineError::validation("in_s must be >= 0"));
    }
    if in_s >= out_s {
        return Err(EngineError::validation("in_s must be < out_s"));
    }
    if out_s > MAX_TIME_S {
        return Err(EngineError::out_of_bounds(format!(
            "out_s must be at most {MAX_TIME_S}"
        )));
    }
    Ok(())
}

fn check_text(value: &str, key: &str, max: usize) -> Result<(), EngineError> {
    if value.chars().count() > max {
        return Err(EngineError::validation(format!(
            "{key} is longer than {max} characters"
        )));
    }
    Ok(())
}

fn sort(doc: &mut Doc) {
    doc.markers
        .sort_by(|a, b| a.time_s.total_cmp(&b.time_s).then(a.id.cmp(&b.id)));
}

/// `addMarker {time_s, duration_s?, name?, note?}` → `{marker_id}`.
fn add_marker(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let time_s = req_f64(p, "time_s")?;
    let duration_s = opt_f64(p, "duration_s")?.unwrap_or(0.0);
    check_time(time_s, duration_s)?;
    let name = match opt_str(p, "name")? {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => format!("Marker {}", doc.markers.len() + 1),
    };
    let note = opt_str(p, "note")?.unwrap_or_default();
    check_text(&name, "name", MAX_NAME_CHARS)?;
    check_text(&note, "note", MAX_NOTE_CHARS)?;
    let id = doc.alloc_id();
    doc.markers.push(Marker {
        id,
        time_s,
        duration_s,
        name,
        note,
    });
    sort(doc);
    Ok(json!({ "marker_id": id }))
}

/// `updateMarker {id, time_s?, duration_s?, name?, note?}`.
fn update_marker(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let time_s = opt_f64(p, "time_s")?;
    let duration_s = opt_f64(p, "duration_s")?;
    let name = opt_str(p, "name")?;
    let note = opt_str(p, "note")?;
    if time_s.is_none() && duration_s.is_none() && name.is_none() && note.is_none() {
        return Err(EngineError::invalid(
            "updateMarker requires at least one of 'time_s', 'duration_s', 'name', 'note'",
        ));
    }
    let m = doc
        .markers
        .iter_mut()
        .find(|m| m.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no marker {id}")))?;
    let next_time = time_s.unwrap_or(m.time_s);
    let next_duration = duration_s.unwrap_or(m.duration_s);
    check_time(next_time, next_duration)?;
    let next_name = match name {
        Some(n) if n.trim().is_empty() => {
            return Err(EngineError::validation("name must not be empty"))
        }
        Some(n) => n.trim().to_string(),
        None => m.name.clone(),
    };
    let next_note = note.unwrap_or_else(|| m.note.clone());
    check_text(&next_name, "name", MAX_NAME_CHARS)?;
    check_text(&next_note, "note", MAX_NOTE_CHARS)?;
    *m = Marker {
        id,
        time_s: next_time,
        duration_s: next_duration,
        name: next_name,
        note: next_note,
    };
    sort(doc);
    Ok(json!({ "ok": true }))
}

/// `removeMarker {id}`.
fn remove_marker(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let i = doc
        .markers
        .iter()
        .position(|m| m.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no marker {id}")))?;
    doc.markers.remove(i);
    Ok(json!({ "ok": true }))
}

/// `setLoopRange {in_s, out_s}`: `0 <= in_s < out_s`. The range may run past
/// the last clip; the player clamps it to the media it has.
fn set_loop(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let in_s = req_f64(p, "in_s")?;
    let out_s = req_f64(p, "out_s")?;
    check_loop(in_s, out_s)?;
    doc.loop_range = Some(LoopRange { in_s, out_s });
    Ok(json!({ "ok": true }))
}

/// `clearLoopRange {}`.
fn clear_loop(doc: &mut Doc) -> Result<Value, EngineError> {
    if doc.loop_range.take().is_none() {
        return Err(EngineError::validation("no loop range is set"));
    }
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use crate::SpliceEngine;
    use ignition_core::{Command, Engine, EngineError, ErrorCode};
    use serde_json::{json, Value};

    fn apply(e: &mut SpliceEngine, op: &str, p: Value) -> Result<Value, EngineError> {
        e.apply(Command::new(op, p)).map(|r| r.data)
    }
    fn tl(e: &mut SpliceEngine) -> Value {
        apply(e, "timeline", json!({})).unwrap()
    }

    #[test]
    fn markers_add_update_remove_sorted() {
        let mut e = SpliceEngine::new();
        let b = apply(
            &mut e,
            "addMarker",
            json!({ "time_s": 5.0, "name": " Beat " }),
        )
        .unwrap()["marker_id"]
            .as_u64()
            .unwrap();
        let a = apply(
            &mut e,
            "addMarker",
            json!({ "time_s": 1.0, "duration_s": 2.0, "note": "Cut the cough" }),
        )
        .unwrap()["marker_id"]
            .as_u64()
            .unwrap();
        let m = &tl(&mut e)["markers"];
        assert_eq!(m[0]["id"], a);
        assert_eq!(m[0]["name"], "Marker 2");
        assert_eq!(m[0]["note"], "Cut the cough");
        assert_eq!(m[1]["name"], "Beat");
        assert!(m[1].get("note").is_none());
        apply(
            &mut e,
            "updateMarker",
            json!({ "id": b, "time_s": 0.5, "name": "Open" }),
        )
        .unwrap();
        assert_eq!(tl(&mut e)["markers"][0]["name"], "Open");
        let before = tl(&mut e);
        for (bad, code) in [
            (json!({ "id": b }), ErrorCode::InvalidCommand),
            (json!({ "id": b, "time_s": -1.0 }), ErrorCode::Validation),
            (
                json!({ "id": b, "duration_s": -1.0 }),
                ErrorCode::Validation,
            ),
            (json!({ "id": b, "name": "  " }), ErrorCode::Validation),
            (
                json!({ "id": b, "note": "x".repeat(2001) }),
                ErrorCode::Validation,
            ),
            (json!({ "id": 999, "name": "x" }), ErrorCode::NotFound),
        ] {
            assert_eq!(apply(&mut e, "updateMarker", bad).unwrap_err().code, code);
            assert_eq!(tl(&mut e), before);
        }
        apply(&mut e, "removeMarker", json!({ "id": a })).unwrap();
        assert_eq!(tl(&mut e)["markers"].as_array().unwrap().len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(tl(&mut e)["markers"].as_array().unwrap().len(), 2);
        assert!(apply(&mut e, "addMarker", json!({ "time_s": -2.0 })).is_err());
    }

    #[test]
    fn markers_stay_put_through_ripples() {
        let mut e = SpliceEngine::new();
        let s = apply(&mut e, "addSource", json!({ "duration_s": 9.0 })).unwrap()["source_id"]
            .as_u64()
            .unwrap();
        let v = apply(&mut e, "addTrack", json!({ "kind": "video" })).unwrap()["track_id"]
            .as_u64()
            .unwrap();
        let c = apply(
            &mut e,
            "addClip",
            json!({ "track": v, "source": s, "in_s": 0.0, "out_s": 3.0 }),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({ "track": v, "source": s, "in_s": 3.0, "out_s": 6.0 }),
        )
        .unwrap();
        apply(&mut e, "addMarker", json!({ "time_s": 4.0 })).unwrap();
        apply(&mut e, "rippleDelete", json!({ "id": c })).unwrap();
        assert_eq!(tl(&mut e)["markers"][0]["time_s"], 4.0);
    }

    #[test]
    fn loop_range() {
        let mut e = SpliceEngine::new();
        assert!(tl(&mut e).get("loop_range").is_none());
        for bad in [
            json!({ "in_s": 2.0, "out_s": 2.0 }),
            json!({ "in_s": -1.0, "out_s": 2.0 }),
            json!({ "in_s": 1.0 }),
        ] {
            assert!(apply(&mut e, "setLoopRange", bad).is_err());
        }
        apply(&mut e, "setLoopRange", json!({ "in_s": 1.0, "out_s": 3.5 })).unwrap();
        assert_eq!(
            tl(&mut e)["loop_range"],
            json!({ "in_s": 1.0, "out_s": 3.5 })
        );
        apply(&mut e, "clearLoopRange", json!({})).unwrap();
        assert_eq!(
            apply(&mut e, "clearLoopRange", json!({})).unwrap_err().code,
            ErrorCode::Validation
        );
        assert!(e.undo().unwrap());
        assert_eq!(tl(&mut e)["loop_range"]["out_s"], 3.5);
    }
}
