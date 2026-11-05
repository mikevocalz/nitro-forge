//! Transitions on cuts between touching clips.
//!
//! A transition sits centred on the cut: it overlaps `duration_s / 2` of each
//! clip and needs that much extra media beyond the left clip's out-point and
//! before the right clip's in-point (the handles). Splice stores the kind and
//! timing and hands both to `renderPlan`; drawing a dissolve or a wipe is the
//! compositor's job, and Splice has no compositor.

use crate::{opt_f64, opt_str, req_f64, req_u64, Doc, Track, EPS};
use ignition_core::EngineError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// What the compositor (or audio mixer) does across the cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    CrossDissolve,
    DipToBlack,
    DipToWhite,
    WipeLeft,
    WipeRight,
    PushLeft,
    PushRight,
    /// The only kind on audio tracks.
    CrossFade,
}

impl TransitionKind {
    fn parse(s: &str) -> Result<Self, EngineError> {
        serde_json::from_value(Value::String(s.to_string()))
            .map_err(|_| EngineError::validation(format!("unknown transition kind '{s}'")))
    }

    fn is_audio(self) -> bool {
        matches!(self, Self::CrossFade)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transition {
    pub id: u64,
    /// Clip ending at the cut.
    pub left_id: u64,
    /// Clip starting at the cut.
    pub right_id: u64,
    pub kind: TransitionKind,
    /// Total length; half lies on each side of the cut.
    pub duration_s: f64,
}

/// Whether `tr` still fits on `track`: both clips present and touching, and
/// enough clip length and media handle on each side.
/// `others` are the transitions that share the track's clips with `tr`
/// (it may include `tr` itself, which is skipped).
pub(crate) fn check(
    doc: &Doc,
    track: &Track,
    others: &[Transition],
    tr: &Transition,
) -> Result<(), EngineError> {
    let (left, right) = match (track.clip(tr.left_id), track.clip(tr.right_id)) {
        (Some(l), Some(r)) => (l, r),
        _ => {
            return Err(EngineError::validation(
                "a transition needs both clips on the same track",
            ))
        }
    };
    if (left.timeline_end() - right.timeline_start_s).abs() > EPS {
        return Err(EngineError::validation(
            "a transition needs the left clip to end where the right clip starts",
        ));
    }
    if tr.duration_s <= 0.0 {
        return Err(EngineError::validation("duration_s must be > 0"));
    }
    if tr.kind.is_audio() == track.kind.is_visual() {
        return Err(EngineError::validation(if track.kind.is_visual() {
            "cross_fade is for audio tracks"
        } else {
            "audio tracks take cross_fade only"
        }));
    }
    let half = tr.duration_s / 2.0;
    // Each clip's other transition shares its length.
    let used = |clip_id: u64| -> f64 {
        others
            .iter()
            .filter(|o| o.id != tr.id && (o.left_id == clip_id || o.right_id == clip_id))
            .map(|o| o.duration_s / 2.0)
            .sum()
    };
    if half + used(left.id) > left.timeline_len() + EPS
        || half + used(right.id) > right.timeline_len() + EPS
    {
        return Err(EngineError::validation(
            "transition is longer than the clips around the cut allow",
        ));
    }
    let left_src = doc.source_of(left)?;
    let after = left_src.duration_s - left.out_s;
    let before = right.in_s;
    if half * left.speed > after + EPS || half * right.speed > before + EPS {
        let max = 2.0 * (after / left.speed).min(before / right.speed);
        return Err(EngineError::validation(format!(
            "not enough media beyond the cut for {:.3} s; at most {:.3} s fits",
            tr.duration_s,
            max.max(0.0)
        )));
    }
    Ok(())
}

pub(crate) fn apply(doc: &mut Doc, op: &str, p: &Value) -> Result<Value, EngineError> {
    match op {
        "addTransition" => add(doc, p),
        "setTransition" => set(doc, p),
        "removeTransition" => remove(doc, p),
        other => Err(EngineError::internal(format!(
            "transitions cannot run '{other}'"
        ))),
    }
}

fn locate(doc: &Doc, id: u64) -> Result<(usize, usize), EngineError> {
    doc.tracks
        .iter()
        .enumerate()
        .find_map(|(ti, t)| {
            t.transitions
                .iter()
                .position(|x| x.id == id)
                .map(|i| (ti, i))
        })
        .ok_or_else(|| EngineError::not_found(format!("no transition {id}")))
}

/// `addTransition {left, right, kind, duration_s}` → `{transition_id}`.
fn add(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let left = req_u64(p, "left")?;
    let right = req_u64(p, "right")?;
    let kind = TransitionKind::parse(
        &opt_str(p, "kind")?.ok_or_else(|| EngineError::invalid("missing or invalid 'kind'"))?,
    )?;
    let duration_s = req_f64(p, "duration_s")?;
    let (lt, _) = doc.require_clip(left)?;
    let (rt, _) = doc.require_clip(right)?;
    if lt != rt {
        return Err(EngineError::validation(
            "a transition needs both clips on the same track",
        ));
    }
    doc.require_unlocked(lt)?;
    if doc.tracks[lt]
        .transitions
        .iter()
        .any(|t| t.left_id == left && t.right_id == right)
    {
        return Err(EngineError::validation("that cut already has a transition"));
    }
    let id = doc.alloc_id();
    let tr = Transition {
        id,
        left_id: left,
        right_id: right,
        kind,
        duration_s,
    };
    check(doc, &doc.tracks[lt], &doc.tracks[lt].transitions, &tr)?;
    doc.tracks[lt].transitions.push(tr);
    Ok(json!({ "transition_id": id }))
}

/// `setTransition {id, kind?, duration_s?}`.
fn set(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let kind = opt_str(p, "kind")?
        .map(|s| TransitionKind::parse(&s))
        .transpose()?;
    let duration_s = opt_f64(p, "duration_s")?;
    if kind.is_none() && duration_s.is_none() {
        return Err(EngineError::invalid(
            "setTransition requires at least one of 'kind', 'duration_s'",
        ));
    }
    let (ti, i) = locate(doc, id)?;
    doc.require_unlocked(ti)?;
    let mut tr = doc.tracks[ti].transitions[i].clone();
    tr.kind = kind.unwrap_or(tr.kind);
    tr.duration_s = duration_s.unwrap_or(tr.duration_s);
    check(doc, &doc.tracks[ti], &doc.tracks[ti].transitions, &tr)?;
    doc.tracks[ti].transitions[i] = tr;
    Ok(json!({ "ok": true }))
}

/// `removeTransition {id}`.
fn remove(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let (ti, i) = locate(doc, id)?;
    doc.require_unlocked(ti)?;
    doc.tracks[ti].transitions.remove(i);
    Ok(json!({ "ok": true }))
}

/// Drop every transition that no longer fits after a clip edit. Returns the
/// removed ids. Transitions are checked in order, so when two on one clip no
/// longer both fit, the later one goes.
pub(crate) fn prune(doc: &mut Doc) -> Vec<u64> {
    let mut removed = Vec::new();
    for ti in 0..doc.tracks.len() {
        let mut i = 0;
        while i < doc.tracks[ti].transitions.len() {
            // Check against the transitions kept so far plus this one.
            let track = &doc.tracks[ti];
            let tr = &track.transitions[i];
            if check(doc, track, &track.transitions[..=i], tr).is_ok() {
                i += 1;
            } else {
                removed.push(tr.id);
                doc.tracks[ti].transitions.remove(i);
            }
        }
    }
    removed
}

/// `renderPlan` entries for one track, in cut order.
pub(crate) fn plan(track: &Track) -> Vec<Value> {
    let mut out: Vec<(f64, Value)> = track
        .transitions
        .iter()
        .filter_map(|t| {
            let cut = track.clip(t.right_id)?.timeline_start_s;
            let half = t.duration_s / 2.0;
            Some((
                cut,
                json!({
                    "transition_id": t.id,
                    "kind": t.kind,
                    "left_clip_id": t.left_id,
                    "right_clip_id": t.right_id,
                    "cut_s": cut,
                    "start_s": cut - half,
                    "end_s": cut + half,
                    "duration_s": t.duration_s,
                }),
            ))
        })
        .collect();
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out.into_iter().map(|(_, v)| v).collect()
}

#[cfg(test)]
mod tests {
    use crate::SpliceEngine;
    use ignition_core::{Command, Engine, EngineError, ErrorCode};
    use serde_json::{json, Value};

    fn apply(e: &mut SpliceEngine, op: &str, p: Value) -> Result<Value, EngineError> {
        e.apply(Command::new(op, p)).map(|r| r.data)
    }
    fn id(v: Value, key: &str) -> u64 {
        v[key].as_u64().unwrap()
    }
    fn tl(e: &mut SpliceEngine) -> Value {
        apply(e, "timeline", json!({})).unwrap()
    }

    /// Video track with clips 0..2 (media 2..4) and 2..4 (media 4..6) from a
    /// 10 s source: 2 s of handle on each side of the cut at 2.
    fn fixture() -> (SpliceEngine, u64, u64, u64, u64) {
        let mut e = SpliceEngine::new();
        let s = id(
            apply(&mut e, "addSource", json!({ "duration_s": 10.0 })).unwrap(),
            "source_id",
        );
        let v = id(
            apply(&mut e, "addTrack", json!({ "kind": "video" })).unwrap(),
            "track_id",
        );
        let l = id(
            apply(
                &mut e,
                "addClip",
                json!({ "track": v, "source": s, "in_s": 2.0, "out_s": 4.0 }),
            )
            .unwrap(),
            "clip_id",
        );
        let r = id(
            apply(
                &mut e,
                "addClip",
                json!({ "track": v, "source": s, "in_s": 4.0, "out_s": 6.0 }),
            )
            .unwrap(),
            "clip_id",
        );
        (e, s, v, l, r)
    }

    #[test]
    fn add_validates_kind_adjacency_and_handles() {
        let (mut e, s, v, l, r) = fixture();
        let before = tl(&mut e);
        for (bad, code) in [
            (
                json!({ "left": l, "right": r, "kind": "cross_fade", "duration_s": 1.0 }),
                ErrorCode::Validation,
            ),
            (
                json!({ "left": l, "right": r, "kind": "spin", "duration_s": 1.0 }),
                ErrorCode::Validation,
            ),
            (
                json!({ "left": l, "right": r, "kind": "cross_dissolve", "duration_s": 0.0 }),
                ErrorCode::Validation,
            ),
            (
                json!({ "left": l, "right": r, "kind": "cross_dissolve", "duration_s": 4.5 }),
                ErrorCode::Validation,
            ),
            (
                json!({ "left": r, "right": l, "kind": "cross_dissolve", "duration_s": 1.0 }),
                ErrorCode::Validation,
            ),
            (
                json!({ "left": l, "right": 999, "kind": "cross_dissolve", "duration_s": 1.0 }),
                ErrorCode::NotFound,
            ),
            (
                json!({ "left": l, "right": r, "duration_s": 1.0 }),
                ErrorCode::InvalidCommand,
            ),
        ] {
            assert_eq!(apply(&mut e, "addTransition", bad).unwrap_err().code, code);
            assert_eq!(tl(&mut e), before);
        }
        let t = id(
            apply(
                &mut e,
                "addTransition",
                json!({ "left": l, "right": r, "kind": "dip_to_black", "duration_s": 1.0 }),
            )
            .unwrap(),
            "transition_id",
        );
        let err = apply(
            &mut e,
            "addTransition",
            json!({ "left": l, "right": r, "kind": "wipe_left", "duration_s": 1.0 }),
        )
        .unwrap_err();
        assert!(err.message.contains("already"));
        let plan = apply(&mut e, "renderPlan", json!({})).unwrap();
        assert_eq!(plan["transitions"][0][0]["transition_id"], t);
        assert_eq!(plan["transitions"][0][0]["start_s"], 1.5);
        assert_eq!(plan["transitions"][0][0]["end_s"], 2.5);
        assert_eq!(plan["transitions"][0][0]["kind"], "dip_to_black");
        // No media past the right clip's in-point when it starts at 0.
        let c3 = id(
            apply(
                &mut e,
                "addClip",
                json!({ "track": v, "source": s, "in_s": 0.0, "out_s": 2.0 }),
            )
            .unwrap(),
            "clip_id",
        );
        let err = apply(
            &mut e,
            "addTransition",
            json!({ "left": r, "right": c3, "kind": "cross_dissolve", "duration_s": 0.5 }),
        )
        .unwrap_err();
        assert!(err.message.contains("not enough media"), "{}", err.message);
        assert!(e.undo().unwrap()); // addClip c3
        assert!(e.undo().unwrap()); // addTransition
        assert_eq!(tl(&mut e)["tracks"][0]["transitions"], json!([]));
    }

    #[test]
    fn audio_takes_cross_fade_only() {
        let mut e = SpliceEngine::new();
        let s = id(
            apply(&mut e, "addSource", json!({ "duration_s": 10.0 })).unwrap(),
            "source_id",
        );
        let a = id(
            apply(&mut e, "addTrack", json!({ "kind": "audio" })).unwrap(),
            "track_id",
        );
        let l = id(
            apply(
                &mut e,
                "addClip",
                json!({ "track": a, "source": s, "in_s": 2.0, "out_s": 4.0 }),
            )
            .unwrap(),
            "clip_id",
        );
        let r = id(
            apply(
                &mut e,
                "addClip",
                json!({ "track": a, "source": s, "in_s": 4.0, "out_s": 6.0 }),
            )
            .unwrap(),
            "clip_id",
        );
        assert!(apply(
            &mut e,
            "addTransition",
            json!({ "left": l, "right": r, "kind": "wipe_left", "duration_s": 1.0 })
        )
        .is_err());
        apply(
            &mut e,
            "addTransition",
            json!({ "left": l, "right": r, "kind": "cross_fade", "duration_s": 1.0 }),
        )
        .unwrap();
    }

    #[test]
    fn set_and_remove() {
        let (mut e, _, v, l, r) = fixture();
        let t = id(
            apply(
                &mut e,
                "addTransition",
                json!({ "left": l, "right": r, "kind": "cross_dissolve", "duration_s": 1.0 }),
            )
            .unwrap(),
            "transition_id",
        );
        apply(
            &mut e,
            "setTransition",
            json!({ "id": t, "duration_s": 2.0, "kind": "push_right" }),
        )
        .unwrap();
        let tr = &tl(&mut e)["tracks"][0]["transitions"][0];
        assert_eq!(tr["duration_s"], 2.0);
        assert_eq!(tr["kind"], "push_right");
        assert!(apply(
            &mut e,
            "setTransition",
            json!({ "id": t, "duration_s": 6.0 })
        )
        .is_err());
        assert!(apply(&mut e, "setTransition", json!({ "id": t })).is_err());
        apply(&mut e, "setTrackFlags", json!({ "id": v, "locked": true })).unwrap();
        assert!(apply(&mut e, "removeTransition", json!({ "id": t }))
            .unwrap_err()
            .message
            .contains("locked"));
        apply(&mut e, "setTrackFlags", json!({ "id": v, "locked": false })).unwrap();
        apply(&mut e, "removeTransition", json!({ "id": t })).unwrap();
        assert_eq!(
            apply(&mut e, "removeTransition", json!({ "id": t }))
                .unwrap_err()
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn edits_that_break_a_cut_drop_its_transition_in_the_same_undo_step() {
        let (mut e, _, _, l, r) = fixture();
        let t = id(
            apply(
                &mut e,
                "addTransition",
                json!({ "left": l, "right": r, "kind": "cross_dissolve", "duration_s": 1.0 }),
            )
            .unwrap(),
            "transition_id",
        );
        let out = apply(&mut e, "moveClip", json!({ "id": r, "start_s": 5.0 })).unwrap();
        assert_eq!(out["removed_transitions"], json!([t]));
        assert_eq!(tl(&mut e)["tracks"][0]["transitions"], json!([]));
        assert!(e.undo().unwrap());
        assert_eq!(tl(&mut e)["tracks"][0]["transitions"][0]["id"], t);
        // A roll keeps the clips touching, so the transition stays.
        let out = apply(
            &mut e,
            "rollEdit",
            json!({ "left": l, "right": r, "delta_s": 0.25 }),
        )
        .unwrap();
        assert!(out.get("removed_transitions").is_none());
        // Splitting the left clip hands the transition to its right half.
        let split = apply(&mut e, "splitClip", json!({ "id": l, "at_s": 1.0 })).unwrap();
        let tr = &tl(&mut e)["tracks"][0]["transitions"][0];
        assert_eq!(tr["left_id"], split["right_id"]);
        // Slipping the right clip to its first frame leaves no handle before
        // its in-point, so the transition goes.
        let out = apply(&mut e, "slipClip", json!({ "id": r, "delta_s": -4.25 })).unwrap();
        assert_eq!(out["removed_transitions"], json!([t]));
    }
}
