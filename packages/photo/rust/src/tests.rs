use super::*;
fn apply(e: &mut PhotoEngine, op: &str, p: Value) -> Value {
    e.apply(Command::new(op, p)).unwrap().data
}
fn descriptor(hash: &str) -> Value {
    json!({"sha256":hash,"asset_ref":"original:retained-1","byte_length":20815398,"camera_make":"Pentax","camera_model":"K-7"})
}
fn import(e: &mut PhotoEngine) -> Value {
    apply(e, "addOriginal", descriptor(&"a".repeat(64)))
}
#[test]
fn identity_metadata_version_history_and_roundtrip() {
    let mut e = PhotoEngine::new();
    let ids = import(&mut e);
    let id = ids["original_id"].as_str().unwrap();
    let first = ids["version_id"].as_str().unwrap();
    apply(&mut e, "setRating", json!({"id":id,"rating":5}));
    apply(
        &mut e,
        "setLabels",
        json!({"id":id,"labels":["travel","favorite"]}),
    );
    let snapshot = e.snapshot().unwrap();
    let copy = apply(
        &mut e,
        "createVersion",
        json!({"original_id":id,"name":"Alternate"}),
    );
    let version = copy["version_id"].as_str().unwrap();
    assert_ne!(version, first);
    apply(
        &mut e,
        "renameVersion",
        json!({"id":version,"name":"Second"}),
    );
    apply(&mut e, "removeVersion", json!({"id":first}));
    assert!(e
        .apply(Command::new("removeVersion", json!({"id":version})))
        .is_err());
    let changed = e.snapshot().unwrap();
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), snapshot);
    assert!(e.redo().unwrap());
    assert!(e.redo().unwrap());
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    let mut reopened = PhotoEngine::new();
    reopened.restore(&changed).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), changed);
    let o = &reopened.state.originals[id];
    assert_eq!(o.sha256, "a".repeat(64));
    assert_eq!(o.rating, 5);
    assert_eq!(o.labels, vec!["favorite", "travel"]);
    let before_remove = reopened.snapshot().unwrap();
    apply(&mut reopened, "removeOriginal", json!({"id":id}));
    assert!(reopened.state.originals.is_empty() && reopened.state.versions.is_empty());
    assert!(reopened.undo().unwrap());
    assert_eq!(reopened.snapshot().unwrap(), before_remove);
}
#[test]
fn errors_noops_and_reads_preserve_redo() {
    let mut e = PhotoEngine::new();
    let ids = import(&mut e);
    let id = ids["original_id"].as_str().unwrap();
    apply(&mut e, "setRating", json!({"id":id,"rating":4}));
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    for (op, p) in [
        ("addOriginal", descriptor(&"a".repeat(64))),
        ("setRating", json!({"id":id,"rating":6})),
        ("setLabels", json!({"id":id,"labels":["same","same"]})),
        ("createVersion", json!({"original_id":"missing","name":"X"})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    for (op, p) in [
        ("setRating", json!({"id":id,"rating":0})),
        ("describe", json!({})),
        ("readOriginal", json!({"id":id})),
    ] {
        assert!(e.apply(Command::new(op, p)).unwrap().events.is_empty());
    }
    assert!(e.redo().unwrap());
    assert_eq!(e.state.originals[id].rating, 4);
}
#[test]
fn foreign_malformed_and_oversized_restore_are_atomic() {
    let mut e = PhotoEngine::new();
    import(&mut e);
    let before = e.snapshot().unwrap();
    let valid = serde_json::to_value(&*e.state).unwrap();
    let mut invalid = valid.clone();
    invalid["kind"] = json!("prism");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
        .is_err());
    assert!(e
        .restore(&encode_envelope(
            br#"{"next_sheet":1,"sheets":[],"active":0}"#
        ))
        .is_err());
    for (field, value) in [
        ("schema", json!(2)),
        ("next_id", json!(1)),
        ("unexpected", json!(true)),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    let mut invalid = valid.clone();
    invalid["versions"] = json!({});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
        .is_err());
    assert!(e
        .restore(&encode_envelope(&vec![b' '; MAX_BYTES + 1]))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.undo().unwrap());
    assert!(e.state.originals.is_empty());
}
#[test]
fn staged_batch_failure_rolls_back_and_success_is_one_undo() {
    let mut e = PhotoEngine::new();
    let ids = import(&mut e);
    let id = ids["original_id"].as_str().unwrap();
    let before = e.snapshot().unwrap();
    let batch = json!({"commands":[{"op":"setRating","payload":{"id":id,"rating":3}},{"op":"setLabels","payload":{"id":id,"labels":[""]}}]});
    assert!(e
        .apply(Command::new(ignition_core::OP_BATCH, batch))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let batch = json!({"commands":[{"op":"setRating","payload":{"id":id,"rating":3}},{"op":"setLabels","payload":{"id":id,"labels":["real"]}}]});
    e.apply(Command::new(ignition_core::OP_BATCH, batch))
        .unwrap();
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn history_capacity_and_record_sharing_are_explicit() {
    let mut e = PhotoEngine::new();
    import(&mut e);
    let other = apply(&mut e, "addOriginal", descriptor(&"b".repeat(64)))["original_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let shared = Arc::clone(&e.state.originals[&other]);
    for i in 0..20 {
        apply(
            &mut e,
            "setRating",
            json!({"id":"original-1","rating":i%5+1}),
        );
    }
    assert!(Arc::ptr_eq(&shared, &e.state.originals[&other]));
    let mut count = 0;
    while e.undo().unwrap() {
        count += 1;
    }
    assert_eq!(count, HISTORY);
}
#[test]
fn total_state_budget_rejects_a_mutation_before_commit() {
    let mut e = PhotoEngine::new();
    // Large metadata may fit each per-record limit but must also fit the total cap.
    let labels: Vec<_> = (0..32)
        .map(|i| format!("{i:02}{}", "x".repeat(62)))
        .collect();
    let mut state = State::default();
    for n in 1..=3500u64 {
        let id = alloc(&mut state, "original-").unwrap();
        let version = alloc(&mut state, "version-").unwrap();
        state.originals.insert(
            id.clone(),
            Arc::new(Original {
                id: id.clone(),
                sha256: format!("{n:064x}"),
                asset_ref: format!("asset:{n}"),
                byte_length: 1,
                camera_make: String::new(),
                camera_model: String::new(),
                rating: 0,
                labels: labels.clone(),
            }),
        );
        state.versions.insert(
            version.clone(),
            Arc::new(Version {
                id: version,
                original_id: id,
                name: "Original".into(),
            }),
        );
    }
    let before = e.snapshot().unwrap();
    assert!(e.replace(state, json!({"ok":true})).is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(!e.undo().unwrap());
}

#[test]
fn descriptor_limits_counter_exhaustion_and_restored_references_reject_atomically() {
    let mut e = PhotoEngine::new();
    let before = e.snapshot().unwrap();
    for (field, value) in [
        ("sha256", json!("A".repeat(64))),
        ("asset_ref", json!("/tmp/not-an-opaque-asset")),
        ("byte_length", json!(0)),
        ("camera_model", json!("x".repeat(129))),
    ] {
        let mut invalid = descriptor(&"a".repeat(64));
        invalid[field] = value;
        assert!(e.apply(Command::new("addOriginal", invalid)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    import(&mut e);
    let before = e.snapshot().unwrap();
    let mut bad_state = serde_json::to_value(&*e.state).unwrap();
    bad_state["versions"]["version-2"]["original_id"] = json!("original-999");
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&bad_state).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut exhausted = (*e.state).clone();
    exhausted.next_id = MAX_ID;
    e.state = Arc::new(exhausted);
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("addOriginal", descriptor(&"b".repeat(64))))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
