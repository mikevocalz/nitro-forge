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

fn size(e: &mut DesignEngine, id: u64, axis: &str, mode: &str) {
    call(e, "setAxisSizing", json!({"id":id,"axis":axis,"mode":mode}));
}
#[test]
fn hug_uses_real_flow_extents_padding_and_pixels_not_fixed_fallback() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":4,"height":1}));
    let frame = call(&mut e, "addFrame", json!({"parent":1,"fill":[0,0,255,255]})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 0., 0., 1., 1., [255, 0, 0, 255]);
    shape(&mut e, frame, 0., 0., 1., 1., [0, 255, 0, 255]);
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":{"direction":"row","gap":1,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"}}),
    );
    size(&mut e, frame, "x", "hug");
    size(&mut e, frame, "y", "hug");
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].width, boxes[1].height), (3., 1.));
    assert_eq!(e.state.nodes[&frame].width, 100.);
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(
        pixels,
        vec![255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 0, 0, 0]
    );
    let read = call(&mut e, "readAxisSizing", json!({"id":frame}));
    assert!(read.events.is_empty());
    assert_eq!(read.data["x"]["mode"], "hug");
    assert_eq!(read.data["x"]["value"], 3.);
    assert_eq!(read.data["x"]["fixedValue"], 100.);
    assert_eq!(read.data["x"]["resolvedValue"], 3.);
    // Padding may exceed inactive fixed fallback; the actual hugged box must validate instead.
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":{"direction":"row","gap":1,"padding_top":0,"padding_right":100,"padding_bottom":0,"padding_left":100,"align":"start","justify":"start"}}),
    );
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, 203.);
}
#[test]
fn fill_distributes_real_remaining_space_and_tracks_stretched_ancestors() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":8}));
    let a = shape(&mut e, 1, 0., 0., 2., 1., [255; 4]);
    let b = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    let c = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":1,"layout":flow("row","start","start",1.)}),
    );
    size(&mut e, b, "x", "fill");
    size(&mut e, c, "x", "fill");
    size(&mut e, b, "y", "fill");
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].id, boxes[1].x, boxes[1].width), (a, 1., 2.));
    assert_eq!((boxes[2].x, boxes[2].width, boxes[2].height), (4., 2., 6.));
    assert_eq!((boxes[3].x, boxes[3].width), (7., 2.));
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("updateNode", json!({"id":a,"width":8})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":6}));
    let frame = call(&mut e, "addFrame", json!({"parent":1,"width":3,"height":2})).data["node_id"]
        .as_u64()
        .unwrap();
    let child = shape(&mut e, frame, 0., 0., 1., 1., [255; 4]);
    let layout = json!({"direction":"column","gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"});
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":layout}),
    );
    size(&mut e, child, "x", "fill");
    size(&mut e, child, "y", "fill");
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":1,"layout":{"direction":"row","gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"stretch","justify":"start"}}),
    );
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!(
        (boxes[1].height, boxes[2].width, boxes[2].height),
        (6., 3., 6.)
    );
}
#[test]
fn sizing_cycles_unsupported_wrap_modes_and_shape_hug_report_real_capabilities() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    let child = shape(&mut e, frame, 0., 0., 1., 1., [255; 4]);
    size(&mut e, child, "x", "fill");
    call(&mut e, "updateNode", json!({"id":frame,"name":"Redo"}));
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    let caps = call(&mut e, "readAxisSizing", json!({"id":frame}));
    assert_eq!(caps.data["x"]["canHug"], false);
    assert!(caps.data["x"]["hugReason"]
        .as_str()
        .unwrap()
        .contains("cyclic"));
    assert!(e
        .apply(Command::new(
            "setAxisSizing",
            json!({"id":frame,"axis":"x","mode":"hug"})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    let mut cycle = serde_json::to_value(&*e.state).unwrap();
    cycle["nodes"][frame.to_string()]["sizing"] = json!({"x":"hug","y":"fixed"});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&cycle).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
    size(&mut e, child, "x", "fixed");
    let mut wrap = flow("row", "start", "start", 0.);
    wrap["wrap"] = json!(true);
    call(&mut e, "setFrameLayout", json!({"id":frame,"layout":wrap}));
    let caps = call(&mut e, "readAxisSizing", json!({"id":frame}));
    assert_eq!(caps.data["x"]["canHug"], false);
    let caps = call(&mut e, "readAxisSizing", json!({"id":child}));
    assert_eq!(caps.data["x"]["canFill"], false);
    assert_eq!(caps.data["y"]["canFill"], false);
    assert_eq!(caps.data["x"]["canHug"], false);
    let before = e.snapshot().unwrap();
    for p in [
        json!({"id":child,"axis":"x","mode":"fill"}),
        json!({"id":frame,"axis":"x","mode":"hug"}),
        json!({"id":child,"axis":"x","mode":"hug"}),
        json!({"id":child,"axis":"x","mode":"fixed","unexpected":true}),
    ] {
        assert!(e.apply(Command::new("setAxisSizing", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
}
#[test]
fn wrapped_cross_hug_uses_line_measurement_and_empty_hug_is_editable() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1,"width":6})).data["node_id"]
        .as_u64()
        .unwrap();
    let a = shape(&mut e, frame, 0., 0., 3., 2., [255; 4]);
    let b = shape(&mut e, frame, 0., 0., 3., 3., [255; 4]);
    let mut settings = flow("row", "stretch", "start", 1.);
    settings["wrap"] = json!(true);
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":settings}),
    );
    size(&mut e, frame, "y", "hug");
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].height, 8.);
    call(&mut e, "removeNode", json!({"id":b}));
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].height, 4.);
    call(&mut e, "removeNode", json!({"id":a}));
    assert!((layout::evaluate(&e.state).unwrap()[1].height - 2.001).abs() < 1e-12);
    // Absolute hug anchors its origin; negative leading content stays visible overflow.
    call(&mut e, "setFrameLayout", json!({"id":frame,"layout":null}));
    size(&mut e, frame, "x", "hug");
    let child = shape(&mut e, frame, -5., -5., 1., 1., [255; 4]);
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, 0.001);
    call(
        &mut e,
        "reparentNode",
        json!({"id":child,"parent":1,"index":0}),
    );
    assert_eq!(layout::evaluate(&e.state).unwrap()[2].width, 0.001);
}
#[test]
fn sizing_snapshot_legacy_defaults_corruption_noops_and_boundaries_are_atomic() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 1., 0., 2., 1., [255; 4]);
    let fixed = e.snapshot().unwrap();
    assert!(
        serde_json::to_value(&*e.state).unwrap()["nodes"][frame.to_string()]
            .get("sizing")
            .is_none()
    );
    size(&mut e, frame, "x", "hug");
    let hugged = e.snapshot().unwrap();
    let mut restored = DesignEngine::new();
    restored.restore(&hugged).unwrap();
    assert_eq!(restored.snapshot().unwrap(), hugged);
    restored.restore(&fixed).unwrap();
    assert_eq!(restored.snapshot().unwrap(), fixed);
    assert_eq!(restored.state.nodes[&frame].sizing, Sizing::default());
    assert!(e.undo().unwrap());
    assert!(call(
        &mut e,
        "setAxisSizing",
        json!({"id":frame,"axis":"x","mode":"fixed"})
    )
    .events
    .is_empty());
    assert!(e.redo().unwrap());
    assert_eq!(e.snapshot().unwrap(), hugged);
    for p in [
        json!({"id":frame,"axis":"x","mode":null}),
        json!({"id":frame,"axis":"z","mode":"fixed"}),
        json!({"id":frame,"axis":"x","mode":"fixed","value":0}),
        json!({"id":frame,"axis":"x","mode":"fixed","value":"10"}),
    ] {
        assert!(e.apply(Command::new("setAxisSizing", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), hugged);
    }
    let mut state = serde_json::to_value(&*e.state).unwrap();
    state["nodes"]["1"]["sizing"] = json!({"x":"hug","y":"fixed"});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), hugged);
    call(&mut e, "updateNode", json!({"id":frame,"locked":true}));
    let locked = e.snapshot().unwrap();
    let caps = call(&mut e, "readAxisSizing", json!({"id":frame}));
    assert_eq!(caps.data["x"]["canHug"], false);
    assert!(caps.data["x"]["unavailableReason"].is_string());
    assert_eq!(e.snapshot().unwrap(), locked);
    assert!(e
        .apply(Command::new(
            "setAxisSizing",
            json!({"id":frame,"axis":"x","mode":"fixed"})
        ))
        .is_err());
}

#[test]
fn switching_hug_and_fill_to_fixed_freezes_geometry_and_pixels_including_large_values() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":4,"height":1}));
    let frame = call(&mut e, "addFrame", json!({"parent":1,"fill":[0,0,255,255]})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 0., 0., 2., 1., [255, 0, 0, 255]);
    size(&mut e, frame, "x", "hug");
    size(&mut e, frame, "y", "hug");
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    size(&mut e, frame, "x", "fixed");
    assert_eq!(e.state.nodes[&frame].width, 2.);
    assert_eq!(
        e.apply(Command::new("renderFrame", json!({})).with_binary(None))
            .unwrap()
            .output
            .unwrap(),
        pixels
    );
    assert!(e.undo().unwrap());
    assert_eq!(e.state.nodes[&frame].sizing.x, SizeMode::Hug);
    assert_eq!(e.state.nodes[&frame].width, 100.);
    size(&mut e, frame, "x", "fill");
    let before = layout::evaluate(&e.state).unwrap()[1].width;
    let fill_pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    size(&mut e, frame, "x", "fixed");
    assert_eq!(
        e.apply(Command::new("renderFrame", json!({})).with_binary(None))
            .unwrap()
            .output
            .unwrap(),
        fill_pixels
    );
    assert_eq!(e.state.nodes[&frame].width, before);
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, before);
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 1e6, 0., 500000., 1., [255; 4]);
    size(&mut e, frame, "x", "hug");
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, 1_500_000.);
    size(&mut e, frame, "x", "fixed");
    assert_eq!(e.state.nodes[&frame].width, 1_500_000.);
    assert_eq!(layout::evaluate(&e.state).unwrap()[1].width, 1_500_000.);
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "setAxisSizing",
            json!({"id":frame,"axis":"x","mode":"fixed","value":1e7+1.})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn intrinsic_renderer_extent_limit_rejects_before_mutation_or_history() {
    let mut e = DesignEngine::new();
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, frame, 1e6, 0., 1e7, 1., [255; 4]);
    call(&mut e, "updateNode", json!({"id":frame,"name":"Redo"}));
    e.undo().unwrap();
    let before = e.snapshot().unwrap();
    let caps = call(&mut e, "readAxisSizing", json!({"id":frame}));
    assert_eq!(caps.data["x"]["canHug"], false);
    assert!(caps.data["x"]["hugReason"]
        .as_str()
        .unwrap()
        .contains("renderer bounds"));
    assert!(e
        .apply(Command::new(
            "setAxisSizing",
            json!({"id":frame,"axis":"x","mode":"hug"})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    assert!(e.redo().unwrap());
}

fn add_text(e: &mut DesignEngine, parent: u64, content: &str) -> u64 {
    call(
        e,
        "addText",
        json!({"parent":parent,"content":content}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap()
}
#[test]
fn text_nodes_layout_hug_render_update_and_undo() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":40,"height":30}));
    let t = add_text(&mut e, 1, "Hi");
    let node = &e.state.nodes[&t];
    assert_eq!(node.kind, Kind::Text);
    assert_eq!(node.text.as_ref().unwrap().content, "Hi");
    assert_eq!(node.text.as_ref().unwrap().font_size, 16.);
    // describe exposes the text style; evaluateLayout marks it non-renderable.
    let described = call(&mut e, "describe", json!({}));
    assert_eq!(described.data["nodes"][t.to_string()]["kind"], "text");
    assert_eq!(
        described.data["nodes"][t.to_string()]["text"]["content"],
        "Hi"
    );
    let boxes = layout::evaluate(&e.state).unwrap();
    let b = boxes.iter().find(|b| b.id == t).unwrap();
    assert_eq!(b.kind, Kind::Text);
    assert!(!b.renderable);
    // Hug uses the deterministic stub metrics: longest line 2 chars * 16 * 0.6.
    size(&mut e, t, "x", "hug");
    size(&mut e, t, "y", "hug");
    let caps = call(&mut e, "readAxisSizing", json!({"id":t}));
    assert_eq!(caps.data["x"]["resolvedValue"], 19.2);
    assert_eq!(caps.data["y"]["resolvedValue"], 19.2);
    assert_eq!(caps.data["x"]["canHug"], true);
    // Fill background still rasterizes; no glyphs exist to draw.
    call(&mut e, "updateNode", json!({"id":t,"fill":[9,8,7,255]}));
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    assert_eq!(pixels[0..4], [9, 8, 7, 255]);
    // Partial text patch merges over the current style.
    call(
        &mut e,
        "updateNode",
        json!({"id":t,"text":{"content":"Hello","font_size":20,"font_style":"italic"}}),
    );
    let style = &e.state.nodes[&t].text.as_ref().unwrap();
    assert_eq!(style.content, "Hello");
    assert_eq!(style.font_size, 20.);
    assert_eq!(style.font_weight, 400);
    assert_eq!(style.font_style, TextFontStyle::Italic);
    // Undo/redo across the whole text lifecycle.
    assert!(e.undo().unwrap());
    assert_eq!(e.state.nodes[&t].text.as_ref().unwrap().content, "Hi");
    assert!(e.redo().unwrap());
    assert_eq!(e.state.nodes[&t].text.as_ref().unwrap().content, "Hello");
    // Generic structural ops already cover text nodes.
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "reparentNode",
        json!({"id":t,"parent":frame,"index":0}),
    );
    assert_eq!(e.state.parent(t), Some(frame));
    call(&mut e, "removeNode", json!({"id":t}));
    assert!(!e.state.nodes.contains_key(&t));
}
#[test]
fn text_validation_caps_and_atomic_rejection() {
    let mut e = DesignEngine::new();
    let t = add_text(&mut e, 1, "ok");
    let before = e.snapshot().unwrap();
    for p in [
        // Missing content, oversize content, control characters.
        json!({"parent":1}),
        json!({"parent":1,"content":"x".repeat(MAX_TEXT_BYTES + 1)}),
        json!({"parent":1,"content":"a\u{7}b"}),
        json!({"parent":1,"content":"ok","style":{"font_size":0}}),
        json!({"parent":1,"content":"ok","style":{"font_weight":0}}),
        json!({"parent":1,"content":"ok","style":{"font_weight":1001}}),
        json!({"parent":1,"content":"ok","style":{"font_family":""}}),
        json!({"parent":1,"content":"ok","style":{"font_family":"f".repeat(MAX_FONT_FAMILY_BYTES + 1)}}),
        json!({"parent":1,"content":"ok","style":{"font_style":"bold"}}),
        json!({"parent":1,"content":"ok","style":{"unexpected":1}}),
        json!({"parent":1,"content":"ok","kind":"rect"}),
    ] {
        assert!(e.apply(Command::new("addText", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Boundary content is admitted.
    let max = "x".repeat(MAX_TEXT_BYTES);
    let big = add_text(&mut e, 1, &max);
    assert_eq!(e.state.nodes[&big].text.as_ref().unwrap().content.len(), MAX_TEXT_BYTES);
    // updateNode text patches validate the same bounds.
    for patch in [
        json!({"content":"a\u{0}b"}),
        json!({"font_size":-1}),
        json!({"font_weight":70000}),
        json!({"nope":1}),
    ] {
        assert!(e
            .apply(Command::new(
                "updateNode",
                json!({"id":t,"text":patch})
            ))
            .is_err());
        assert_eq!(e.state.nodes[&t].text.as_ref().unwrap().content, "ok");
    }
    // text patch on a non-text node and null on a text node both reject.
    let rect = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    assert!(e
        .apply(Command::new(
            "updateNode",
            json!({"id":rect,"text":{"content":"no"}})
        ))
        .is_err());
    assert!(e
        .apply(Command::new("updateNode", json!({"id":t,"text":null})))
        .is_err());
    // Batch admission covers addText atomically.
    let batch = json!({"commands":[
        {"op":"addText","payload":{"content":"batched"}},
        {"op":"updateNode","payload":{"id":t,"text":{"content":"changed"}}}
    ]});
    call(&mut e, ignition_core::OP_BATCH, batch);
    assert_eq!(e.state.nodes[&t].text.as_ref().unwrap().content, "changed");
    assert!(e.state.nodes.values().any(|n| n.kind == Kind::Text
        && n.text.as_ref().is_some_and(|s| s.content == "batched")));
}
#[test]
fn text_snapshot_wrapper_presence_trigger_and_reader_gates() {
    let mut e = DesignEngine::new();
    // Schema:1-only document stays byte-identical bare state.
    let legacy = e.snapshot().unwrap();
    let payload: Value =
        serde_json::from_slice(&decode_envelope(&legacy).unwrap().1).unwrap();
    assert_eq!(payload["schema"], 1);
    assert!(payload.get("document").is_none());
    let t = add_text(&mut e, 1, "wrapped");
    let wrapped = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["kind"], "design");
    assert_eq!(outer["schema"], 2);
    assert_eq!(outer["document"]["schema"], 1);
    assert_eq!(outer["document"]["nodes"][t.to_string()]["kind"], "text");
    // Round-trip through a fresh engine preserves bytes exactly.
    let mut reopen = DesignEngine::new();
    reopen.restore(&wrapped).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), wrapped);
    // Unwrapped extended state is rejected: old readers must fail closed.
    let bare = serde_json::to_vec(&*e.state).unwrap();
    assert!(reopen
        .restore(&encode_envelope(&bare))
        .is_err());
    // Wrapper kind/schema/extra-field/missing-document mutations all reject.
    for mutation in ["kind", "schema", "extra", "bare_document"] {
        let mut outer = outer.clone();
        match mutation {
            "kind" => outer["kind"] = json!("photo"),
            "schema" => outer["schema"] = json!(3),
            "extra" => outer["surprise"] = json!(true),
            _ => {
                outer.as_object_mut().unwrap().remove("document");
                outer["title"] = json!("x");
            }
        }
        assert!(reopen
            .restore(&encode_envelope(&serde_json::to_vec(&outer).unwrap()))
            .is_err());
        assert_eq!(reopen.snapshot().unwrap(), wrapped);
    }
    // Removing the last text node returns snapshots to the bare schema:1
    // form (next_id legitimately advanced, so compare shape not bytes).
    call(&mut e, "removeNode", json!({"id":t}));
    let snap = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&snap).unwrap();
    let bare: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(bare["schema"], 1);
    assert!(bare.get("document").is_none());
    assert!(!bare["nodes"].as_object().unwrap().values().any(|n| {
        n["kind"] == "text" || n.get("text").is_some()
    }));
}
