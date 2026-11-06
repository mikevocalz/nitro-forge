//! Edits that change more than one clip: ripple delete/trim, roll, slip,
//! slide, and insert/overwrite placement for `addClip` and `moveClip`.
//!
//! Each function edits the engine's working copy of the document. The engine
//! runs `Doc::validate` on the copy afterwards and commits only if it passes,
//! so these functions may leave the copy invalid on the way to an error.
//! Times are seconds; `delta_s` is timeline time except for `slipClip`, where
//! it is media time.

use crate::{check_span, opt_str, req_f64, req_u64, Clip, Doc, EngineError, EPS};
use serde_json::{json, Value};

/// Which tracks a ripple shifts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// Only the edited clip's track.
    Track,
    /// Every unlocked track, so picture and sound stay in sync.
    All,
}

impl Scope {
    fn parse(p: &Value) -> Result<Self, EngineError> {
        match opt_str(p, "scope")?.as_deref() {
            None | Some("track") => Ok(Self::Track),
            Some("all") => Ok(Self::All),
            Some(_) => Err(EngineError::validation(
                "scope must be \"track\" or \"all\"",
            )),
        }
    }
}

/// How `addClip`/`moveClip` treat clips already under the destination span.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Placement {
    /// Refuse to overlap (the original behaviour, and the default).
    Reject,
    /// Push later clips right by the clip's length, splitting a clip that
    /// straddles the insert point.
    Insert(Scope),
    /// Replace whatever is under the span: trim, split or remove it.
    Overwrite,
}

impl Placement {
    pub(crate) fn parse(p: &Value) -> Result<Self, EngineError> {
        match opt_str(p, "mode")?.as_deref() {
            None | Some("reject") => Ok(Self::Reject),
            Some("insert") => Ok(Self::Insert(Scope::parse(p)?)),
            Some("overwrite") => Ok(Self::Overwrite),
            Some(_) => Err(EngineError::validation(
                "mode must be \"reject\", \"insert\" or \"overwrite\"",
            )),
        }
    }
}

pub(crate) fn apply(doc: &mut Doc, op: &str, p: &Value) -> Result<Value, EngineError> {
    match op {
        "rippleDelete" => ripple_delete(doc, p),
        "rippleTrim" => ripple_trim(doc, p),
        "rollEdit" => roll(doc, p),
        "slipClip" => slip(doc, p),
        "slideClip" => slide(doc, p),
        other => Err(EngineError::internal(format!(
            "timeline_edits cannot run '{other}'"
        ))),
    }
}

fn nonzero_delta(p: &Value) -> Result<f64, EngineError> {
    let d = req_f64(p, "delta_s")?;
    if d.abs() < EPS {
        return Err(EngineError::validation("delta_s must not be 0"));
    }
    Ok(d)
}

/// Move every clip that starts at or after `from` by `delta`. `origin` is the
/// edited track (already checked unlocked); with `Scope::All` the other
/// unlocked tracks move too. Locked tracks never move.
fn shift_after(
    doc: &mut Doc,
    scope: Scope,
    origin: usize,
    from: f64,
    delta: f64,
    skip: Option<u64>,
) {
    for (ti, t) in doc.tracks.iter_mut().enumerate() {
        let included = ti == origin || (scope == Scope::All && !t.locked);
        if !included {
            continue;
        }
        for c in &mut t.clips {
            if Some(c.id) != skip && c.timeline_start_s >= from - EPS {
                c.timeline_start_s += delta;
            }
        }
    }
}

/// `rippleDelete {id, scope?}`: remove the clip and close its gap.
fn ripple_delete(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let scope = Scope::parse(p)?;
    let (ti, ci) = doc.require_clip(id)?;
    doc.require_unlocked(ti)?;
    let clip = doc.tracks[ti].clips.remove(ci);
    shift_after(
        doc,
        scope,
        ti,
        clip.timeline_end(),
        -clip.timeline_len(),
        None,
    );
    Ok(json!({ "ok": true }))
}

/// `rippleTrim {id, edge, delta_s, scope?}`: move one edge by `delta_s` and
/// shift everything after the clip by the change in length. A head trim keeps
/// the clip's start where it is (the media in-point moves instead).
fn ripple_trim(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let delta = nonzero_delta(p)?;
    let scope = Scope::parse(p)?;
    let head = match opt_str(p, "edge")?.as_deref() {
        Some("head") => true,
        Some("tail") => false,
        _ => return Err(EngineError::invalid("edge must be \"head\" or \"tail\"")),
    };
    let (ti, ci) = doc.require_clip(id)?;
    doc.require_unlocked(ti)?;
    let clip = doc.tracks[ti].clips[ci].clone();
    let old_end = clip.timeline_end();
    let (new_in, new_out) = if head {
        (clip.in_s + delta * clip.speed, clip.out_s)
    } else {
        (clip.in_s, clip.out_s + delta * clip.speed)
    };
    check_span(new_in, new_out, doc.source_of(&clip)?)?;
    let c = &mut doc.tracks[ti].clips[ci];
    c.in_s = new_in;
    c.out_s = new_out;
    let growth = if head { -delta } else { delta };
    shift_after(doc, scope, ti, old_end, growth, Some(id));
    Ok(json!({ "ok": true }))
}

/// `rollEdit {left, right, delta_s}`: move the cut between two touching clips.
/// The left clip's out-point and the right clip's in-point and start follow;
/// nothing else on the timeline moves.
fn roll(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let left = req_u64(p, "left")?;
    let right = req_u64(p, "right")?;
    let delta = nonzero_delta(p)?;
    let (lt, li) = doc.require_clip(left)?;
    let (rt, ri) = doc.require_clip(right)?;
    if lt != rt {
        return Err(EngineError::validation(
            "roll needs two clips on the same track",
        ));
    }
    doc.require_unlocked(lt)?;
    let track = &mut doc.tracks[lt];
    if (track.clips[li].timeline_end() - track.clips[ri].timeline_start_s).abs() > EPS {
        return Err(EngineError::validation(
            "roll needs the left clip to end where the right clip starts",
        ));
    }
    let l = &mut track.clips[li];
    l.out_s += delta * l.speed;
    let r = &mut track.clips[ri];
    r.in_s += delta * r.speed;
    r.timeline_start_s += delta;
    Ok(json!({ "ok": true }))
}

/// `slipClip {id, delta_s}`: show different media in the same timeline slot.
/// `delta_s` is media time; in- and out-point both move by it.
fn slip(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let delta = nonzero_delta(p)?;
    let (ti, ci) = doc.require_clip(id)?;
    doc.require_unlocked(ti)?;
    let c = &mut doc.tracks[ti].clips[ci];
    c.in_s += delta;
    c.out_s += delta;
    Ok(json!({ "ok": true }))
}

/// `slideClip {id, delta_s}`: move the clip along the timeline keeping its
/// media. A clip touching its head extends or shortens its out-point to
/// follow; a clip touching its tail moves its in-point and start. Clips that
/// do not touch it stay put, so the gap on that side grows or shrinks.
fn slide(doc: &mut Doc, p: &Value) -> Result<Value, EngineError> {
    let id = req_u64(p, "id")?;
    let delta = nonzero_delta(p)?;
    let (ti, ci) = doc.require_clip(id)?;
    doc.require_unlocked(ti)?;
    let track = &mut doc.tracks[ti];
    let (start, end) = (
        track.clips[ci].timeline_start_s,
        track.clips[ci].timeline_end(),
    );
    let prev = track
        .clips
        .iter()
        .position(|c| c.id != id && (c.timeline_end() - start).abs() <= EPS);
    let next = track
        .clips
        .iter()
        .position(|c| c.id != id && (c.timeline_start_s - end).abs() <= EPS);
    track.clips[ci].timeline_start_s += delta;
    if let Some(i) = prev {
        let c = &mut track.clips[i];
        c.out_s += delta * c.speed;
    }
    if let Some(i) = next {
        let c = &mut track.clips[i];
        c.in_s += delta * c.speed;
        c.timeline_start_s += delta;
    }
    Ok(json!({ "ok": true }))
}

/// Put `clip` on track `ti` with `placement`, returning the ids of clips that
/// splits created. Validates the result; `reject_message` is the error when
/// `Placement::Reject` finds an overlap.
pub(crate) fn place(
    doc: &mut Doc,
    ti: usize,
    clip: Clip,
    placement: Placement,
    reject_message: &str,
) -> Result<Vec<u64>, EngineError> {
    let start = clip.timeline_start_s;
    let len = clip.timeline_len();
    let end = start + len;
    let mut created = Vec::new();
    match placement {
        Placement::Reject => {
            if doc.overlaps(ti, start, len, Some(clip.id)) {
                return Err(EngineError::validation(reject_message));
            }
        }
        Placement::Overwrite => {
            split_straddling(doc, ti, start, &mut created)?;
            split_straddling(doc, ti, end, &mut created)?;
            doc.tracks[ti]
                .clips
                .retain(|c| !(c.timeline_start_s >= start - EPS && c.timeline_end() <= end + EPS));
            created.retain(|id| doc.clip_location(*id).is_some());
        }
        Placement::Insert(scope) => {
            for t in 0..doc.tracks.len() {
                if t == ti || (scope == Scope::All && !doc.tracks[t].locked) {
                    split_straddling(doc, t, start, &mut created)?;
                }
            }
            shift_after(doc, scope, ti, start, len, None);
        }
    }
    doc.tracks[ti].clips.push(clip);
    doc.normalize();
    doc.validate()?;
    Ok(created)
}

/// Split whichever clip on track `ti` has `at` strictly inside it, if any.
fn split_straddling(
    doc: &mut Doc,
    ti: usize,
    at: f64,
    created: &mut Vec<u64>,
) -> Result<(), EngineError> {
    let hit = doc.tracks[ti]
        .clips
        .iter()
        .position(|c| at > c.timeline_start_s + EPS && at < c.timeline_end() - EPS);
    if let Some(ci) = hit {
        created.push(doc.split_at(ti, ci, at)?);
    }
    Ok(())
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
    /// `(start, in, out)` of each clip on track index `t`, in time order.
    fn spans(e: &mut SpliceEngine, t: usize) -> Vec<(f64, f64, f64)> {
        tl(e)["tracks"][t]["clips"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["timeline_start_s"].as_f64().unwrap(),
                    c["in_s"].as_f64().unwrap(),
                    c["out_s"].as_f64().unwrap(),
                )
            })
            .collect()
    }

    struct Fx {
        e: SpliceEngine,
        src: u64,
        v: u64,
        a: u64,
        /// Three touching 2 s video clips at 0, 2, 4 (media 2..4, 4..6, 6..8).
        clips: [u64; 3],
    }

    fn fixture() -> Fx {
        let mut e = SpliceEngine::new();
        let src = id(
            apply(&mut e, "addSource", json!({ "duration_s": 20.0 })).unwrap(),
            "source_id",
        );
        let v = id(
            apply(&mut e, "addTrack", json!({ "kind": "video" })).unwrap(),
            "track_id",
        );
        let a = id(
            apply(&mut e, "addTrack", json!({ "kind": "audio" })).unwrap(),
            "track_id",
        );
        let mut clips = [0; 3];
        for (i, slot) in clips.iter_mut().enumerate() {
            let m = 2.0 + 2.0 * i as f64;
            *slot = id(
                apply(
                    &mut e,
                    "addClip",
                    json!({ "track": v, "source": src, "in_s": m, "out_s": m + 2.0 }),
                )
                .unwrap(),
                "clip_id",
            );
        }
        // Audio: one clip under the middle video clip, one at 4..6.
        apply(
            &mut e,
            "addClip",
            json!({ "track": a, "source": src, "in_s": 0.0, "out_s": 2.0, "start_s": 2.0 }),
        )
        .unwrap();
        apply(
            &mut e,
            "addClip",
            json!({ "track": a, "source": src, "in_s": 0.0, "out_s": 2.0, "start_s": 4.0 }),
        )
        .unwrap();
        Fx {
            e,
            src,
            v,
            a,
            clips,
        }
    }

    #[test]
    fn ripple_delete_closes_the_gap_in_one_undo_step() {
        let mut f = fixture();
        apply(&mut f.e, "rippleDelete", json!({ "id": f.clips[1] })).unwrap();
        assert_eq!(spans(&mut f.e, 0), vec![(0.0, 2.0, 4.0), (2.0, 6.0, 8.0)]);
        // Track scope leaves audio alone.
        assert_eq!(spans(&mut f.e, 1), vec![(2.0, 0.0, 2.0), (4.0, 0.0, 2.0)]);
        assert!(f.e.undo().unwrap());
        assert_eq!(spans(&mut f.e, 0).len(), 3);
    }

    #[test]
    fn ripple_delete_all_tracks_refuses_to_overlap_and_skips_locked() {
        let mut f = fixture();
        let before = tl(&mut f.e);
        // Audio clip at 2..4 sits under the deleted span, so pulling 4..6 back
        // by 2 s would land on it.
        let err = apply(
            &mut f.e,
            "rippleDelete",
            json!({ "id": f.clips[1], "scope": "all" }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
        assert!(err.message.contains("overlap"), "{}", err.message);
        assert_eq!(tl(&mut f.e), before);
        // Locked audio stays put, so the same ripple succeeds.
        apply(
            &mut f.e,
            "setTrackFlags",
            json!({ "id": f.a, "locked": true }),
        )
        .unwrap();
        apply(
            &mut f.e,
            "rippleDelete",
            json!({ "id": f.clips[1], "scope": "all" }),
        )
        .unwrap();
        assert_eq!(spans(&mut f.e, 1), vec![(2.0, 0.0, 2.0), (4.0, 0.0, 2.0)]);
        assert!(apply(
            &mut f.e,
            "rippleDelete",
            json!({ "id": f.clips[0], "scope": "sideways" })
        )
        .is_err());
    }

    #[test]
    fn ripple_trim_tail_and_head() {
        let mut f = fixture();
        apply(
            &mut f.e,
            "rippleTrim",
            json!({ "id": f.clips[0], "edge": "tail", "delta_s": 1.0 }),
        )
        .unwrap();
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 5.0), (3.0, 4.0, 6.0), (5.0, 6.0, 8.0)]
        );
        // Head trim keeps the start, moves the in-point, pulls later clips back.
        apply(
            &mut f.e,
            "rippleTrim",
            json!({ "id": f.clips[1], "edge": "head", "delta_s": 0.5 }),
        )
        .unwrap();
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 5.0), (3.0, 4.5, 6.0), (4.5, 6.0, 8.0)]
        );
        let before = tl(&mut f.e);
        for bad in [
            json!({ "id": f.clips[0], "edge": "head", "delta_s": -3.0 }), // in-point before media start
            json!({ "id": f.clips[0], "edge": "tail", "delta_s": -3.0 }), // nothing left
            json!({ "id": f.clips[0], "edge": "tail", "delta_s": 0.0 }),
            json!({ "id": f.clips[0], "edge": "middle", "delta_s": 1.0 }),
            json!({ "id": f.clips[2], "edge": "tail", "delta_s": 13.0 }), // past source end
        ] {
            assert!(apply(&mut f.e, "rippleTrim", bad).is_err());
            assert_eq!(tl(&mut f.e), before);
        }
        assert!(f.e.undo().unwrap());
        assert_eq!(spans(&mut f.e, 0)[1], (3.0, 4.0, 6.0));
    }

    #[test]
    fn roll_moves_only_the_cut() {
        let mut f = fixture();
        apply(
            &mut f.e,
            "rollEdit",
            json!({ "left": f.clips[0], "right": f.clips[1], "delta_s": 0.5 }),
        )
        .unwrap();
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 4.5), (2.5, 4.5, 6.0), (4.0, 6.0, 8.0)]
        );
        let before = tl(&mut f.e);
        for bad in [
            json!({ "left": f.clips[0], "right": f.clips[2], "delta_s": 0.5 }), // not touching
            json!({ "left": f.clips[0], "right": f.clips[1], "delta_s": 1.5 }), // empties the right clip
            json!({ "left": f.clips[0], "right": f.clips[1], "delta_s": -2.5 }), // empties the left clip
        ] {
            assert_eq!(
                apply(&mut f.e, "rollEdit", bad).unwrap_err().code,
                ErrorCode::Validation
            );
            assert_eq!(tl(&mut f.e), before);
        }
    }

    #[test]
    fn slip_changes_media_not_position() {
        let mut f = fixture();
        apply(
            &mut f.e,
            "slipClip",
            json!({ "id": f.clips[1], "delta_s": -1.5 }),
        )
        .unwrap();
        assert_eq!(spans(&mut f.e, 0)[1], (2.0, 2.5, 4.5));
        let before = tl(&mut f.e);
        let err = apply(
            &mut f.e,
            "slipClip",
            json!({ "id": f.clips[1], "delta_s": -3.0 }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation); // in-point below 0
        let err = apply(
            &mut f.e,
            "slipClip",
            json!({ "id": f.clips[1], "delta_s": 16.0 }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::OutOfBounds); // out-point past the source
        assert_eq!(tl(&mut f.e), before);
    }

    #[test]
    fn slide_carries_touching_neighbours() {
        let mut f = fixture();
        apply(
            &mut f.e,
            "slideClip",
            json!({ "id": f.clips[1], "delta_s": 0.5 }),
        )
        .unwrap();
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 4.5), (2.5, 4.0, 6.0), (4.5, 6.5, 8.0)]
        );
        // Sliding the last clip right opens a gap after nothing; before it the
        // touching clip grows.
        apply(
            &mut f.e,
            "slideClip",
            json!({ "id": f.clips[2], "delta_s": 1.0 }),
        )
        .unwrap();
        assert_eq!(spans(&mut f.e, 0)[1], (2.5, 4.0, 7.0));
        let before = tl(&mut f.e);
        // The first clip has nothing before it: sliding it left goes below 0.
        let err = apply(
            &mut f.e,
            "slideClip",
            json!({ "id": f.clips[0], "delta_s": -1.0 }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(tl(&mut f.e), before);
    }

    #[test]
    fn overwrite_trims_splits_and_removes() {
        let mut f = fixture();
        // A 3 s clip at 1..4 eats the tail of clip 0 and all of clip 1.
        let r = apply(
            &mut f.e,
            "addClip",
            json!({ "track": f.v, "source": f.src, "in_s": 10.0, "out_s": 13.0, "start_s": 1.0, "mode": "overwrite" }),
        )
        .unwrap();
        let new_id = id(r.clone(), "clip_id");
        assert_eq!(r["created"], json!([]));
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 3.0), (1.0, 10.0, 13.0), (4.0, 6.0, 8.0)]
        );
        // Overwriting inside one clip splits it around the new one.
        let r = apply(
            &mut f.e,
            "moveClip",
            json!({ "id": new_id, "start_s": 4.5, "mode": "overwrite", "track": f.v }),
        );
        // 4.5..7.5 runs past clip 2's end (6): it trims clip 2's tail.
        assert!(r.is_ok());
        assert_eq!(
            spans(&mut f.e, 0),
            vec![(0.0, 2.0, 3.0), (4.0, 6.0, 6.5), (4.5, 10.0, 13.0)]
        );
        let one = id(
            apply(&mut f.e, "addClip", json!({ "track": f.v, "source": f.src, "in_s": 0.0, "out_s": 6.0, "start_s": 10.0 })).unwrap(),
            "clip_id",
        );
        let r = apply(
            &mut f.e,
            "addClip",
            json!({ "track": f.v, "source": f.src, "in_s": 0.0, "out_s": 1.0, "start_s": 12.0, "mode": "overwrite" }),
        )
        .unwrap();
        let right = r["created"][0].as_u64().unwrap();
        let s = spans(&mut f.e, 0);
        assert_eq!(
            &s[3..],
            &[(10.0, 0.0, 2.0), (12.0, 0.0, 1.0), (13.0, 3.0, 6.0)]
        );
        assert_ne!(right, one);
    }

    #[test]
    fn insert_pushes_later_clips_and_splits_the_straddler() {
        let mut f = fixture();
        let r = apply(
            &mut f.e,
            "addClip",
            json!({ "track": f.v, "source": f.src, "in_s": 0.0, "out_s": 1.0, "start_s": 3.0, "mode": "insert" }),
        )
        .unwrap();
        assert_eq!(r["created"].as_array().unwrap().len(), 1);
        assert_eq!(
            spans(&mut f.e, 0),
            vec![
                (0.0, 2.0, 4.0),
                (2.0, 4.0, 5.0),
                (3.0, 0.0, 1.0),
                (4.0, 5.0, 6.0),
                (5.0, 6.0, 8.0)
            ]
        );
        // Track scope: audio did not move.
        assert_eq!(spans(&mut f.e, 1), vec![(2.0, 0.0, 2.0), (4.0, 0.0, 2.0)]);
        assert!(f.e.undo().unwrap());
        assert_eq!(spans(&mut f.e, 0).len(), 3);
        // All scope splits and shifts the audio too.
        apply(
            &mut f.e,
            "addClip",
            json!({ "track": f.v, "source": f.src, "in_s": 0.0, "out_s": 1.0, "start_s": 3.0, "mode": "insert", "scope": "all" }),
        )
        .unwrap();
        assert_eq!(
            spans(&mut f.e, 1),
            vec![(2.0, 0.0, 1.0), (4.0, 1.0, 2.0), (5.0, 0.0, 2.0)]
        );
    }

    #[test]
    fn move_across_tracks_checks_kind_and_lock() {
        let mut f = fixture();
        let o = id(
            apply(&mut f.e, "addTrack", json!({ "kind": "overlay" })).unwrap(),
            "track_id",
        );
        apply(
            &mut f.e,
            "moveClip",
            json!({ "id": f.clips[2], "start_s": 1.0, "track": o }),
        )
        .unwrap();
        assert_eq!(spans(&mut f.e, 2), vec![(1.0, 6.0, 8.0)]);
        assert_eq!(spans(&mut f.e, 0).len(), 2);
        let before = tl(&mut f.e);
        let err = apply(
            &mut f.e,
            "moveClip",
            json!({ "id": f.clips[0], "start_s": 0.0, "track": f.a }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
        apply(
            &mut f.e,
            "setTrackFlags",
            json!({ "id": o, "locked": true }),
        )
        .unwrap();
        let err = apply(
            &mut f.e,
            "moveClip",
            json!({ "id": f.clips[0], "start_s": 9.0, "track": o }),
        )
        .unwrap_err();
        assert!(err.message.contains("locked"));
        let err = apply(
            &mut f.e,
            "moveClip",
            json!({ "id": f.clips[0], "start_s": 9.0, "mode": "sideways" }),
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Validation);
        assert_eq!(tl(&mut f.e)["tracks"][0], before["tracks"][0]);
    }
}
