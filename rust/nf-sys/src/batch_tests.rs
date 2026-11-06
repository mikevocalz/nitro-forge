use crate::{factory, Command, Engine, EngineKind};
use serde_json::{json, Value};

fn batch(engine: &mut dyn Engine, steps: Value) -> Result<ignition_core::CommandResult, ignition_core::EngineError> {
    engine.apply(Command::new("__batch", json!({ "commands": steps })))
}

#[test]
fn compound_edits_are_atomic_single_history_entries_for_all_seven_engines() {
    let cases = [
        (EngineKind::Prism, json!({"width":2,"height":2}),
         json!({"op":"setColors","payload":{"foreground":[10,20,30,255]}}),
         json!([{"op":"setColors","payload":{"foreground":[40,50,60,255]}},
                {"op":"setColors","payload":{"background":[70,80,90,255]}}])),
        (EngineKind::Cadence, json!({}), json!({"op":"setTempo","payload":{"bpm":130}}),
         json!([{"op":"setTempo","payload":{"bpm":140}},
                {"op":"setTimeSig","payload":{"n":3,"d":4}}])),
        (EngineKind::Splice, json!({}), json!({"op":"addSource","payload":{"duration_s":10,"name":"before"}}),
         json!([{"op":"addSource","payload":{"duration_s":20,"name":"first"}},
                {"op":"addSource","payload":{"duration_s":30,"name":"second"}}])),
        (EngineKind::Folio, json!({"pages":1}), json!({"op":"rotatePage","payload":{"page":0,"degrees":90}}),
         json!([{"op":"rotatePage","payload":{"page":0,"degrees":180}},
                {"op":"rotatePage","payload":{"page":0,"degrees":270}}])),
        (EngineKind::Pitch, json!({}), json!({"op":"addSlide"}),
         json!([{"op":"addSlide"},{"op":"addSlide"}])),
        (EngineKind::Tally, json!({}), json!({"op":"setCell","payload":{"addr":"A1","value":"1"}}),
         json!([{"op":"setCell","payload":{"addr":"A1","value":"2"}},
                {"op":"setCell","payload":{"addr":"B1","value":"3"}}])),
        (EngineKind::Quill, json!({}), json!({"op":"insertText","payload":{"at":{"block":0,"offset":0},"text":"base"}}),
         json!([{"op":"insertText","payload":{"at":{"block":0,"offset":0},"text":"first "}},
                {"op":"insertText","payload":{"at":{"block":0,"offset":0},"text":"second "}}])),
    ];
    for (kind, initial, previous, edits) in cases {
        let mut engine = factory(kind).unwrap();
        engine.apply(Command::new("new", initial)).unwrap();
        let original = engine.snapshot().unwrap();
        engine.apply(serde_json::from_value(previous).unwrap()).unwrap();
        let before = engine.snapshot().unwrap();
        let result = batch(engine.as_mut(), edits.clone()).unwrap();
        assert_eq!(result.data["results"].as_array().unwrap().len(), 2, "{kind:?}");
        assert_eq!(result.events.iter().filter(|e| e.kind == "document:changed").count(), 1, "{kind:?}");
        let after = engine.snapshot().unwrap();
        assert_ne!(after, before, "{kind:?}");
        assert!(engine.undo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), before, "compound undo {kind:?}");
        assert!(engine.undo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), original, "prior history {kind:?}");
        assert!(engine.redo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), before, "prior redo {kind:?}");

        let read = batch(engine.as_mut(), json!([{"op":"describe"},{"op":"describe"}])).unwrap();
        assert!(read.events.is_empty(), "read-only batch {kind:?}");
        assert_eq!(engine.snapshot().unwrap(), before);
        assert!(engine.redo().unwrap(), "read-only batch erased redo {kind:?}");
        assert_eq!(engine.snapshot().unwrap(), after);
        assert!(engine.undo().unwrap());

        let error = batch(engine.as_mut(), json!([edits[0], {"op":"notAnEngineOperation"}])).unwrap_err();
        assert!(error.recoverable);
        assert_eq!(engine.snapshot().unwrap(), before, "failed batch leaked mutation {kind:?}");
        assert!(engine.redo().unwrap(), "failed batch erased redo {kind:?}");
        assert_eq!(engine.snapshot().unwrap(), after);
    }
}

#[test]
fn rejected_batches_do_not_mutate_or_erase_history() {
    let mut engine = factory(EngineKind::Cadence).unwrap();
    engine.apply(Command::new("new", json!({}))).unwrap();
    engine.apply(Command::new("setTempo", json!({"bpm":130}))).unwrap();
    engine.undo().unwrap();
    let before = engine.snapshot().unwrap();
    let invalid = [
        json!([]),
        json!([{"op":"__batch","payload":{"commands":[{"op":"describe"}]}}]),
        json!([{"op":"__undo"}]), json!([{"op":"__redo"}]), json!([{"op":"__snapshot"}]),
        json!([{"op":"describe","v":2}]),
        json!([{"op":"describe","input":[1]}]),
        json!(vec![json!({"op":"describe"}); 65]),
    ];
    for steps in invalid {
        assert!(batch(engine.as_mut(), steps).is_err());
        assert_eq!(engine.snapshot().unwrap(), before);
    }
    let mut wrong_version = Command::new("__batch", json!({"commands":[{"op":"describe"}]}));
    wrong_version.v = 2;
    assert!(engine.apply(wrong_version).is_err());
    let binary = Command::new("__batch", json!({"commands":[{"op":"describe"}]})).with_binary(Some(vec![1]));
    assert!(engine.apply(binary).is_err());
    assert_eq!(engine.snapshot().unwrap(), before);
    assert!(engine.redo().unwrap());
    assert_eq!(engine.apply(Command::new("describe", json!({}))).unwrap().data["tempo_bpm"].as_f64(), Some(130.0));
}

#[test]
fn pixel_mutations_and_output_budget_failures_leave_shared_raster_bytes_unchanged() {
    let mut engine = factory(EngineKind::Prism).unwrap();
    engine.apply(Command::new("new", json!({"width":512,"height":512}))).unwrap();
    let id = engine.apply(Command::new("addRasterLayer", json!({}))).unwrap().data["layer_id"].clone();
    engine.apply(Command::new("fillLayer", json!({"id":id,"color":[255,0,0,255]}))).unwrap();
    let before = engine.snapshot().unwrap();
    let mut steps = vec![json!({"op":"fillLayer","payload":{"id":id,"color":[0,0,255,255]}})];
    steps.extend((0..25).map(|_| json!({"op":"describe"})));
    let error = batch(engine.as_mut(), json!(steps)).unwrap_err();
    assert!(error.message.contains("32 MiB"));
    assert_eq!(engine.snapshot().unwrap(), before);
    assert!(engine.undo().unwrap(), "prior pixel history was erased");
    assert_ne!(engine.snapshot().unwrap(), before);
}

#[test]
fn restore_replaces_history_but_failed_restore_preserves_it_for_every_engine() {
    for kind in [EngineKind::Prism, EngineKind::Cadence, EngineKind::Splice,
        EngineKind::Folio, EngineKind::Pitch, EngineKind::Tally, EngineKind::Quill] {
        let mut engine = factory(kind).unwrap();
        let initial = match kind {
            EngineKind::Prism => json!({"width":4,"height":4}),
            EngineKind::Folio => json!({"pages":1}),
            _ => json!({}),
        };
        engine.apply(Command::new("new", initial)).unwrap();
        let snapshot = engine.snapshot().unwrap();
        let described = engine.apply(Command::new("describe", json!({}))).unwrap().data;
        // Every engine records the initialization as a mutation.
        assert!(engine.restore(b"invalid snapshot").is_err());
        assert_eq!(engine.snapshot().unwrap(), snapshot);
        assert!(engine.undo().unwrap(), "failed restore erased history {kind:?}");
        assert!(engine.redo().unwrap());
        engine.restore(&snapshot).unwrap();
        assert_eq!(engine.apply(Command::new("describe", json!({}))).unwrap().data, described);
        assert!(!engine.undo().unwrap(), "old undo survived restore {kind:?}");
        assert!(!engine.redo().unwrap(), "old redo survived restore {kind:?}");
    }
}
