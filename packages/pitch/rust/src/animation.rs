//! Deterministic geometry/opacity evaluation; host supplies actual slide-relative click times.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
const LIMIT: usize = 4096;
const MAX_TIME: f64 = 86400.0;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Trigger {
    #[default]
    Absolute,
    OnClick {
        click_index: u16,
    },
    WithPrevious,
    AfterPrevious,
}
impl Trigger {
    pub(super) fn is_absolute(&self) -> bool {
        matches!(self, Self::Absolute)
    }
}
pub(super) fn parse_trigger(value: &Value) -> Result<Trigger, EngineError> {
    let object = value
        .as_object()
        .filter(|v| v.len() <= 2)
        .ok_or_else(|| error("invalid animation trigger shape"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| error("trigger type required"))?;
    match kind {
        "absolute" if object.len() == 1 => Ok(Trigger::Absolute),
        "with-previous" if object.len() == 1 => Ok(Trigger::WithPrevious),
        "after-previous" if object.len() == 1 => Ok(Trigger::AfterPrevious),
        "on-click" if object.len() == 2 => {
            let index = object
                .get("click_index")
                .and_then(Value::as_u64)
                .filter(|n| *n < 256)
                .ok_or_else(|| error("click index must be below 256"))?;
            Ok(Trigger::OnClick {
                click_index: index as u16,
            })
        }
        _ => Err(error("unknown or unsupported animation trigger")),
    }
}
pub(super) fn parse_clicks(p: &Value) -> Result<Vec<f64>, EngineError> {
    match p.get("click_times") {
        None => Ok(vec![]),
        Some(value) => value
            .as_array()
            .filter(|v| v.len() <= 256)
            .ok_or_else(|| error("click_times must be an array of at most 256 timestamps"))?
            .iter()
            .map(|v| {
                v.as_f64()
                    .ok_or_else(|| error("click time must be numeric"))
            })
            .collect(),
    }
}
fn error(message: &str) -> EngineError {
    EngineError::validation(message)
}
fn starts(anims: &[Anim], clicks: &[f64]) -> Result<Vec<Option<f64>>, EngineError> {
    if anims.len() > LIMIT
        || clicks.len() > 256
        || clicks
            .iter()
            .any(|t| !t.is_finite() || *t < 0.0 || *t > MAX_TIME)
        || clicks.windows(2).any(|w| w[0] > w[1])
    {
        return Err(error("animation or click-time limits exceeded"));
    }
    let mut resolved: Vec<Option<f64>> = Vec::with_capacity(anims.len());
    for (index, anim) in anims.iter().enumerate() {
        if !anim.start_s.is_finite()
            || anim.start_s < 0.0
            || anim.start_s > MAX_TIME
            || !anim.duration_s.is_finite()
            || anim.duration_s <= 0.0
            || anim.duration_s > MAX_TIME
        {
            return Err(error("animation times must be finite within 86400 seconds"));
        }
        let start = match anim.trigger {
            Trigger::Absolute => Some(anim.start_s),
            Trigger::OnClick { click_index } => {
                if click_index >= 256 {
                    return Err(error("click index must be below 256"));
                }
                clicks
                    .get(usize::from(click_index))
                    .map(|time| *time + anim.start_s)
            }
            Trigger::WithPrevious | Trigger::AfterPrevious => {
                if index == 0 {
                    return Err(error("first animation has no predecessor"));
                }
                resolved[index - 1].map(|start| {
                    start
                        + anim.start_s
                        + if matches!(anim.trigger, Trigger::AfterPrevious) {
                            anims[index - 1].duration_s
                        } else {
                            0.0
                        }
                })
            }
        };
        if start.is_some_and(|start| !start.is_finite() || start + anim.duration_s > MAX_TIME) {
            return Err(error("resolved animation timeline exceeds 86400 seconds"));
        }
        resolved.push(start);
    }
    Ok(resolved)
}
pub(super) fn validate_slide(slide: &Slide) -> Result<(), EngineError> {
    if slide.objects.len() > LIMIT {
        return Err(error("animation object budget exceeds 4096"));
    }
    let ids: BTreeSet<_> = slide.objects.iter().map(|object| object.id).collect();
    if ids.len() != slide.objects.len() {
        return Err(error("duplicate slide object identity"));
    }
    if slide
        .animations
        .iter()
        .any(|anim| !ids.contains(&anim.object_id))
    {
        return Err(error("animation references a missing object"));
    }
    // Zero is the earliest admitted click time. Validate even pending chains so
    // an impossible program cannot enter durable state. Actual later clicks
    // remain subject to the same read-time timeline bound.
    starts(&slide.animations, &[0.0; 256])?;
    Ok(())
}

pub(super) fn validate_state(state: &PitchState) -> Result<(), EngineError> {
    for slide in &state.slides {
        validate_slide(slide)?;
    }
    Ok(())
}
fn object(
    obj: &Obj,
    anims: &[(usize, &Anim)],
    starts: &[Option<f64>],
    time: f64,
) -> Result<Value, EngineError> {
    let (mut x, mut y, mut w, mut h, mut opacity, mut rotation) =
        (obj.x, obj.y, obj.w, obj.h, 1.0f64, obj.rotation_deg);
    for (index, a) in anims {
        let p = starts[*index].map_or(0.0, |start| ((time - start) / a.duration_s).clamp(0.0, 1.0));
        let scale = match a.kind {
            AnimKind::FadeIn => {
                opacity *= p;
                1.0
            }
            AnimKind::SlideInLeft => {
                opacity *= p;
                x -= SLIDE_IN_OFFSET * (1.0 - p);
                1.0
            }
            AnimKind::ZoomIn => {
                opacity *= p;
                ZOOM_START_SCALE + (1.0 - ZOOM_START_SCALE) * p
            }
            AnimKind::Pulse => 1.0 + 0.2 * (1.0 - (2.0 * p - 1.0).abs()),
            AnimKind::Spin => {
                rotation += 360.0 * p;
                1.0
            }
            AnimKind::FadeOut => {
                opacity *= 1.0 - p;
                1.0
            }
            AnimKind::ZoomOut => {
                opacity *= 1.0 - p;
                1.0 - 0.5 * p
            }
        };
        if scale != 1.0 {
            let cx = x + w / 2.0;
            let cy = y + h / 2.0;
            w *= scale;
            h *= scale;
            x = cx - w / 2.0;
            y = cy - h / 2.0;
        }
    }
    if ![x, y, w, h, opacity, rotation]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err(error("evaluated animation geometry overflow"));
    }
    Ok(json!({"id":obj.id,"x":x,"y":y,"w":w,"h":h,"rotation":rotation,"opacity":opacity}))
}
pub(super) fn slide_at(
    slide: &Slide,
    time: f64,
    clicks: &[f64],
) -> Result<CommandResult, EngineError> {
    if !time.is_finite() || slide.objects.len() > LIMIT {
        return Err(error("invalid evaluation time/object budget"));
    }
    validate_slide(slide)?;
    let starts = starts(&slide.animations, clicks)?;
    let mut groups = BTreeMap::<u64, Vec<(usize, &Anim)>>::new();
    for (index, anim) in slide.animations.iter().enumerate() {
        groups
            .entry(anim.object_id)
            .or_default()
            .push((index, anim));
    }
    let objects: Result<Vec<_>, _> = slide
        .objects
        .iter()
        .map(|obj| {
            object(
                obj,
                groups.get(&obj.id).map(Vec::as_slice).unwrap_or(&[]),
                &starts,
                time,
            )
        })
        .collect();
    let schedule:Vec<_>=slide.animations.iter().enumerate().map(|(index,anim)|json!({"index":index,"start_s":starts[index],"end_s":starts[index].map(|start|start+anim.duration_s)})).collect();
    Ok(ro(json!({"objects":objects?,"schedule":schedule})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut PitchEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn fixture() -> (PitchEngine, u64) {
        let mut e = PitchEngine::new();
        let id = apply(
            &mut e,
            "addRect",
            json!({"slide":1,"x":10,"y":20,"w":40,"h":20,"fill":[255,0,0,255]}),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(
            &mut e,
            "rotateObject",
            json!({"slide":1,"id":id,"degrees":15}),
        );
        (e, id)
    }
    fn add(e: &mut PitchEngine, id: u64, kind: &str, trigger: Trigger) {
        apply(
            e,
            "addAnimation",
            json!({"slide":1,"object":id,"kind":kind,"start_s":0,"duration_s":2,"trigger":trigger}),
        );
    }
    fn at(e: &mut PitchEngine, t: f64, clicks: &[f64]) -> Value {
        apply(
            e,
            "slideAt",
            json!({"slide":1,"t_s":t,"click_times":clicks}),
        )
    }
    #[test]
    fn real_effect_geometry_opacity_and_repeated_object_order() {
        for (kind, width, opacity, rotation) in [
            ("pulse", 48.0, 1.0, 15.0),
            ("spin", 40.0, 1.0, 195.0),
            ("fadeOut", 40.0, 0.5, 15.0),
            ("zoomOut", 30.0, 0.5, 15.0),
        ] {
            let (mut e, id) = fixture();
            add(&mut e, id, kind, Trigger::Absolute);
            let midpoint = at(&mut e, 1.0, &[]);
            let obj = &midpoint["objects"][0];
            assert!((obj["w"].as_f64().unwrap() - width).abs() < 1e-10);
            assert_eq!(obj["opacity"], opacity);
            assert_eq!(obj["rotation"], rotation);
            assert_eq!(at(&mut e, -1.0, &[])["objects"][0]["opacity"], 1.0);
        }
        let (mut e, id) = fixture();
        add(&mut e, id, "pulse", Trigger::Absolute);
        add(&mut e, id, "zoomOut", Trigger::Absolute);
        let value = at(&mut e, 1.0, &[]);
        assert!((value["objects"][0]["w"].as_f64().unwrap() - 36.0).abs() < 1e-10);
        assert_eq!(value["objects"][0]["x"], 12.0);
        assert_eq!(value["objects"][0]["opacity"], 0.5);
    }
    #[test]
    fn clicks_are_explicit_pending_propagates_and_relative_delays_resolve() {
        let (mut e, id) = fixture();
        add(&mut e, id, "fadeIn", Trigger::OnClick { click_index: 0 });
        apply(
            &mut e,
            "updateAnimation",
            json!({"slide":1,"index":0,"start_s":0.5}),
        );
        add(&mut e, id, "spin", Trigger::WithPrevious);
        apply(
            &mut e,
            "updateAnimation",
            json!({"slide":1,"index":1,"start_s":0.25,"duration_s":1}),
        );
        add(&mut e, id, "fadeOut", Trigger::AfterPrevious);
        apply(
            &mut e,
            "updateAnimation",
            json!({"slide":1,"index":2,"start_s":0.5,"duration_s":1}),
        );
        let before = e.snapshot().unwrap();
        let pending = at(&mut e, 100.0, &[]);
        assert_eq!(pending["objects"][0]["opacity"], 0.0);
        assert!(pending["schedule"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["start_s"].is_null()));
        let value = at(&mut e, 2.0, &[1.0]);
        assert_eq!(
            value["schedule"],
            json!([{"index":0,"start_s":1.5,"end_s":3.5},{"index":1,"start_s":1.75,"end_s":2.75},{"index":2,"start_s":3.25,"end_s":4.25}])
        );
        assert_eq!(value["objects"][0]["opacity"], 0.25);
        assert_eq!(value["objects"][0]["rotation"], 105.0);
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn trigger_history_legacy_defaults_and_reopen_are_persistent() {
        let (mut e, id) = fixture();
        add(&mut e, id, "fadeOut", Trigger::Absolute);
        let legacy = e.snapshot().unwrap();
        assert!(
            serde_json::to_value(&e.state).unwrap()["slides"][0]["animations"][0]
                .get("trigger")
                .is_none()
        );
        apply(
            &mut e,
            "updateAnimation",
            json!({"slide":1,"index":0,"trigger":{"type":"on-click","click_index":0}}),
        );
        let changed = e.snapshot().unwrap();
        let expected = at(&mut e, 1.0, &[0.0]);
        let mut reopened = PitchEngine::new();
        reopened.restore(&changed).unwrap();
        assert_eq!(at(&mut reopened, 1.0, &[0.0]), expected);
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), legacy);
        let noop = e
            .apply(Command::new(
                "updateAnimation",
                json!({"slide":1,"index":0,"trigger":{"type":"absolute"}}),
            ))
            .unwrap();
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
    }
    #[test]
    fn invalid_timeline_removals_and_snapshots_preserve_state_and_history() {
        let (mut e, id) = fixture();
        let second = apply(
            &mut e,
            "addRect",
            json!({"slide":1,"x":0,"y":0,"w":1,"h":1,"fill":[0,0,0,255]}),
        )["object_id"]
            .as_u64()
            .unwrap();
        assert!(e.apply(Command::new("addAnimation",json!({"slide":1,"object":id,"kind":"fadeIn","start_s":0,"duration_s":1,"trigger":{"type":"with-previous"}}))).is_err());
        add(&mut e, id, "fadeIn", Trigger::Absolute);
        add(&mut e, second, "spin", Trigger::AfterPrevious);
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("removeAnimation", json!({"slide":1,"index":0})),
            ("removeObject", json!({"slide":1,"id":id})),
            (
                "updateAnimation",
                json!({"slide":1,"index":0,"start_s":86400}),
            ),
            ("slideAt", json!({"slide":1,"t_s":1,"click_times":[1,0]})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        let mut invalid = serde_json::to_value(&e.state).unwrap();
        invalid["slides"][0]["animations"][0]["duration_s"] = json!(0);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].animations.len(), 1);
    }
    #[test]
    fn impossible_click_schedules_reject_before_mutation_and_restore() {
        let (mut e, id) = fixture();
        add(&mut e, id, "spin", Trigger::OnClick { click_index: 0 });
        add(&mut e, id, "fadeOut", Trigger::AfterPrevious);
        let before = e.snapshot().unwrap();
        for index in [0, 1] {
            assert!(e.apply(Command::new("updateAnimation", json!({
                "slide":1,"index":index,"start_s":86400
            }))).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.apply(Command::new("addAnimation", json!({
            "slide":1,"object":id,"kind":"spin","start_s":86400,
            "duration_s":1,"trigger":{"type":"on-click","click_index":255}
        }))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        for index in [0, 1] {
            let mut invalid = serde_json::to_value(&e.state).unwrap();
            invalid["slides"][0]["animations"][index]["start_s"] = json!(86400);
            assert!(e.restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap())).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        // Rejected operations did not add journal entries or replace the document.
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].animations.len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        // A valid earliest schedule can still exceed the limit with late host clicks.
        assert!(e.apply(Command::new("slideAt", json!({
            "slide":1,"t_s":86400,"click_times":[86399]
        }))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn object_and_identity_capacity_rejections_preserve_redo() {
        let (mut e, _) = fixture();
        let template = e.state.slides[0].objects[0].clone();
        e.state.slides[0].objects = (2..4098).map(|id| { let mut o=template.clone(); o.id=id; o }).collect();
        e.state.next_id = 4098;
        apply(&mut e, "setBackground", json!({"slide":1,"color":[1,2,3,255]}));
        assert!(e.undo().unwrap());
        let before=e.snapshot().unwrap();
        for op in ["addText", "addRect", "addImage"] {
            assert!(e.apply(Command::new(op,json!({"slide":1,"x":0,"y":0,"w":1,"h":1,"text":"x","src":"asset","fill":[0,0,0,255]}))).is_err());
            assert_eq!(e.snapshot().unwrap(),before);
        }
        assert!(e.redo().unwrap());
        e.state.next_id=9_007_199_254_740_991;
        let before=e.snapshot().unwrap();
        for op in ["addSlide", "addText", "addRect", "addImage"] {
            assert!(e.apply(Command::new(op,json!({"slide":1,"x":0,"y":0,"w":1,"h":1,"text":"x","src":"asset","fill":[0,0,0,255]}))).is_err());
            assert_eq!(e.snapshot().unwrap(),before);
        }
        let (mut target, _) = fixture();
        let original=target.snapshot().unwrap();
        let mut exhausted=serde_json::to_value(&e.state).unwrap();
        exhausted["next_id"]=json!(u64::MAX);
        assert!(target.restore(&encode_envelope(&serde_json::to_vec(&exhausted).unwrap())).is_err());
        assert_eq!(target.snapshot().unwrap(),original);
        let mut unsafe_state=serde_json::to_value(&e.state).unwrap();
        unsafe_state["next_id"]=json!(9_007_199_254_740_992u64);
        assert!(target.restore(&encode_envelope(&serde_json::to_vec(&unsafe_state).unwrap())).is_err());
        assert_eq!(target.snapshot().unwrap(),original);
        assert!(target.undo().unwrap());
    }
    #[test]
    fn versioned_intent_aliases_match_current_engine_semantics() {
        let (mut legacy, id)=fixture();
        let (mut versioned, _)=fixture();
        let payload=json!({"slide":1,"object":id,"kind":"fadeOut","start_s":0,"duration_s":2,"trigger":{"type":"on-click","click_index":0}});
        assert_eq!(apply(&mut legacy,"addAnimation",payload.clone()),apply(&mut versioned,"addTriggeredAnimationV1",payload));
        let patch=json!({"slide":1,"index":0,"trigger":{"type":"on-click","click_index":1}});
        assert_eq!(apply(&mut legacy,"updateAnimation",patch.clone()),apply(&mut versioned,"updateTriggeredAnimationV1",patch));
        assert_eq!(legacy.snapshot().unwrap(),versioned.snapshot().unwrap());
        let sample=json!({"slide":1,"t_s":2,"click_times":[0,1]});
        assert_eq!(apply(&mut legacy,"slideAt",sample.clone()),apply(&mut versioned,"slideAtWithClicksV1",sample));
    }
    #[test]
    fn extended_snapshots_fail_closed_for_legacy_root_readers() {
        #[derive(Deserialize)]
        #[allow(dead_code)]
        struct LegacyRoot { meta: Meta, next_id: u64, slides: Vec<Slide> }
        let (mut e,id)=fixture();
        let legacy=e.snapshot().unwrap();
        let (_,payload)=decode_envelope(&legacy).unwrap();
        assert!(serde_json::from_slice::<LegacyRoot>(payload).is_ok());
        for variant in 0..4 {
            let mut extended=e.state.clone();
            match variant {
                0=>extended.size.width=1000.,
                1=>extended.next_section_id=2,
                2=>extended.slides[0].animations.push(Anim{object_id:id,kind:AnimKind::FadeIn,start_s:0.,duration_s:1.,trigger:Trigger::OnClick{click_index:0}}),
                _=>extended.slides[0].animations.push(Anim{object_id:id,kind:AnimKind::Spin,start_s:0.,duration_s:1.,trigger:Trigger::Absolute}),
            }
            e.state=extended.clone();
            let snapshot=e.snapshot().unwrap();let (_,payload)=decode_envelope(&snapshot).unwrap();
            let mut wrapper:Value=serde_json::from_slice(payload).unwrap();
            assert_eq!(wrapper["kind"],"pitch");assert_eq!(wrapper["schema"],2);
            // The legacy root reader requires meta/next_id/slides at the root.
            assert!(serde_json::from_slice::<LegacyRoot>(payload).is_err());
            let mut reopened=PitchEngine::new();reopened.restore(&snapshot).unwrap();
            assert_eq!(reopened.state,extended);
            let before=reopened.snapshot().unwrap();
            for (key,value) in [("kind",json!("foreign")),("schema",json!(7))] {
                let old=wrapper[key].clone();wrapper[key]=value;
                assert!(reopened.restore(&encode_envelope(&serde_json::to_vec(&wrapper).unwrap())).is_err());
                assert_eq!(reopened.snapshot().unwrap(),before);wrapper[key]=old;
            }
            e.state=serde_json::from_slice(decode_envelope(&legacy).unwrap().1).unwrap();
        }
    }
    #[test]
    fn work_limits_and_nonfinite_composed_geometry_fail_without_mutation() {
        assert!(parse_clicks(&json!({"click_times":vec![0;257]})).is_err());
        assert!(
            parse_trigger(&json!({"type":"on-click","click_index":0,"unsupported":true})).is_err()
        );

        let (mut e, id) = fixture();
        e.state.slides[0].animations = vec![
            Anim {
                trigger: Trigger::Absolute,
                object_id: id,
                kind: AnimKind::Pulse,
                start_s: 0.0,
                duration_s: 1.0
            };
            LIMIT + 1
        ];
        assert!(e
            .apply(Command::new("slideAt", json!({"slide":1,"t_s":0.5})))
            .is_err());
        e.state.slides[0].animations.truncate(1000);
        e.state.slides[0].objects[0].w = 1e300;
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new("slideAt", json!({"slide":1,"t_s":0.5})))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(starts(
            &[Anim {
                trigger: Trigger::OnClick { click_index: 256 },
                object_id: id,
                kind: AnimKind::Spin,
                start_s: 0.0,
                duration_s: 1.0
            }],
            &[]
        )
        .is_err());
    }
}
