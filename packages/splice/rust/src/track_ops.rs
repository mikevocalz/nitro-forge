//! Track header state: lock/hide/mute/solo flags, names and stack order.
//!
//! `apply` edits the caller's working copy and returns `Some(data)` when the
//! document changed, `None` when the request matched the current state (the
//! engine then records no undo entry and emits no event).

use crate::{req_u64, Doc, TrackKind, MAX_TRACK_NAME_CHARS as MAX_NAME_CHARS};
use ignition_core::EngineError;
use serde_json::{json, Value};

pub(crate) fn apply(doc: &mut Doc, op: &str, p: &Value) -> Result<Option<Value>, EngineError> {
    match op {
        "setTrackFlags" => set_flags(doc, p),
        "renameTrack" => rename(doc, p),
        "moveTrack" => move_track(doc, p),
        other => Err(EngineError::internal(format!(
            "track_ops cannot run '{other}'"
        ))),
    }
}

fn opt_bool(p: &Value, key: &str) -> Result<Option<bool>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(EngineError::invalid(format!("invalid '{key}'"))),
    }
}

/// `setTrackFlags {id, locked?, hidden?, muted?, solo?}`. Hidden applies to
/// video and overlay tracks; muted and solo to audio tracks. Flags can change
/// on a locked track: lock protects the clips, not the header.
fn set_flags(doc: &mut Doc, p: &Value) -> Result<Option<Value>, EngineError> {
    let id = req_u64(p, "id")?;
    let idx = doc.require_track(id)?;
    let locked = opt_bool(p, "locked")?;
    let hidden = opt_bool(p, "hidden")?;
    let muted = opt_bool(p, "muted")?;
    let solo = opt_bool(p, "solo")?;
    if locked.is_none() && hidden.is_none() && muted.is_none() && solo.is_none() {
        return Err(EngineError::invalid(
            "setTrackFlags requires at least one of 'locked', 'hidden', 'muted', 'solo'",
        ));
    }
    let t = &mut doc.tracks[idx];
    let audio = t.kind == TrackKind::Audio;
    if hidden.is_some() && audio {
        return Err(EngineError::validation(
            "hidden applies to video and overlay tracks; use muted on audio tracks",
        ));
    }
    if (muted.is_some() || solo.is_some()) && !audio {
        return Err(EngineError::validation(
            "muted and solo apply to audio tracks; use hidden on video and overlay tracks",
        ));
    }
    let before = (t.locked, t.hidden, t.muted, t.solo);
    t.locked = locked.unwrap_or(t.locked);
    t.hidden = hidden.unwrap_or(t.hidden);
    t.muted = muted.unwrap_or(t.muted);
    t.solo = solo.unwrap_or(t.solo);
    if before == (t.locked, t.hidden, t.muted, t.solo) {
        return Ok(None);
    }
    Ok(Some(json!({ "ok": true, "changed": true })))
}

/// `renameTrack {id, name}`: trimmed, 1..=120 characters.
fn rename(doc: &mut Doc, p: &Value) -> Result<Option<Value>, EngineError> {
    let id = req_u64(p, "id")?;
    let idx = doc.require_track(id)?;
    let name = p
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("missing or invalid 'name'"))?
        .trim();
    if name.is_empty() {
        return Err(EngineError::validation("name must not be empty"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(EngineError::validation(format!(
            "name is longer than {MAX_NAME_CHARS} characters"
        )));
    }
    let t = &mut doc.tracks[idx];
    if t.name.as_deref() == Some(name) {
        return Ok(None);
    }
    t.name = Some(name.to_string());
    Ok(Some(json!({ "ok": true, "changed": true })))
}

/// `moveTrack {id, index}`: put the track at `index` in the stack (0 = first).
/// Track order is the compositing and listing order hosts show.
fn move_track(doc: &mut Doc, p: &Value) -> Result<Option<Value>, EngineError> {
    let id = req_u64(p, "id")?;
    let from = doc.require_track(id)?;
    let to = req_u64(p, "index")?;
    let to = usize::try_from(to)
        .ok()
        .filter(|i| *i < doc.tracks.len())
        .ok_or_else(|| {
            EngineError::out_of_bounds(format!(
                "index must be below the track count {}",
                doc.tracks.len()
            ))
        })?;
    if from == to {
        return Ok(None);
    }
    let t = doc.tracks.remove(from);
    doc.tracks.insert(to, t);
    Ok(Some(json!({ "ok": true, "changed": true })))
}

#[cfg(test)]
mod tests {
    use crate::SpliceEngine;
    use ignition_core::{Command, Engine, ErrorCode};
    use serde_json::{json, Value};

    fn apply(
        e: &mut SpliceEngine,
        op: &str,
        p: Value,
    ) -> Result<Value, ignition_core::EngineError> {
        e.apply(Command::new(op, p)).map(|r| r.data)
    }
    fn track(e: &mut SpliceEngine, kind: &str) -> u64 {
        apply(e, "addTrack", json!({ "kind": kind })).unwrap()["track_id"]
            .as_u64()
            .unwrap()
    }
    fn tl(e: &mut SpliceEngine) -> Value {
        apply(e, "timeline", json!({})).unwrap()
    }

    #[test]
    fn flags_follow_track_kind_and_are_one_undo_step() {
        let mut e = SpliceEngine::new();
        let v = track(&mut e, "video");
        let a = track(&mut e, "audio");
        let o = track(&mut e, "overlay");
        assert_eq!(tl(&mut e)["tracks"][2]["kind"], "overlay");
        apply(
            &mut e,
            "setTrackFlags",
            json!({ "id": v, "locked": true, "hidden": true }),
        )
        .unwrap();
        apply(
            &mut e,
            "setTrackFlags",
            json!({ "id": a, "muted": true, "solo": true }),
        )
        .unwrap();
        apply(&mut e, "setTrackFlags", json!({ "id": o, "hidden": true })).unwrap();
        let d = tl(&mut e);
        assert_eq!(d["tracks"][0]["locked"], true);
        assert_eq!(d["tracks"][0]["hidden"], true);
        assert_eq!(d["tracks"][1]["solo"], true);
        let before = tl(&mut e);
        for (bad, code) in [
            (json!({ "id": a, "hidden": true }), ErrorCode::Validation),
            (json!({ "id": v, "muted": true }), ErrorCode::Validation),
            (json!({ "id": o, "solo": false }), ErrorCode::Validation),
            (json!({ "id": v }), ErrorCode::InvalidCommand),
            (
                json!({ "id": v, "locked": "yes" }),
                ErrorCode::InvalidCommand,
            ),
            (json!({ "id": 999, "locked": true }), ErrorCode::NotFound),
        ] {
            assert_eq!(apply(&mut e, "setTrackFlags", bad).unwrap_err().code, code);
            assert_eq!(tl(&mut e), before);
        }
        // Undo reverses the last flag change only.
        assert!(e.undo().unwrap());
        assert_eq!(tl(&mut e)["tracks"][2]["hidden"], false);
        assert_eq!(tl(&mut e)["tracks"][1]["solo"], true);
    }

    #[test]
    fn unchanged_flags_record_nothing() {
        let mut e = SpliceEngine::new();
        let v = track(&mut e, "video");
        let r = e
            .apply(Command::new(
                "setTrackFlags",
                json!({ "id": v, "locked": false }),
            ))
            .unwrap();
        assert!(r.events.is_empty());
        assert_eq!(r.data["changed"], false);
        assert!(e.undo().unwrap()); // only addTrack is on the journal
        assert!(!e.undo().unwrap());
    }

    #[test]
    fn rename_and_move_track() {
        let mut e = SpliceEngine::new();
        let v = track(&mut e, "video");
        let a = track(&mut e, "audio");
        let o = track(&mut e, "overlay");
        apply(
            &mut e,
            "renameTrack",
            json!({ "id": v, "name": "  Interviews " }),
        )
        .unwrap();
        assert_eq!(tl(&mut e)["tracks"][0]["name"], "Interviews");
        assert!(apply(&mut e, "renameTrack", json!({ "id": v, "name": "  " })).is_err());
        assert!(apply(
            &mut e,
            "renameTrack",
            json!({ "id": v, "name": "x".repeat(121) })
        )
        .is_err());
        apply(&mut e, "moveTrack", json!({ "id": o, "index": 0 })).unwrap();
        let ids: Vec<u64> = tl(&mut e)["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![o, v, a]);
        let err = apply(&mut e, "moveTrack", json!({ "id": o, "index": 3 })).unwrap_err();
        assert_eq!(err.code, ErrorCode::OutOfBounds);
        assert!(e.undo().unwrap());
        assert_eq!(tl(&mut e)["tracks"][0]["id"], v);
    }

    #[test]
    fn locked_track_refuses_clip_edits_and_removal() {
        let mut e = SpliceEngine::new();
        let s = apply(&mut e, "addSource", json!({ "duration_s": 10.0 })).unwrap()["source_id"]
            .as_u64()
            .unwrap();
        let v = track(&mut e, "video");
        let c = apply(
            &mut e,
            "addClip",
            json!({ "track": v, "source": s, "in_s": 0.0, "out_s": 4.0 }),
        )
        .unwrap()["clip_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "setTrackFlags", json!({ "id": v, "locked": true })).unwrap();
        let before = tl(&mut e);
        for (op, p) in [
            (
                "addClip",
                json!({ "track": v, "source": s, "in_s": 0.0, "out_s": 1.0 }),
            ),
            ("removeClip", json!({ "id": c })),
            ("moveClip", json!({ "id": c, "start_s": 5.0 })),
            ("trimClip", json!({ "id": c, "out_s": 3.0 })),
            ("splitClip", json!({ "id": c, "at_s": 1.0 })),
            ("setSpeed", json!({ "id": c, "speed": 2.0 })),
            ("rippleDelete", json!({ "id": c })),
            ("slipClip", json!({ "id": c, "delta_s": 1.0 })),
            ("removeTrack", json!({ "id": v })),
        ] {
            let err = apply(&mut e, op, p).unwrap_err();
            assert_eq!(err.code, ErrorCode::Validation, "{op}");
            assert!(err.message.contains("locked"), "{op}: {}", err.message);
            assert_eq!(tl(&mut e), before, "{op}");
        }
        // The header itself still works: unlock, then edit.
        apply(&mut e, "setTrackFlags", json!({ "id": v, "locked": false })).unwrap();
        apply(&mut e, "moveClip", json!({ "id": c, "start_s": 5.0 })).unwrap();
    }

    #[test]
    fn render_plan_marks_hidden_muted_and_solo_tracks() {
        let mut e = SpliceEngine::new();
        let s = apply(&mut e, "addSource", json!({ "duration_s": 10.0 })).unwrap()["source_id"]
            .as_u64()
            .unwrap();
        let v = track(&mut e, "video");
        let a1 = track(&mut e, "audio");
        let a2 = track(&mut e, "audio");
        for t in [v, a1, a2] {
            apply(
                &mut e,
                "addClip",
                json!({ "track": t, "source": s, "in_s": 0.0, "out_s": 2.0 }),
            )
            .unwrap();
        }
        let active = |e: &mut SpliceEngine| -> Vec<bool> {
            let plan = apply(e, "renderPlan", json!({})).unwrap();
            plan["tracks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t[0]["track_active"].as_bool().unwrap())
                .collect()
        };
        assert_eq!(active(&mut e), vec![true, true, true]);
        apply(&mut e, "setTrackFlags", json!({ "id": v, "hidden": true })).unwrap();
        apply(&mut e, "setTrackFlags", json!({ "id": a1, "muted": true })).unwrap();
        assert_eq!(active(&mut e), vec![false, false, true]);
        // Solo wins over mute and silences every unsoloed audio track.
        apply(&mut e, "setTrackFlags", json!({ "id": a1, "solo": true })).unwrap();
        assert_eq!(active(&mut e), vec![false, true, false]);
    }
}
