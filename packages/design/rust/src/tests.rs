use super::*;
fn call(e: &mut DesignEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn shape(e: &mut DesignEngine, parent: u64, x: f64, y: f64, w: f64, h: f64, color: [u8; 4]) -> u64 {
    call(
        e,
        "addShape",
        json!({"parent":parent,"kind":"rect","x":x,"y":y,"width":w,"height":h,"fill":color}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap()
}
fn flow(direction: &str, align: &str, justify: &str, gap: f64) -> Value {
    json!({"direction":direction,"gap":gap,"padding_top":1,"padding_right":1,"padding_bottom":1,"padding_left":1,"align":align,"justify":justify})
}
#[test]
fn row_column_distribution_padding_and_stretch_are_evaluated() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":12,"height":8}));
    let a = shape(&mut e, 1, 9., 9., 2., 2., [255, 0, 0, 255]);
    let b = shape(&mut e, 1, 8., 8., 2., 2., [0, 255, 0, 255]);
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":1,"layout":flow("row","center","space-between",1.)}),
    );
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].id, boxes[1].x, boxes[1].y), (a, 1., 3.));
    assert_eq!((boxes[2].id, boxes[2].x, boxes[2].y), (b, 9., 3.));
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":1,"layout":flow("column","stretch","end",1.)}),
    );
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!(
        (boxes[1].x, boxes[1].y, boxes[1].width, boxes[1].height),
        (1., 2., 10., 2.)
    );
    assert_eq!(boxes[2].y, 5.);
    assert_eq!(e.state.nodes[&a].width, 2.);
}
#[test]
fn nested_frames_render_real_pixels_and_inherit_visibility() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":3,"height":1}));
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"x":1,"y":0,"width":1,"height":1}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 0., 0., 1., 1., [7, 8, 9, 255]);
    let before = e.snapshot().unwrap();
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap();
    assert!(pixels.events.is_empty());
    assert_eq!(
        pixels.output.unwrap(),
        [0, 0, 0, 0, 7, 8, 9, 255, 0, 0, 0, 0]
    );
    assert!(call(&mut e, "renderFrame", json!({})).data["pixels_b64"].is_string());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "updateNode", json!({"id":frame,"visible":false}));
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap();
    assert_eq!(pixels.output.unwrap(), [0; 12]);
}
#[test]
fn hierarchy_cycles_locks_order_and_failed_operations_preserve_redo() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    let child = shape(&mut e, frame, 0., 0., 1., 1., [255; 4]);
    let other = shape(&mut e, 1, 0., 0., 1., 1., [0; 4]);
    call(&mut e, "updateNode", json!({"id":frame,"name":"Changed"}));
    let changed = e.snapshot().unwrap();
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    for (op, p) in [
        ("reparentNode", json!({"id":frame,"parent":frame,"index":0})),
        ("reparentNode", json!({"id":frame,"parent":child,"index":0})),
        ("setChildOrder", json!({"parent":1,"order":[frame,frame]})),
        ("removeNode", json!({"id":1})),
        ("updateNode", json!({"id":child,"width":0})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    assert!(
        call(&mut e, "updateNode", json!({"id":frame,"name":"Frame"}))
            .events
            .is_empty()
    );
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    call(&mut e, "updateNode", json!({"id":frame,"locked":true}));
    let locked = e.snapshot().unwrap();
    for (op, p) in [
        ("updateNode", json!({"id":child,"name":"No"})),
        ("removeNode", json!({"id":child})),
        ("addFrame", json!({"parent":frame})),
        ("updateNode", json!({"id":frame,"locked":false,"name":"No"})),
    ] {
        assert!(e.apply(Command::new(op, p)).is_err());
        assert_eq!(e.snapshot().unwrap(), locked);
    }
    call(&mut e, "updateNode", json!({"id":frame,"locked":false}));
    call(
        &mut e,
        "reparentNode",
        json!({"id":child,"parent":1,"index":0}),
    );
    assert_eq!(e.state.nodes[&1].children, vec![child, frame, other]);
    call(
        &mut e,
        "setChildOrder",
        json!({"parent":1,"order":[other,frame,child]}),
    );
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].id, other);
}
#[test]
fn snapshot_foreign_corrupt_orphan_duplicate_parent_and_depth_are_atomic() {
    let mut e = DesignEngine::new();
    let child = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    let snapshot = e.snapshot().unwrap();
    let mut reopen = DesignEngine::new();
    reopen.restore(&snapshot).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), snapshot);
    for mutation in ["foreign", "orphan", "cycle", "duplicate", "counter"] {
        let mut state = (*e.state).clone();
        match mutation {
            "foreign" => state.kind = "photo".into(),
            "orphan" => Arc::make_mut(state.nodes.get_mut(&1).unwrap())
                .children
                .clear(),
            "cycle" => {
                Arc::make_mut(state.nodes.get_mut(&child).unwrap()).kind = Kind::Frame;
                Arc::make_mut(state.nodes.get_mut(&child).unwrap())
                    .children
                    .push(1);
            }
            "duplicate" => Arc::make_mut(state.nodes.get_mut(&1).unwrap())
                .children
                .push(child),
            _ => state.next_id = child,
        };
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), snapshot);
    }
    assert!(e
        .restore(&encode_envelope(&vec![b' '; MAX_BYTES + 1]))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), snapshot);
    assert!(e.undo().unwrap());
    assert_eq!(e.state.nodes.len(), 1);
    let mut e = DesignEngine::new();
    let mut parent = 1;
    for _ in 0..64 {
        parent = call(&mut e, "addFrame", json!({"parent":parent})).data["node_id"]
            .as_u64()
            .unwrap();
    }
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("addFrame", json!({"parent":parent})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn batch_atomicity_net_noops_history_and_subtree_delete() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 0., 0., 1., 1., [255; 4]);
    let before = e.snapshot().unwrap();
    let failed = json!({"commands":[{"op":"updateNode","payload":{"id":frame,"name":"Transient"}},{"op":"reparentNode","payload":{"id":frame,"parent":frame,"index":0}}]});
    assert!(e
        .apply(Command::new(ignition_core::OP_BATCH, failed))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "removeNode", json!({"id":frame}));
    assert_eq!(e.state.nodes.len(), 1);
    e.undo().unwrap();
    assert_eq!(e.snapshot().unwrap(), before);
    let noop = json!({"commands":[{"op":"updateNode","payload":{"id":frame,"name":"Transient"}},{"op":"updateNode","payload":{"id":frame,"name":"Frame"}}]});
    assert!(call(&mut e, ignition_core::OP_BATCH, noop)
        .events
        .is_empty());
    assert!(e.redo().unwrap());
    assert_eq!(e.state.nodes.len(), 1);
    for i in 0..20 {
        call(
            &mut e,
            "setComposition",
            json!({"title":format!("Title {i}")}),
        );
    }
    let mut count = 0;
    while e.undo().unwrap() {
        count += 1;
    }
    assert_eq!(count, 16);
}
#[test]
fn bounds_unsupported_fields_effective_padding_and_cancel_are_rejected() {
    let mut e = DesignEngine::new();
    let before = e.snapshot().unwrap();
    for p in [
        json!({"width":4096,"height":4096}),
        json!({"width":0}),
        json!({"height":1.5}),
        json!({"wrap":true}),
        json!({"title":false}),
    ] {
        assert!(e.apply(Command::new("setComposition", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"width":100,"height":100}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":flow("row","start","start",0.)}),
    );
    call(&mut e, "setComposition", json!({"width":3,"height":3}));
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "setFrameLayout",
            json!({"id":1,"layout":flow("row","stretch","start",0.)})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let ctx = TaskContext::new();
    ctx.cancel();
    assert!(e
        .apply_long(Command::new("renderFrame", json!({})), &ctx)
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn accumulated_coordinates_and_hidden_overflow_reject_atomically() {
    let mut e = DesignEngine::new();
    let mut parent = 1;
    for _ in 0..10 {
        parent = call(&mut e, "addFrame", json!({"parent":parent,"x":1e6})).data["node_id"]
            .as_u64()
            .unwrap();
    }
    call(&mut e, "setComposition", json!({"title":"Redo target"}));
    let changed = e.snapshot().unwrap();
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    for visible in [true, false] {
        assert!(e
            .apply(Command::new(
                "addFrame",
                json!({"parent":parent,"x":1,"visible":visible})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), changed);
    e.undo().unwrap();
    let mut invalid = (*e.state).clone();
    let new_id = invalid.next_id;
    invalid.next_id += 1;
    let mut node = Node::frame(new_id, 1., 1.);
    node.x = 1.;
    node.visible = false;
    invalid.nodes.insert(new_id, Arc::new(node));
    Arc::make_mut(invalid.nodes.get_mut(&parent).unwrap())
        .children
        .push(new_id);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
}
#[test]
fn lock_is_authored_edit_permission_not_a_frozen_layout_or_order() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let a = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    let b = shape(&mut e, 1, 0., 0., 1., 1., [0; 4]);
    call(&mut e, "updateNode", json!({"id":a,"locked":true}));
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":1,"layout":flow("row","start","end",0.)}),
    );
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].x, 7.);
    call(&mut e, "setChildOrder", json!({"parent":1,"order":[b,a]}));
    assert_eq!(layout::evaluate(&e.state).unwrap()[2].id, a);
    assert!(e.state.nodes[&a].locked);
}

#[test]
fn wrapping_breaks_rows_and_columns_at_exact_padded_boundaries() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8}));
    shape(&mut e, 1, 0., 0., 3., 2., [255; 4]);
    shape(&mut e, 1, 0., 0., 3., 1., [255; 4]);
    shape(&mut e, 1, 0., 0., 2., 3., [255; 4]);
    let mut layout = flow("row", "end", "start", 0.);
    layout["wrap"] = json!(true);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":layout}));
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (1., 1.));
    assert_eq!((boxes[2].x, boxes[2].y), (4., 2.));
    assert_eq!((boxes[3].x, boxes[3].y), (1., 3.));
    let mut stretch = flow("row", "stretch", "start", 0.);
    stretch["wrap"] = json!(true);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":stretch}));
    let stretched = layout::evaluate(&e.state).unwrap();
    assert_eq!(stretched[2].height, 2.);
    assert_eq!(e.state.nodes[&3].height, 1.);
    let mut layout = flow("column", "center", "space-between", 1.);
    layout["wrap"] = json!(true);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":layout}));
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (1., 1.));
    assert_eq!((boxes[2].x, boxes[2].y), (1., 6.));
    assert_eq!((boxes[3].x, boxes[3].y), (5., 1.));
}
#[test]
fn wrap_pixels_oversized_single_items_hidden_space_and_legacy_default_are_real() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":2,"height":2}));
    shape(&mut e, 1, 0., 0., 2., 1., [255, 0, 0, 255]);
    shape(&mut e, 1, 0., 0., 2., 1., [0, 255, 0, 255]);
    let settings = json!({"direction":"row","wrap":true,"gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"stretch","justify":"center"});
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":settings}));
    let before = e.snapshot().unwrap();
    let rgba = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(
        rgba,
        vec![255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]
    );
    let mut no_wrap = settings.clone();
    no_wrap["wrap"] = json!(false);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":no_wrap}));
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(
        call(&mut e, "setFrameLayout", json!({"id":1,"layout":settings}))
            .events
            .is_empty()
    );
    assert!(e.redo().unwrap());
    assert!(e.undo().unwrap());
    let mut restored = DesignEngine::new();
    restored.restore(&before).unwrap();
    assert_eq!(restored.snapshot().unwrap(), before);
    let mut legacy = serde_json::to_value(&*e.state).unwrap();
    legacy["nodes"]["1"]["layout"]
        .as_object_mut()
        .unwrap()
        .remove("wrap");
    restored
        .restore(&encode_envelope(&serde_json::to_vec(&legacy).unwrap()))
        .unwrap();
    assert!(!restored.state.nodes[&1].layout.as_ref().unwrap().wrap);
    assert!(
        serde_json::to_value(&*restored.state).unwrap()["nodes"]["1"]["layout"]
            .get("wrap")
            .is_none()
    );
    assert_eq!(layout::evaluate(&restored.state).unwrap()[2].x, 2.);
    call(
        &mut e,
        "updateNode",
        json!({"id":2,"visible":false,"width":3}),
    );
    let boxes = layout::evaluate(&e.state).unwrap();
    assert!(!boxes[1].visible);
    assert_eq!((boxes[1].x, boxes[2].x, boxes[2].y), (0., 0., 1.));
}
#[test]
fn wrap_invalid_type_and_nested_effective_padding_preserve_history() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let frame = call(&mut e, "addFrame", json!({"parent":1,"width":3,"height":3})).data["node_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":flow("row","start","start",0.)}),
    );
    call(&mut e, "setComposition", json!({"title":"Redo"}));
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    let mut invalid = flow("row", "stretch", "start", 0.);
    invalid["wrap"] = json!("yes");
    assert!(e
        .apply(Command::new(
            "setFrameLayout",
            json!({"id":1,"layout":invalid})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut state = serde_json::to_value(&*e.state).unwrap();
    state["nodes"]["1"]["layout"] = json!({"direction":"row","wrap":null,"gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
    // Wrapped stretch uses each line's intrinsic cross size, not the parent's entire cross size.
    let mut layout = flow("column", "stretch", "start", 0.);
    layout["wrap"] = json!(true);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":layout}));
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, 3.);
}
