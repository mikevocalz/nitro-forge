//! Stable section boundaries follow their start slide; removal never removes slides.
use super::*;
use std::collections::BTreeSet;
const MAX_SECTIONS: usize = 1024;
const MAX_ID: u64 = 9_007_199_254_740_991;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Section {
    pub id: u64,
    pub label: String,
    pub start_slide_id: u64,
}
pub(super) fn default_next_id() -> u64 {
    1
}
pub(super) fn validate(state: &PitchState) -> Result<(), EngineError> {
    if state.sections.len() > MAX_SECTIONS
        || state.next_section_id == 0
        || state.next_section_id > MAX_ID
    {
        return Err(EngineError::validation("invalid section count or counter"));
    }
    let (mut ids, mut starts) = (BTreeSet::new(), BTreeSet::new());
    for section in &state.sections {
        if section.id == 0
            || section.id >= state.next_section_id
            || !ids.insert(section.id)
            || !starts.insert(section.start_slide_id)
            || !state.slides.iter().any(|s| s.id == section.start_slide_id)
            || section.label.trim().is_empty()
            || section.label.len() > 1024
        {
            return Err(EngineError::validation(
                "invalid section identity, label or start slide",
            ));
        }
    }
    Ok(())
}
pub(super) fn apply(engine: &mut PitchEngine, cmd: &Command) -> Result<CommandResult, EngineError> {
    let p = &cmd.payload;
    let mut next = engine.state.clone();
    let mut data = json!({"ok":true});
    match cmd.op.as_str() {
        "addSection" => {
            let label = req_str(p, "label")?.to_string();
            let start_slide_id = req_u64(p, "start_slide")?;
            let id = next.next_section_id;
            next.next_section_id = id
                .checked_add(1)
                .ok_or_else(|| EngineError::validation("section counter exhausted"))?;
            next.sections.push(Section {
                id,
                label,
                start_slide_id,
            });
            data = json!({"section_id":id});
        }
        "updateSection" | "removeSection" => {
            let id = req_u64(p, "id")?;
            let index = next
                .sections
                .iter()
                .position(|s| s.id == id)
                .ok_or_else(|| EngineError::not_found("unknown section"))?;
            if cmd.op == "removeSection" {
                next.sections.remove(index);
            } else {
                if p.get("label").is_some() {
                    next.sections[index].label = req_str(p, "label")?.to_string()
                }
                if p.get("start_slide").is_some() {
                    next.sections[index].start_slide_id = req_u64(p, "start_slide")?
                }
            }
        }
        _ => return Err(EngineError::unsupported("unknown section operation")),
    }
    validate(&next)?;
    if next == engine.state {
        return Ok(ro(data));
    }
    engine.journal.record(engine.state.clone());
    engine.state = next;
    Ok(CommandResult::data(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(e: &mut PitchEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn slide(e: &mut PitchEngine) -> u64 {
        call(e, "addSlide", json!({})).data["slide_id"]
            .as_u64()
            .unwrap()
    }
    #[test]
    fn sections_are_stable_atomic_and_follow_slide_identity() {
        let mut e = PitchEngine::new();
        let s1 = e.state.slides[0].id;
        let s2 = slide(&mut e);
        let s3 = slide(&mut e);
        let a = call(
            &mut e,
            "addSection",
            json!({"label":"Opening","start_slide":s1}),
        )
        .data["section_id"]
            .as_u64()
            .unwrap();
        let b = call(
            &mut e,
            "addSection",
            json!({"label":"Body","start_slide":s2}),
        )
        .data["section_id"]
            .as_u64()
            .unwrap();
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("addSection", json!({"label":"Duplicate","start_slide":s1})),
            ("addSection", json!({"label":" ","start_slide":s3})),
            (
                "addSection",
                json!({"label":"x".repeat(1025),"start_slide":s3}),
            ),
            ("addSection", json!({"label":"Missing","start_slide":99999})),
            (
                "updateSection",
                json!({"id":a,"label":"Changed","start_slide":s2}),
            ),
            ("updateSection", json!({"id":a,"label":null})),
            ("removeSection", json!({"id":99999})),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before)
        }
        let result = call(
            &mut e,
            "updateSection",
            json!({"id":a,"label":"New opening","start_slide":s3}),
        );
        assert_eq!(result.events.len(), 1);
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        for p in [
            json!({"id":a}),
            json!({"id":a,"label":"Opening","start_slide":s1}),
        ] {
            assert!(call(&mut e, "updateSection", p).events.is_empty())
        }
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        call(&mut e, "moveSlides", json!({"order":[s3,s2,s1]}));
        assert_eq!(e.state.sections[0].id, a);
        assert_eq!(e.state.sections[0].start_slide_id, s3);
        let prior_delete = e.snapshot().unwrap();
        call(&mut e, "removeSlide", json!({"id":s3}));
        assert_eq!(
            e.state.sections.iter().map(|s| s.id).collect::<Vec<_>>(),
            vec![b]
        );
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), prior_delete);
        call(&mut e, "removeSlides", json!({"ids":[s2,s3]}));
        assert!(e.state.sections.is_empty());
        assert_eq!(e.state.slides.len(), 1);
        assert!(e.undo().unwrap());
        let slides = e.state.slides.clone();
        call(&mut e, "removeSection", json!({"id":b}));
        assert_eq!(e.state.slides, slides);
        let saved = e.snapshot().unwrap();
        let mut reopened = PitchEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), saved);
    }
    #[test]
    fn legacy_defaults_and_corrupt_restore_preserve_state_and_redo() {
        let mut e = PitchEngine::new();
        let start = e.state.slides[0].id;
        let mut legacy = serde_json::to_value(&e.state).unwrap();
        legacy.as_object_mut().unwrap().remove("sections");
        legacy.as_object_mut().unwrap().remove("next_section_id");
        e.restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
            .unwrap();
        assert!(e.state.sections.is_empty());
        assert_eq!(e.state.next_section_id, 1);
        let original = e.snapshot().unwrap();
        let added = call(
            &mut e,
            "addSection",
            json!({"label":"A","start_slide":start}),
        );
        assert_eq!(added.data["section_id"], 1);
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        for (sections, counter) in [
            (
                json!([{"id":1,"label":"A","start_slide_id":start},{"id":1,"label":"B","start_slide_id":start}]),
                2,
            ),
            (json!([{"id":1,"label":"A","start_slide_id":99999}]), 2),
            (json!([{"id":1,"label":"A","start_slide_id":start}]), 1),
            (json!([{"id":1,"label":" ","start_slide_id":start}]), 2),
            (json!([]), 0),
            (
                json!(vec![
                    json!({"id":1,"label":"A","start_slide_id":start});
                    1025
                ]),
                2,
            ),
        ] {
            let mut malformed = serde_json::to_value(&e.state).unwrap();
            malformed["sections"] = sections;
            malformed["next_section_id"] = json!(counter);
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&malformed).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), original);
            assert!(e.redo().unwrap());
            assert_eq!(e.snapshot().unwrap(), changed);
            assert!(e.undo().unwrap());
        }
    }
}
