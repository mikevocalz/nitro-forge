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
#[test]
fn locked_text_node_rejects_combined_lock_and_text_patch_atomically() {
    let mut e = DesignEngine::new();
    let t = add_text(&mut e, 1, "Hi");
    // Unlocked nodes may combine lock and text fields in one patch.
    call(
        &mut e,
        "updateNode",
        json!({"id":t,"locked":true,"text":{"content":"Combined"}}),
    );
    assert!(e.state.nodes[&t].locked);
    assert_eq!(e.state.nodes[&t].text.as_ref().unwrap().content, "Combined");
    let locked = e.snapshot().unwrap();
    // On a locked node a text patch is not a lock-only unlock, whether the
    // lock field is true or false; state and history stay intact.
    for p in [
        json!({"id":t,"locked":true,"text":{"content":"No"}}),
        json!({"id":t,"locked":false,"text":{"content":"No"}}),
        json!({"id":t,"locked":false,"text":null}),
        json!({"id":t,"text":{"content":"No"},"name":"Also no"}),
    ] {
        assert!(e.apply(Command::new("updateNode", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), locked);
    }
    // The lock-only unlock is still admitted on its own, then text edits work.
    call(&mut e, "updateNode", json!({"id":t,"locked":false}));
    assert!(!e.state.nodes[&t].locked);
    call(
        &mut e,
        "updateNode",
        json!({"id":t,"text":{"content":"After unlock"}}),
    );
    assert_eq!(
        e.state.nodes[&t].text.as_ref().unwrap().content,
        "After unlock"
    );
}

fn mode(e: &mut DesignEngine, id: &str, name: &str) {
    call(e, "defineMode", json!({"id":id,"name":name}));
}
fn var(e: &mut DesignEngine, id: &str, name: &str, ty: &str) {
    call(e, "defineVariable", json!({"id":id,"name":name,"type":ty}));
}
fn val(kind: &str, value: Value) -> Value {
    json!({"kind":kind,"value":value})
}
fn alias(target: &str) -> Value {
    json!({"kind":"alias","variable_id":target})
}
#[test]
fn variables_modes_aliases_and_describe_resolve_per_mode() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    mode(&mut e, "light", "Light");
    mode(&mut e, "dark", "Dark");
    var(&mut e, "gap", "Gap", "number");
    var(&mut e, "gap-alias", "Gap alias", "number");
    var(&mut e, "label", "Label", "string");
    call(&mut e, "setVariableValue", json!({"id":"gap","mode":"light","value":val("number",json!(4))}));
    call(&mut e, "setVariableValue", json!({"id":"gap","mode":"dark","value":val("number",json!(8))}));
    call(&mut e, "setVariableValue", json!({"id":"gap-alias","mode":"light","value":alias("gap")}));
    call(&mut e, "setVariableValue", json!({"id":"label","mode":"light","value":val("string",json!("hi"))}));
    // Alias chains resolve through describeVariables.
    let before = e.snapshot().unwrap();
    let d = call(&mut e, "describeVariables", json!({}));
    assert!(d.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    let vars = d.data["variables"].as_array().unwrap();
    let gap_alias = vars.iter().find(|v| v["id"] == "gap-alias").unwrap();
    assert_eq!(gap_alias["resolved"]["light"]["value"], 4.);
    // Sparse coverage: gap-alias has no dark value, so dark is unresolved.
    assert!(gap_alias["resolved"].get("dark").is_none());
    let label = vars.iter().find(|v| v["id"] == "label").unwrap();
    assert_eq!(label["resolved"]["light"]["value"], "hi");
    // Mode switch changes resolved output and surfaces coverage diagnostics.
    call(&mut e, "setActiveMode", json!({"id":"dark"}));
    let d = call(&mut e, "describeVariables", json!({}));
    let gap_alias = d.data["variables"].as_array().unwrap().iter().find(|v| v["id"] == "gap-alias").unwrap();
    assert!(gap_alias["problems"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p.as_str().unwrap().contains("no value in active mode")));
    // Undo across the mode switch restores the prior mode, then none.
    assert!(e.undo().unwrap());
    assert_eq!(e.state.active_mode, None);
    // Auto-generated ids and rename/remove lifecycle.
    call(&mut e, "defineMode", json!({"name":"Auto"}));
    assert!(e.state.modes.iter().any(|m| m.id == "mode-1"));
    call(&mut e, "renameMode", json!({"id":"mode-1","name":"Automatic"}));
    assert_eq!(e.state.modes.iter().find(|m| m.id == "mode-1").unwrap().name, "Automatic");
    call(&mut e, "removeMode", json!({"id":"dark"}));
    assert!(!e.state.variables["gap"].values.contains_key("dark"));
    assert!(e.state.modes.iter().all(|m| m.id != "dark"));
}
#[test]
fn alias_cycles_type_mismatch_coverage_and_bounds_reject_atomically() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4}));
    mode(&mut e, "m1", "M1");
    mode(&mut e, "m2", "M2");
    var(&mut e, "a", "A", "number");
    var(&mut e, "b", "B", "number");
    var(&mut e, "s", "S", "string");
    var(&mut e, "cov", "Cov", "number");
    call(&mut e, "setVariableValue", json!({"id":"b","mode":"m1","value":val("number",json!(2))}));
    call(&mut e, "setVariableValue", json!({"id":"b","mode":"m2","value":val("number",json!(3))}));
    call(&mut e, "setVariableValue", json!({"id":"s","mode":"m1","value":val("string",json!("x"))}));
    call(&mut e, "setVariableValue", json!({"id":"cov","mode":"m1","value":val("number",json!(1))}));
    let before = e.snapshot().unwrap();
    for p in [
        // Unknown target, type mismatch, missing mode coverage, self cycle.
        json!({"id":"a","mode":"m1","value":alias("ghost")}),
        json!({"id":"a","mode":"m1","value":alias("s")}),
        json!({"id":"a","mode":"m2","value":alias("cov")}),
        json!({"id":"a","mode":"m1","value":alias("a")}),
        json!({"id":"a","mode":"m1","value":val("number",json!(1e9+1.))}),
        json!({"id":"a","mode":"m1","value":val("string",json!("x"))}),
        json!({"id":"a","mode":"nope","value":val("number",json!(1))}),
        json!({"id":"ghost","mode":"m1","value":val("number",json!(1))}),
    ] {
        assert!(e.apply(Command::new("setVariableValue", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Two-hop alias is admitted; closing the cycle back is rejected.
    call(&mut e, "setVariableValue", json!({"id":"a","mode":"m1","value":alias("b")}));
    call(&mut e, "setVariableValue", json!({"id":"a","mode":"m2","value":val("number",json!(9))}));
    call(&mut e, "setVariableValue", json!({"id":"b","mode":"m2","value":alias("a")}));
    // b(m2) -> a(m2) literal 9 resolves; a(m1) -> b(m1) literal 2 resolves.
    let d = call(&mut e, "describeVariables", json!({}));
    let a = d.data["variables"].as_array().unwrap().iter().find(|v| v["id"] == "a").unwrap();
    assert_eq!(a["resolved"]["m1"]["value"], 2.);
    assert_eq!(a["resolved"]["m2"]["value"], 9.);
    let b = d.data["variables"].as_array().unwrap().iter().find(|v| v["id"] == "b").unwrap();
    assert_eq!(b["resolved"]["m2"]["value"], 9.);
    // Closing the loop back into a cycle rejects atomically: a(m2) -> b(m2)
    // -> a(m2).
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("setVariableValue", json!({"id":"a","mode":"m2","value":alias("b")})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // A two-variable cycle introduced through defineVariable values also
    // rejects atomically on the second definition.
    call(&mut e, "defineVariable", json!({"id":"d","name":"D","type":"number","values":{"m1":{"kind":"number","value":5}}}));
    call(&mut e, "defineVariable", json!({"id":"c","name":"C","type":"number","values":{"m1":{"kind":"alias","variable_id":"d"}}}));
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "setVariableValue",
            json!({"id":"d","mode":"m1","value":{"kind":"alias","variable_id":"c"}})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Literal kind mismatch inside defineVariable values rejects atomically.
    assert!(e
        .apply(Command::new(
            "defineVariable",
            json!({"id":"e","name":"E","type":"number","values":{"m1":{"kind":"string","value":"no"}}})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn bindings_drive_layout_render_sizing_and_undo_across_mode_switch() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":12,"height":4}));
    mode(&mut e, "compact", "Compact");
    mode(&mut e, "roomy", "Roomy");
    var(&mut e, "gapv", "Gap", "number");
    var(&mut e, "fillv", "Width", "number");
    call(&mut e, "setVariableValue", json!({"id":"gapv","mode":"compact","value":val("number",json!(1))}));
    call(&mut e, "setVariableValue", json!({"id":"gapv","mode":"roomy","value":val("number",json!(3))}));
    call(&mut e, "setVariableValue", json!({"id":"fillv","mode":"compact","value":val("number",json!(2))}));
    call(&mut e, "setVariableValue", json!({"id":"fillv","mode":"roomy","value":val("number",json!(5))}));
    call(&mut e, "setActiveMode", json!({"id":"compact"}));
    let a = shape(&mut e, 1, 0., 0., 1., 1., [255, 0, 0, 255]);
    let b = shape(&mut e, 1, 0., 0., 1., 1., [0, 255, 0, 255]);
    call(&mut e, "setFrameLayout", json!({"id":1,"layout":{"direction":"row","gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"}}));
    // Bind root gap and child b's fixed width.
    call(&mut e, "bindVariable", json!({"node_id":1,"path":"gap","variable_id":"gapv"}));
    call(&mut e, "bindVariable", json!({"node_id":b,"path":"width","variable_id":"fillv"}));
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    assert_eq!((boxes[1].x, boxes[2].x, boxes[2].width), (0., 2., 2.));
    // Fill sibling sees the bound width: b is fixed+bound, a stays put.
    // Switch mode: gap and width both change evaluateLayout output.
    call(&mut e, "setActiveMode", json!({"id":"roomy"}));
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    assert_eq!((boxes[1].x, boxes[2].x, boxes[2].width), (0., 4., 5.));
    // renderFrame pixels move with the binding.
    let pixels = |e: &mut DesignEngine| {
        e.apply(Command::new("renderFrame", json!({})).with_binary(None))
            .unwrap()
            .output
            .unwrap()
    };
    let roomy = pixels(&mut e);
    call(&mut e, "setActiveMode", json!({"id":"compact"}));
    let compact = pixels(&mut e);
    assert_ne!(roomy, compact);
    // Undo across the mode switch restores compact geometry.
    assert!(e.undo().unwrap());
    assert_eq!(e.state.active_mode.as_deref(), Some("roomy"));
    assert!(e.undo().unwrap());
    assert_eq!(e.state.active_mode.as_deref(), Some("compact"));
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    assert_eq!(boxes[2].x, 2.);
    // A fill-sized sibling resolves against the bound fixed width: compact
    // gap1 + b(2) leaves a=(12-2-1)/1=9 of the 12px canvas.
    size(&mut e, a, "x", "fill");
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    assert_eq!((boxes[1].width, boxes[2].width), (9., 2.));
    // Rebind check: listBindings reports resolved values per mode.
    let list = call(&mut e, "listBindings", json!({"node_id":b}));
    assert_eq!(list.data["bindings"].as_array().unwrap().len(), 1);
    assert_eq!(list.data["bindings"][0]["resolved"], 2.);
    assert!(list.events.is_empty());
}
#[test]
fn binding_validation_lifecycle_cleanup_and_caps() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8}));
    mode(&mut e, "m", "M");
    var(&mut e, "n", "N", "number");
    var(&mut e, "t", "T", "string");
    call(&mut e, "setVariableValue", json!({"id":"n","mode":"m","value":val("number",json!(7))}));
    call(&mut e, "setActiveMode", json!({"id":"m"}));
    let rect = shape(&mut e, 1, 0., 0., 1., 1., [255; 4]);
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"].as_u64().unwrap();
    let before = e.snapshot().unwrap();
    for p in [
        json!({"node_id":999,"path":"fill_r","variable_id":"n"}),
        json!({"node_id":rect,"path":"color","variable_id":"n"}),
        json!({"node_id":rect,"path":"fill_r","variable_id":"ghost"}),
        json!({"node_id":rect,"path":"fill_r","variable_id":"t"}),
        json!({"node_id":1,"path":"x","variable_id":"n"}),
        json!({"node_id":rect,"path":"gap","variable_id":"n"}),
        json!({"node_id":frame,"path":"width","variable_id":"n","extra":1}),
    ] {
        // frame width is fixed so the last-but-one is valid; drop the extra-field case into its own check.
        assert!(e.apply(Command::new("bindVariable", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // width binding requires fixed sizing on that axis.
    size(&mut e, frame, "x", "hug");
    assert!(e
        .apply(Command::new("bindVariable", json!({"node_id":frame,"path":"width","variable_id":"n"})))
        .is_err());
    size(&mut e, frame, "x", "fixed");
    // x/y binding rejected inside flow layout.
    call(&mut e, "setFrameLayout", json!({"id":frame,"layout":{"direction":"row","gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"}}));
    let inner = shape(&mut e, frame, 0., 0., 1., 1., [0; 4]);
    assert!(e
        .apply(Command::new("bindVariable", json!({"node_id":inner,"path":"x","variable_id":"n"})))
        .is_err());
    call(&mut e, "setFrameLayout", json!({"id":frame,"layout":null}));
    // Absolute x binding moves the box.
    call(&mut e, "bindVariable", json!({"node_id":inner,"path":"x","variable_id":"n"}));
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    let b = boxes.iter().find(|b| b.id == inner).unwrap();
    assert_eq!(b.x, 7.);
    // Rebind same path replaces; unbind absent is a silent no-op.
    call(&mut e, "unbindVariable", json!({"node_id":rect,"path":"fill_a"}));
    assert!(call(&mut e, "unbindVariable", json!({"node_id":rect,"path":"fill_a"})).events.is_empty());
    call(&mut e, "bindVariable", json!({"node_id":rect,"path":"fill_r","variable_id":"n"}));
    call(&mut e, "bindVariable", json!({"node_id":rect,"path":"fill_r","variable_id":"n"}));
    assert_eq!(e.state.bindings.iter().filter(|b| b.node_id == rect && b.path == BindPath::FillR).count(), 1);
    // removeVariable drops its bindings; removeNode drops node bindings.
    call(&mut e, "removeVariable", json!({"id":"n"}));
    assert!(e.state.bindings.is_empty());
    assert!(e
        .apply(Command::new("bindVariable", json!({"node_id":rect,"path":"fill_g","variable_id":"n"})))
        .is_err());
    // Caps: variables and modes are bounded. "t" is removed first so the
    // variable loop fills the cap exactly; "m" remains so the mode loop
    // leaves exactly one slot short of MAX_MODES.
    call(&mut e, "removeVariable", json!({"id":"t"}));
    for i in 0..MAX_VARIABLES {
        call(&mut e, "defineVariable", json!({"id":format!("v{i}"),"name":"v","type":"number"}));
    }
    assert!(e
        .apply(Command::new("defineVariable", json!({"id":"overflow","name":"v","type":"number"})))
        .is_err());
    for i in 0..MAX_MODES - 1 {
        call(&mut e, "defineMode", json!({"id":format!("mode-{i}"),"name":"m"}));
    }
    assert_eq!(e.state.modes.len(), MAX_MODES);
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("defineMode", json!({"id":"mode-overflow","name":"m"})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}
#[test]
fn root_canvas_rejects_width_height_bindings_but_allows_fill() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":8,"height":8}));
    mode(&mut e, "m", "M");
    var(&mut e, "n", "N", "number");
    var(&mut e, "big", "Big", "number");
    call(&mut e, "setVariableValue", json!({"id":"n","mode":"m","value":val("number",json!(4))}));
    call(&mut e, "setVariableValue", json!({"id":"big","mode":"m","value":val("number",json!(1e9))}));
    call(&mut e, "setActiveMode", json!({"id":"m"}));
    let before = e.snapshot().unwrap();
    // Root width/height bypass setComposition's canvas budget (<=4096 per
    // axis, w*h <= 1_048_576, integer) if admitted; both paths reject.
    for path in ["width", "height"] {
        assert!(e
            .apply(Command::new(
                "bindVariable",
                json!({"node_id":1,"path":path,"variable_id":"n"})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Hostile restore with a root width binding fails validate_variables.
    let mut hostile = serde_json::to_value(&*e.state).unwrap();
    hostile["bindings"] = json!([{"node_id":1,"path":"width","variable_id":"big"}]);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Fill channels on the root stay allowed.
    call(&mut e, "bindVariable", json!({"node_id":1,"path":"fill_r","variable_id":"n"}));
    assert_eq!(e.state.bindings.len(), 1);
    let boxes = layout::evaluate(&variables::effective(&e.state)).unwrap();
    assert_eq!(boxes[0].fill[0], 4);
}
#[test]
fn variables_snapshot_wrapper_hostile_restore_and_cleanup() {
    let mut e = DesignEngine::new();
    // Bare schema:1 stays bare; variables alone trigger the schema:2 wrapper.
    let legacy = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&legacy).unwrap();
    assert_eq!(serde_json::from_slice::<Value>(&raw).unwrap()["schema"], 1);
    mode(&mut e, "m", "M");
    var(&mut e, "v", "V", "number");
    call(&mut e, "setActiveMode", json!({"id":"m"}));
    let wrapped = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["schema"], 2);
    assert_eq!(outer["document"]["variables"]["v"]["type"], "number");
    let mut reopen = DesignEngine::new();
    reopen.restore(&wrapped).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), wrapped);
    // Unwrapped state carrying variables fails closed.
    let bare = serde_json::to_vec(&*e.state).unwrap();
    assert!(reopen.restore(&encode_envelope(&bare)).is_err());
    // Hostile wrapper mutations reject without touching live state.
    for mutation in ["cycle", "bad_binding", "dangling_value_mode", "active_ghost"] {
        let mut outer = outer.clone();
        match mutation {
            "cycle" => {
                outer["document"]["variables"]["v"]["values"] = json!({"m":{"kind":"alias","variable_id":"v"}});
            }
            "bad_binding" => {
                outer["document"]["bindings"] = json!([{"node_id":1,"path":"fill_r","variable_id":"ghost"}]);
            }
            "dangling_value_mode" => {
                outer["document"]["variables"]["v"]["values"] = json!({"ghost":{"kind":"number","value":1}});
            }
            _ => outer["document"]["active_mode"] = json!("ghost"),
        }
        assert!(reopen
            .restore(&encode_envelope(&serde_json::to_vec(&outer).unwrap()))
            .is_err());
        assert_eq!(reopen.snapshot().unwrap(), wrapped);
    }
    // Clearing every variable feature returns snapshots to bare schema:1.
    call(&mut e, "removeVariable", json!({"id":"v"}));
    call(&mut e, "removeMode", json!({"id":"m"}));
    let snap = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&snap).unwrap();
    let bare: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(bare["schema"], 1);
    assert!(bare.get("document").is_none());
    assert!(bare.get("variables").is_none());
    assert!(bare.get("bindings").is_none());
}

fn constraint(horizontal: &str, vertical: &str) -> Value {
    json!({"horizontal":horizontal,"vertical":vertical})
}
#[test]
fn constraints_store_clear_persist_undo_and_read_silently() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let rect = shape(&mut e, 1, 1., 1., 2., 2., [255; 4]);
    let bare = e.snapshot().unwrap();
    // Unknown fields, missing anchors and non-object payloads reject.
    let before = e.snapshot().unwrap();
    for p in [
        json!({"id":rect,"constraints":{"horizontal":"left"}}),
        json!({"id":rect,"constraints":{"horizontal":"left","vertical":"top","extra":1}}),
        json!({"id":rect,"constraints":"left"}),
        json!({"id":rect,"constraints":null,"surprise":1}),
        json!({"id":rect}),
    ] {
        assert!(e.apply(Command::new("setConstraints", p)).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    let set = call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"left","vertical":"top","relative_to":1}}),
    );
    assert_eq!(set.events.len(), 1);
    let node = &e.state.nodes[&rect];
    assert_eq!(
        node.constraints,
        Some(NodeConstraints {
            horizontal: HorizontalAnchor::Left,
            vertical: VerticalAnchor::Top,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            aspect_locked: false,
            relative_to: Some(1),
        })
    );
    // Enforcement is live: left/top pin flush to the parent (root) box, so
    // the authored (1,1) offset is overridden to the canvas origin.
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (0., 0.));
    // Repeating the same write is a silent no-op.
    assert!(call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"left","vertical":"top","relative_to":1}})
    )
    .events
    .is_empty());
    // readConstraints is silent and reports live solve status.
    let read = call(&mut e, "readConstraints", json!({}));
    assert!(read.events.is_empty());
    assert_eq!(read.data["solving"], "evaluateLayout");
    assert_eq!(read.data["solve"]["status"], "solved");
    assert_eq!(read.data["accepted"]["horizontal"], json!(["left","right","center","stretch"]));
    assert_eq!(read.data["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(read.data["nodes"][0]["node_id"], rect);
    assert_eq!(read.data["nodes"][0]["enforced"], true);
    assert_eq!(read.data["nodes"][0]["satisfied"], true);
    assert_eq!(read.data["nodes"][0]["constraints"]["horizontal"], "left");
    let filtered = call(&mut e, "readConstraints", json!({"id":1}));
    assert!(filtered.data["nodes"].as_array().unwrap().is_empty());
    assert!(e
        .apply(Command::new("readConstraints", json!({"id":"x"})))
        .is_err());
    // Constraints trigger the schema:2 wrapper; restore round-trips.
    let wrapped = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["schema"], 2);
    assert_eq!(outer["document"]["nodes"][rect.to_string()]["constraints"]["vertical"], "top");
    let mut reopen = DesignEngine::new();
    reopen.restore(&wrapped).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), wrapped);
    // Clearing restores the bare schema:1 snapshot byte-for-byte.
    call(&mut e, "setConstraints", json!({"id":rect,"constraints":null}));
    assert!(e.state.nodes[&rect].constraints.is_none());
    assert_eq!(e.snapshot().unwrap(), bare);
    // Undo restores the set constraints, then the cleared state.
    assert!(e.undo().unwrap());
    assert!(e.state.nodes[&rect].constraints.is_some());
    assert!(e.undo().unwrap());
    assert!(e.state.nodes[&rect].constraints.is_none());
}
#[test]
fn constraints_reject_root_flow_scale_bad_targets_and_hostile_restore() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    // Root can never carry constraints.
    assert!(e
        .apply(Command::new(
            "setConstraints",
            json!({"id":1,"constraints":constraint("left","top")})
        ))
        .is_err());
    let rect = shape(&mut e, 1, 1., 1., 2., 2., [255; 4]);
    let sibling = shape(&mut e, 1, 5., 5., 2., 2., [0; 4]);
    // scale anchors parse but reject with a reason until the solver lands.
    for bad_anchor in [
        json!({"horizontal":"scale","vertical":"top"}),
        json!({"horizontal":"left","vertical":"scale"}),
    ] {
        let err = e
            .apply(Command::new(
                "setConstraints",
                json!({"id":rect,"constraints":bad_anchor}),
            ))
            .unwrap_err();
        assert!(err.message.contains("scale"), "{}", err.message);
    }
    // relative_to must resolve inside the parent/sibling scope: a node under
    // a different parent is out of scope until wider targets land.
    let frame0 = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    let cousin = shape(&mut e, frame0, 0., 0., 1., 1., [3; 4]);
    let err = e
        .apply(Command::new(
            "setConstraints",
            json!({"id":rect,"constraints":{"horizontal":"left","vertical":"top","relative_to":cousin}}),
        ))
        .unwrap_err();
    assert!(err.message.contains("relative_to"), "{}", err.message);
    call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"right","vertical":"bottom"}}),
    );
    // A nested frame starts absolute; flow children cannot carry anchors.
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":flow("row","start","start",0.)}),
    );
    let inner = shape(&mut e, frame, 0., 0., 1., 1., [9; 4]);
    let err = e
        .apply(Command::new(
            "setConstraints",
            json!({"id":inner,"constraints":constraint("center","stretch")}),
        ))
        .unwrap_err();
    assert!(err.message.contains("absolute"), "{}", err.message);
    // Absolute again: inner gains parent-relative anchors.
    call(&mut e, "setFrameLayout", json!({"id":frame,"layout":null}));
    call(
        &mut e,
        "setConstraints",
        json!({"id":inner,"constraints":{"horizontal":"center","vertical":"stretch","relative_to":frame}}),
    );
    // Hostile restores fail closed: constraints on the root, on a node whose
    // parent uses flow layout, scale anchors and non-parent relative_to.
    let wrapped = e.snapshot().unwrap();
    let mut reopen = DesignEngine::new();
    reopen.restore(&wrapped).unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    for mutation in ["root", "flow_child", "scale", "bad_relative"] {
        let mut hostile = outer.clone();
        let doc = &mut hostile["document"];
        match mutation {
            "root" => {
                doc["nodes"]["1"]["constraints"] = constraint("left", "top");
            }
            "flow_child" => {
                doc["nodes"][inner.to_string()]["constraints"] = constraint("left", "top");
                doc["nodes"][frame.to_string()]["layout"] = flow("row", "start", "start", 0.);
            }
            "scale" => {
                doc["nodes"][inner.to_string()]["constraints"] =
                    json!({"horizontal":"scale","vertical":"top"});
            }
            _ => {
                doc["nodes"][inner.to_string()]["constraints"] =
                    json!({"horizontal":"left","vertical":"top","relative_to":1});
            }
        }
        assert!(
            reopen
                .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
                .is_err(),
            "{mutation}"
        );
        assert_eq!(reopen.snapshot().unwrap(), wrapped);
    }
    // Converting frame to flow while inner is constrained rejects atomically.
    assert!(e
        .apply(Command::new(
            "setFrameLayout",
            json!({"id":frame,"layout":flow("row","start","start",0.)})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), wrapped);
    // Clearing inner constraints unblocks the flow switch; reparenting the
    // still-constrained rect under it then rejects atomically.
    call(&mut e, "setConstraints", json!({"id":inner,"constraints":null}));
    call(
        &mut e,
        "setFrameLayout",
        json!({"id":frame,"layout":flow("row","start","start",0.)}),
    );
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("reparentNode", json!({"id":rect,"parent":frame,"index":0})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    call(&mut e, "setConstraints", json!({"id":rect,"constraints":null}));
    call(
        &mut e,
        "reparentNode",
        json!({"id":rect,"parent":frame,"index":0}),
    );
    // rect is now a flow child: anchors reject with the placement reason.
    let err = e
        .apply(Command::new(
            "setConstraints",
            json!({"id":rect,"constraints":constraint("left","top")}),
        ))
        .unwrap_err();
    assert!(err.message.contains("absolute"), "{}", err.message);
    // Locked nodes reject constraint edits like any other mutation.
    call(
        &mut e,
        "setConstraints",
        json!({"id":sibling,"constraints":constraint("center","bottom")}),
    );
    call(&mut e, "updateNode", json!({"id":sibling,"locked":true}));
    assert!(e
        .apply(Command::new(
            "setConstraints",
            json!({"id":sibling,"constraints":null})
        ))
        .is_err());
}
#[test]
fn constraints_c2_bounds_targets_and_hostile_restore() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let rect = shape(&mut e, 1, 1., 1., 2., 2., [255; 4]);
    let sibling = shape(&mut e, 1, 5., 5., 2., 2., [0; 4]);
    // A full C2 constraint set stores every field and reads back intact.
    let full = json!({"horizontal":"left","vertical":"top","min_width":1.5,"max_width":8.,"min_height":0.5,"aspect_locked":true,"relative_to":sibling});
    let set = call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":full}),
    );
    assert_eq!(set.events.len(), 1);
    let node = &e.state.nodes[&rect];
    let c = node.constraints.as_ref().unwrap();
    assert_eq!(c.min_width, Some(1.5));
    assert_eq!(c.max_width, Some(8.));
    assert_eq!(c.min_height, Some(0.5));
    assert_eq!(c.max_height, None);
    assert!(c.aspect_locked);
    assert_eq!(c.relative_to, Some(sibling));
    // Left/top pin flush to the sibling's box origin (5,5); the C2 bounds
    // and aspect flag solve live inside evaluateLayout.
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (5., 5.));
    // readConstraints echoes the stored C2 fields and reports live status.
    let read = call(&mut e, "readConstraints", json!({"id":rect}));
    assert!(read.events.is_empty());
    assert_eq!(read.data["solving"], "evaluateLayout");
    assert_eq!(read.data["nodes"][0]["enforced"], true);
    assert_eq!(read.data["nodes"][0]["satisfied"], true);
    let reported = &read.data["nodes"][0]["constraints"];
    assert_eq!(reported["min_width"], 1.5);
    assert_eq!(reported["max_width"], 8.);
    assert_eq!(reported["aspect_locked"], true);
    assert_eq!(reported["relative_to"], sibling);
    assert!(reported.get("max_height").is_none());
    assert_eq!(
        read.data["accepted"]["relative_to"],
        json!(["parent", "sibling"])
    );
    // Equal writes are silent no-ops, including one omitting defaulted fields.
    assert!(call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":full})
    )
    .events
    .is_empty());
    // Bounds validation: finite, 0..=1e7, min<=max per axis.
    for bad in [
        json!({"horizontal":"left","vertical":"top","min_width":9.,"max_width":2.}),
        json!({"horizontal":"left","vertical":"top","min_height":4.,"max_height":1.}),
        json!({"horizontal":"left","vertical":"top","min_width":-0.5}),
        json!({"horizontal":"left","vertical":"top","max_height":1e8}),
        json!({"horizontal":"left","vertical":"top","max_width":10000001.}),
    ] {
        let err = e
            .apply(Command::new(
                "setConstraints",
                json!({"id":rect,"constraints":bad}),
            ))
            .unwrap_err();
        assert!(err.message.contains("constraint"), "{}", err.message);
    }
    // min==max is admitted; a lone bound needs no partner.
    call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"right","vertical":"bottom","min_width":3.,"max_width":3.}}),
    );
    // relative_to scope: self, unknown ids, the root from a non-root parent,
    // and nodes outside the sibling set all reject.
    let frame = call(&mut e, "addFrame", json!({"parent":1})).data["node_id"]
        .as_u64()
        .unwrap();
    let inner = shape(&mut e, frame, 0., 0., 1., 1., [9; 4]);
    for target in [rect, 9999, 1] {
        let err = e
            .apply(Command::new(
                "setConstraints",
                json!({"id":inner,"constraints":{"horizontal":"left","vertical":"top","relative_to":target}}),
            ))
            .unwrap_err();
        assert!(err.message.contains("relative_to"), "{target}: {}", err.message);
    }
    // Parent and sibling targets both resolve for inner.
    call(
        &mut e,
        "setConstraints",
        json!({"id":inner,"constraints":{"horizontal":"center","vertical":"stretch","relative_to":frame}}),
    );
    let inner_sibling = shape(&mut e, frame, 2., 0., 1., 1., [4; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":inner,"constraints":{"horizontal":"center","vertical":"stretch","relative_to":inner_sibling}}),
    );
    // Removing a relative_to target strands the reference: the whole-document
    // validation rejects the removal atomically instead of dropping it.
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("removeNode", json!({"id":inner_sibling})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Locked nodes reject C2 constraint writes like any other mutation.
    call(&mut e, "updateNode", json!({"id":sibling,"locked":true}));
    assert!(e
        .apply(Command::new(
            "setConstraints",
            json!({"id":sibling,"constraints":{"horizontal":"left","vertical":"top","aspect_locked":true}})
        ))
        .is_err());
    call(&mut e, "updateNode", json!({"id":sibling,"locked":false}));
    // C2 fields keep the schema:2 wrapper; snapshots without them stay
    // byte-identical (no new keys leak into h/v-only constraints).
    let wrapped = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["schema"], 2);
    let stored = &outer["document"]["nodes"][rect.to_string()]["constraints"];
    assert_eq!(stored["min_width"], 3.);
    assert_eq!(stored["max_width"], 3.);
    assert!(stored.get("aspect_locked").is_none());
    let plain = &outer["document"]["nodes"][inner_sibling.to_string()];
    assert!(plain.get("constraints").is_none());
    // A constraints object carrying only C1 fields serializes without the new
    // keys, so old schema:2 readers see the same bytes they always did — and
    // deny_unknown_fields makes them fail closed on C2 fields rather than
    // silently drop them.
    call(
        &mut e,
        "setConstraints",
        json!({"id":inner,"constraints":{"horizontal":"left","vertical":"top"}}),
    );
    let mut bare_engine = DesignEngine::new();
    bare_engine.restore(&wrapped).unwrap();
    assert_eq!(bare_engine.snapshot().unwrap(), wrapped);
    // Hostile restores fail closed on bad bounds and out-of-scope targets.
    let mut hostile_doc = outer.clone();
    let doc = &mut hostile_doc["document"];
    doc["nodes"][rect.to_string()]["constraints"]["min_width"] = json!(9.);
    doc["nodes"][rect.to_string()]["constraints"]["max_width"] = json!(2.);
    assert!(bare_engine
        .restore(&encode_envelope(&serde_json::to_vec(&hostile_doc).unwrap()))
        .is_err());
    let mut hostile_doc = outer.clone();
    let doc = &mut hostile_doc["document"];
    doc["nodes"][inner.to_string()]["constraints"] =
        json!({"horizontal":"left","vertical":"top","relative_to":rect});
    assert!(bare_engine
        .restore(&encode_envelope(&serde_json::to_vec(&hostile_doc).unwrap()))
        .is_err());
    // Undo/redo across the C2 write and the plain rewrite.
    assert!(e.undo().unwrap());
    assert_eq!(
        e.state.nodes[&inner].constraints.as_ref().unwrap().relative_to,
        Some(inner_sibling)
    );
    assert!(e.redo().unwrap());
    assert_eq!(
        e.state.nodes[&inner].constraints.as_ref().unwrap().relative_to,
        None
    );
}
#[test]
fn constraints_solve_anchors_bounds_aspect_siblings_and_cycles() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let find = |e: &DesignEngine, id: u64| {
        layout::evaluate(&e.state)
            .unwrap()
            .into_iter()
            .find(|b| b.id == id)
            .unwrap()
    };
    // right/bottom pin flush to the parent (root) box and stay pinned
    // across canvas resizes.
    let rect = shape(&mut e, 1, 15., 5., 2., 2., [255; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"right","vertical":"bottom"}}),
    );
    let b = find(&e, rect);
    assert_eq!((b.x, b.y, b.width, b.height), (18., 8., 2., 2.));
    call(&mut e, "setComposition", json!({"width":30,"height":20}));
    let b = find(&e, rect);
    assert_eq!((b.x, b.y), (28., 18.));
    // center pins the midpoint on both axes.
    let ctr = shape(&mut e, 1, 4., 3., 4., 2., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":ctr,"constraints":{"horizontal":"center","vertical":"center"}}),
    );
    let b = find(&e, ctr);
    assert_eq!((b.x, b.y), (13., 9.));
    // stretch spans the reference extent.
    let str_ = shape(&mut e, 1, 2., 1., 4., 3., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":str_,"constraints":{"horizontal":"stretch","vertical":"stretch"}}),
    );
    let b = find(&e, str_);
    assert_eq!((b.x, b.y, b.width, b.height), (0., 0., 30., 20.));
    // A bound that the stretch cannot satisfy marks the node unsatisfied
    // and keeps its unconstrained geometry — honestly reported, not hidden.
    let bounded = shape(&mut e, 1, 1., 1., 2., 2., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":bounded,"constraints":{"horizontal":"stretch","vertical":"top","max_width":5.}}),
    );
    let (_, solve) = layout::evaluate_report(&e.state).unwrap();
    assert_eq!(solve.unsatisfied, vec![bounded]);
    let b = find(&e, bounded);
    assert_eq!((b.x, b.y, b.width, b.height), (1., 1., 2., 2.));
    // aspect_locked derives the ratio from evaluated geometry: vertical
    // stretch pins height, width follows at the authored 2:1 ratio.
    let aspect = shape(&mut e, 1, 1., 1., 4., 2., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":aspect,"constraints":{"horizontal":"left","vertical":"stretch","aspect_locked":true}}),
    );
    let b = find(&e, aspect);
    assert_eq!((b.x, b.y, b.width, b.height), (0., 0., 40., 20.));
    // Sibling relative_to tracks the sibling's solved box.
    let anchor = shape(&mut e, 1, 6., 1., 2., 2., [0; 4]);
    let follower = shape(&mut e, 1, 10., 1., 2., 2., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":follower,"constraints":{"horizontal":"right","vertical":"top","relative_to":anchor}}),
    );
    let b = find(&e, follower);
    assert_eq!((b.x, b.y), (6., 1.));
    call(&mut e, "updateNode", json!({"id":anchor,"x":12.}));
    let b = find(&e, follower);
    assert_eq!((b.x, b.y), (12., 1.));
    // Mutually referencing constrained siblings form a dependency cycle:
    // both keep authored geometry and report unsatisfied.
    let cyc_a = shape(&mut e, 1, 3., 6., 1., 1., [0; 4]);
    let cyc_b = shape(&mut e, 1, 7., 6., 1., 1., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":cyc_a,"constraints":{"horizontal":"left","vertical":"top","relative_to":cyc_b}}),
    );
    call(
        &mut e,
        "setConstraints",
        json!({"id":cyc_b,"constraints":{"horizontal":"left","vertical":"top","relative_to":cyc_a}}),
    );
    let (_, solve) = layout::evaluate_report(&e.state).unwrap();
    assert!(solve.unsatisfied.contains(&cyc_a) && solve.unsatisfied.contains(&cyc_b));
    let b = find(&e, cyc_a);
    assert_eq!((b.x, b.y), (3., 6.));
    // evaluateLayout exposes the same report; readConstraints marks nodes.
    let result = e
        .apply(Command::new("evaluateLayout", json!({})))
        .unwrap();
    assert_eq!(result.data["constraints"]["status"], "partial");
    assert!(result.data["constraints"]["unsatisfied"]
        .as_array()
        .unwrap()
        .contains(&json!(bounded)));
    let read = call(&mut e, "readConstraints", json!({"id":bounded}));
    assert_eq!(read.data["solve"]["status"], "partial");
    assert_eq!(read.data["nodes"][0]["satisfied"], false);
    let read = call(&mut e, "readConstraints", json!({"id":rect}));
    assert_eq!(read.data["nodes"][0]["satisfied"], true);
    // Nested absolute frames scope constraints to their own evaluated box.
    let frame = call(&mut e, "addFrame", json!({"parent":1,"x":5,"y":5,"width":10,"height":10})).data["node_id"]
        .as_u64()
        .unwrap();
    let inner = shape(&mut e, frame, 0., 0., 2., 2., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":inner,"constraints":{"horizontal":"right","vertical":"bottom","relative_to":frame}}),
    );
    let b = find(&e, inner);
    assert_eq!((b.x, b.y), (13., 13.));
}
#[test]
fn solved_constraints_out_of_bounds_report_unsatisfied_not_failure() {
    // A satisfied solve can still land outside the ±1e7 renderer bound
    // `place` enforces: variable bindings reach geometry authored bounds
    // cannot. The solver must report the node unsatisfied and keep baseline
    // geometry rather than failing the whole layout read.
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":20}));
    mode(&mut e, "m", "M");
    var(&mut e, "far", "Far", "number");
    call(&mut e, "setVariableValue", json!({"id":"far","mode":"m","value":val("number",json!(9_999_990.))}));
    call(&mut e, "setActiveMode", json!({"id":"m"}));
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"x":0,"y":0,"width":20,"height":20}),
    )
    .data["node_id"]
    .as_u64()
    .unwrap();
    let child = shape(&mut e, frame, 0., 0., 1., 1., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":child,"constraints":{"horizontal":"right","vertical":"top"}}),
    );
    // Sanity: in bounds before the binding moves the reference frame.
    let result = call(&mut e, "evaluateLayout", json!({}));
    assert_eq!(result.data["constraints"]["status"], "solved");
    call(
        &mut e,
        "bindVariable",
        json!({"node_id":frame,"path":"x","variable_id":"far"}),
    );
    // The frame's own box stays in bounds (x = 9,999,990 <= 1e7), but the
    // right-anchored child's solved x = 9,999,990 + 20 - 1 exceeds 1e7.
    let result = call(&mut e, "evaluateLayout", json!({}));
    assert_eq!(result.data["constraints"]["status"], "partial");
    assert!(result.data["constraints"]["unsatisfied"]
        .as_array()
        .unwrap()
        .contains(&json!(child)));
    // Baseline geometry is kept: frame.x + authored child x.
    let b = result.data["boxes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == child)
        .unwrap();
    assert_eq!(
        (b["x"].as_f64().unwrap(), b["width"].as_f64().unwrap()),
        (9_999_990., 1.)
    );
}
#[test]
fn instance_expansion_solved_out_of_bounds_reports_unsatisfied() {
    // Same bound through expansion: a right-anchored clone under a huge
    // instance solves past 1e7 even though every authored box is in bounds.
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":20}));
    let comp = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"x":0,"y":0,"width":10,"height":10}),
    )
    .data["node_id"]
    .as_u64()
    .unwrap();
    let child = shape(&mut e, comp, 0., 0., 1., 1., [0; 4]);
    call(
        &mut e,
        "setConstraints",
        json!({"id":child,"constraints":{"horizontal":"right","vertical":"top"}}),
    );
    call(&mut e, "createComponent", json!({"id":comp}));
    // Instance box itself passes place() (x = 1e6, w = 1e7); the clone's
    // solved x = 1e6 + 1e7 - 1 = 10,999,999 exceeds the bound.
    call(
        &mut e,
        "createInstance",
        json!({"component":comp,"parent":1,"x":1_000_000,"y":0,"width":10_000_000,"height":10}),
    );
    let result = call(&mut e, "evaluateLayout", json!({}));
    assert_eq!(result.data["constraints"]["status"], "partial");
    let unsat = result.data["constraints"]["unsatisfied"]
        .as_array()
        .unwrap();
    assert_eq!(unsat.len(), 1);
    assert!(unsat[0].as_u64().unwrap() > SAFE_ID);
    // The synthetic clone keeps baseline geometry: instance.x + authored x.
    let synth = result.data["boxes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"].as_u64().unwrap() > SAFE_ID)
        .unwrap();
    assert_eq!(synth["x"].as_f64().unwrap(), 1_000_000.);
    assert_eq!(synth["width"].as_f64().unwrap(), 1.);
}
fn make_component(e: &mut DesignEngine, child_fill: [u8; 4]) -> (u64, u64) {
    let frame = call(
        e,
        "addFrame",
        json!({"parent":1,"x":0,"y":0,"width":10,"height":10}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let child = shape(e, frame, 1., 1., 2., 2., child_fill);
    call(e, "createComponent", json!({"id":frame}));
    (frame, child)
}
#[test]
fn instances_expand_deterministically_with_overrides_variants_and_undo() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let (comp, child) = make_component(&mut e, [9, 8, 7, 255]);
    let inst = call(
        &mut e,
        "createInstance",
        json!({"component":comp,"parent":1,"x":5,"y":0,"width":10,"height":10}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    // Stored state keeps the instance a leaf; expansion is read-only.
    let stored = &e.state.nodes[&inst];
    assert_eq!(stored.kind, Kind::Instance);
    assert!(stored.children.is_empty());
    assert_eq!(stored.instance.as_ref().unwrap().component, comp);
    // evaluateLayout expands: instance box plus a synthetic child clone.
    let expanded = components::expand(&e.state).unwrap();
    let boxes = layout::evaluate(&expanded).unwrap();
    let inst_box = boxes.iter().find(|b| b.id == inst).unwrap();
    assert_eq!(inst_box.kind, Kind::Instance);
    let synth = boxes.iter().find(|b| b.id > SAFE_ID).unwrap();
    assert_eq!((synth.x, synth.y, synth.width, synth.height), (6., 1., 2., 2.));
    assert_eq!(synth.fill, [9, 8, 7, 255]);
    // Determinism: two expansions produce identical boxes.
    let again = layout::evaluate(&components::expand(&e.state).unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&boxes).unwrap(),
        serde_json::to_value(&again).unwrap()
    );
    // Instance overrides hit descendant clones and the instance root.
    call(
        &mut e,
        "updateInstance",
        json!({"id":inst,"overrides":[
            {"node":child,"path":"fill","value":[1,2,3,255]},
            {"node":comp,"path":"fill","value":[4,5,6,255]},
            {"node":child,"path":"x","value":0.}
        ]}),
    );
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    // Child clone at instance x5 + override x0 -> pixel (5,1) is child fill.
    assert_eq!(&pixels[(1 * 20 + 5) as usize * 4..][..4], &[1, 2, 3, 255]);
    // Instance root fill shows inside its box but outside the child.
    assert_eq!(&pixels[(7 * 20 + 7) as usize * 4..][..4], &[4, 5, 6, 255]);
    // Variant selection swaps the property bundle; instance overrides win.
    call(
        &mut e,
        "updateComponent",
        json!({"id":comp,"variants":[{"name":"alt","properties":[
            {"node":child,"path":"x","value":3.},
            {"node":child,"path":"fill","value":[7,7,7,255]}
        ]}]}),
    );
    call(&mut e, "updateInstance", json!({"id":inst,"variant":"alt"}));
    let pixels = e
        .apply(Command::new("renderFrame", json!({})).with_binary(None))
        .unwrap()
        .output
        .unwrap();
    // Variant x=3 loses to the instance override x=0; variant fill loses to
    // the instance override fill [1,2,3,255] on the same (node,path).
    assert_eq!(&pixels[(1 * 20 + 5) as usize * 4..][..4], &[1, 2, 3, 255]);
    // Undo/redo across the variant selection.
    assert!(e.undo().unwrap());
    assert!(e.redo().unwrap());
    assert_eq!(
        e.state.nodes[&inst].instance.as_ref().unwrap().variant.as_deref(),
        Some("alt")
    );
    // describeComponents reports both sides for the variant picker contract.
    let desc = call(&mut e, "describeComponents", json!({})).data;
    assert_eq!(desc["components"][0]["id"], comp);
    assert_eq!(desc["components"][0]["variants"][0]["name"], "alt");
    assert_eq!(desc["instances"][0]["component"], comp);
    assert_eq!(desc["instances"][0]["variant"], "alt");
    // Snapshot carries the schema:2 wrapper and round-trips byte-identically.
    let bytes = e.snapshot().unwrap();
    let mut reopen = DesignEngine::new();
    reopen.restore(&bytes).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), bytes);
    // Equal updateInstance is a silent no-op.
    let r = e.apply(Command::new(
        "updateInstance",
        json!({"id":inst,"variant":"alt"}),
    ));
    assert!(r.unwrap().events.is_empty());
}
#[test]
fn detach_instance_materializes_expansion_and_undo_restores() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let (comp, child) = make_component(&mut e, [9, 8, 7, 255]);
    let inst = call(
        &mut e,
        "createInstance",
        json!({"component":comp,"parent":1,"x":5,"y":0,"width":10,"height":10,
               "overrides":[{"node":child,"path":"fill","value":[1,2,3,255]}]}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    call(&mut e, "detachInstance", json!({"id":inst}));
    let node = &e.state.nodes[&inst];
    assert_eq!(node.kind, Kind::Frame);
    assert!(node.instance.is_none());
    assert_eq!(node.children.len(), 1);
    let materialized = node.children[0];
    assert!(materialized < e.state.next_id && materialized != child);
    assert_eq!(e.state.nodes[&materialized].fill, [1, 2, 3, 255]);
    // No instance spec remains anywhere; expansion is now ordinary state.
    assert!(!e.state.nodes.values().any(|n| n.kind == Kind::Instance));
    let boxes = layout::evaluate(&e.state).unwrap();
    assert!(boxes.iter().any(|b| b.id == materialized && b.x == 6.));
    assert!(e.undo().unwrap());
    assert_eq!(e.state.nodes[&inst].kind, Kind::Instance);
    assert!(e.redo().unwrap());
    assert_eq!(e.state.nodes[&inst].kind, Kind::Frame);
}
#[test]
fn component_lifecycle_rules_cascade_and_reject_bad_references() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let (comp, _child) = make_component(&mut e, [9, 8, 7, 255]);
    let before = e.snapshot().unwrap();
    // Unknown component, non-component target, bad variant, stranded override.
    for (op, p) in [
        ("createInstance", json!({"component":999,"parent":1})),
        ("createInstance", json!({"component":1,"parent":1})),
        ("createInstance", json!({"component":comp,"parent":1,"variant":"ghost"})),
        ("createInstance", json!({"component":comp,"parent":1,
            "overrides":[{"node":1,"path":"fill","value":[0,0,0,255]}]})),
        ("createInstance", json!({"component":comp,"parent":1,
            "overrides":[{"node":_child,"path":"fill","value":"red"}]})),
        ("updateComponent", json!({"id":1,"name":"No"})),
        ("createComponent", json!({"id":1})),
        ("detachInstance", json!({"id":comp})),
    ] {
        assert!(e.apply(Command::new(op, p.clone())).is_err(), "{op} {p}");
        assert_eq!(e.snapshot().unwrap(), before);
    }
    let inst = call(
        &mut e,
        "createInstance",
        json!({"component":comp,"parent":1}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    // Removing the component while an instance references it fails closed.
    assert!(e.apply(Command::new("removeNode", json!({"id":comp}))).is_err());
    assert_eq!(e.state.nodes[&comp].kind, Kind::Component);
    // Removing a template node that an override targets also fails closed.
    call(
        &mut e,
        "updateInstance",
        json!({"id":inst,"overrides":[{"node":_child,"path":"visible","value":false}]}),
    );
    assert!(e.apply(Command::new("removeNode", json!({"id":_child}))).is_err());
    // Clearing overrides frees the template node; then instance removal
    // frees the component for deletion.
    call(&mut e, "updateInstance", json!({"id":inst,"overrides":[]}));
    call(&mut e, "removeNode", json!({"id":_child}));
    call(&mut e, "removeNode", json!({"id":inst}));
    call(&mut e, "removeNode", json!({"id":comp}));
    assert!(!e.state.nodes.values().any(|n| matches!(n.kind, Kind::Component | Kind::Instance)));
}
#[test]
fn component_reference_cycles_and_expansion_bounds_fail_reads_not_edits() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4}));
    // Two components that instance each other inside their subtrees cycle.
    let a = call(&mut e, "addFrame", json!({"parent":1,"width":4,"height":4})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":a}));
    let b = call(&mut e, "addFrame", json!({"parent":1,"width":4,"height":4})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":b}));
    call(&mut e, "createInstance", json!({"component":a,"parent":b}));
    // A->? edge: instance of b inside a would close the cycle.
    let snap = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            "createInstance",
            json!({"component":b,"parent":a}),
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), snap);
    // Depth bound: a chain of 9 nested component instances exceeds
    // MAX_EXPANSION_DEPTH at read time while edits stay possible.
    let mut e2 = DesignEngine::new();
    call(&mut e2, "new", json!({"width":4,"height":4}));
    let mut comps = vec![];
    for _ in 0..9 {
        let f = call(&mut e2, "addFrame", json!({"parent":1,"width":4,"height":4}))
            .data["node_id"]
            .as_u64()
            .unwrap();
        call(&mut e2, "createComponent", json!({"id":f}));
        comps.push(f);
    }
    // comps[i] gets an instance of comps[i+1] inside its subtree.
    for i in 0..8 {
        call(
            &mut e2,
            "createInstance",
            json!({"component":comps[i + 1],"parent":comps[i]}),
        );
    }
    call(
        &mut e2,
        "createInstance",
        json!({"component":comps[0],"parent":1}),
    );
    assert!(components::expand(&e2.state).is_err());
    assert!(e2.apply(Command::new("evaluateLayout", json!({}))).is_err());
    let desc = call(&mut e2, "describeComponents", json!({})).data;
    assert!(desc["instances"][0]["unavailable_reason"].is_string());
    // Mutations still work so the document can be repaired.
    call(&mut e2, "updateNode", json!({"id":1,"name":"still editable"}));
    // Node bound: many instances over a wide component exceed
    // MAX_EXPANDED_NODES at read time.
    let mut e3 = DesignEngine::new();
    call(&mut e3, "new", json!({"width":4,"height":4}));
    let (wide, _) = {
        let f = call(&mut e3, "addFrame", json!({"parent":1,"width":4,"height":4}))
            .data["node_id"]
            .as_u64()
            .unwrap();
        for i in 0..100 {
            shape(&mut e3, f, (i % 10) as f64, (i / 10) as f64, 1., 1., [0; 4]);
        }
        call(&mut e3, "createComponent", json!({"id":f}));
        (f, 0)
    };
    for _ in 0..200 {
        call(
            &mut e3,
            "createInstance",
            json!({"component":wide,"parent":1,"x":0.,"y":0.,"width":4.,"height":4.}),
        );
    }
    assert!(components::expand(&e3.state).is_err());
}
#[test]
fn component_instance_snapshot_wrapper_and_hostile_restore() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    let (comp, child) = make_component(&mut e, [9, 8, 7, 255]);
    call(
        &mut e,
        "createInstance",
        json!({"component":comp,"parent":1,
               "overrides":[{"node":child,"path":"visible","value":false}]}),
    );
    let bytes = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bytes).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["schema"], 2);
    // Round-trip plus hostile mutations all fail closed.
    let mut reopen = DesignEngine::new();
    reopen.restore(&bytes).unwrap();
    assert_eq!(reopen.snapshot().unwrap(), bytes);
    // Unwrapped state carrying an instance spec is rejected.
    let bare = serde_json::to_vec(&*e.state).unwrap();
    assert!(reopen.restore(&encode_envelope(&bare)).is_err());
    for mutation in ["component", "variant", "override_target", "kind"] {
        let mut doc = outer.clone();
        let nodes = &mut doc["document"]["nodes"];
        let inst_key = nodes
            .as_object()
            .unwrap()
            .keys()
            .find(|k| nodes[*k]["kind"] == "instance")
            .unwrap()
            .clone();
        match mutation {
            "component" => {
                nodes[&inst_key]["instance"]["component"] = json!(999);
            }
            "variant" => {
                nodes[&inst_key]["instance"]["variant"] = json!("ghost");
            }
            "override_target" => {
                nodes[&inst_key]["instance"]["overrides"] =
                    json!([{"node":1,"path":"fill","value":[0,0,0,255]}]);
            }
            _ => {
                nodes[&inst_key]["kind"] = json!("frame");
            }
        }
        assert!(
            reopen
                .restore(&encode_envelope(&serde_json::to_vec(&doc).unwrap()))
                .is_err(),
            "{mutation}"
        );
        assert_eq!(reopen.snapshot().unwrap(), bytes);
    }
}
#[test]
fn nested_instance_templates_expand_from_pristine_state_without_orphans() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":40,"height":20}));
    // Component D: a frame with one fill-sized rect child.
    let d = call(&mut e, "addFrame", json!({"parent":1,"x":0,"y":0,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    let rd = shape(&mut e, d, 1., 1., 2., 2., [9, 8, 7, 255]);
    call(&mut e, "setFrameLayout", json!({"id":d,"layout":{"direction":"row","gap":0,"padding_top":0,"padding_right":0,"padding_bottom":0,"padding_left":0,"align":"start","justify":"start"}}));
    size(&mut e, rd, "x", "fill");
    call(&mut e, "createComponent", json!({"id":d}));
    // Component C contains an instance of D plus its own rect.
    let c = call(&mut e, "addFrame", json!({"parent":1,"x":0,"y":0,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    let inner = call(&mut e, "createInstance", json!({"component":d,"parent":c})).data["node_id"].as_u64().unwrap();
    let rc = shape(&mut e, c, 1., 1., 2., 2., [1, 2, 3, 255]);
    call(&mut e, "createComponent", json!({"id":c}));
    // Top-level instance J of C, created after the inner instance so the
    // stored DFS expands the inner instance first.
    let j = call(&mut e, "createInstance", json!({"component":c,"parent":1,"x":0,"y":0,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    // The inner instance's in-place expansion must not leak synthetic
    // children into J's template walk: no orphan clones, no fill orphan
    // parent failure, deterministic box count.
    let expanded = components::expand(&e.state).unwrap();
    let boxes = layout::evaluate(&expanded).unwrap();
    // root + D(1+rd) + C(c,inner,inner's rd clone,rc) + J(j,inner clone,rd clone,rc clone) = 11.
    assert_eq!(boxes.len(), 11, "{:?}", boxes.iter().map(|b| b.id).collect::<Vec<_>>());
    assert!(e.apply(Command::new("evaluateLayout", json!({}))).is_ok());
    // Every synthetic box id is unique; no id appears twice.
    let ids: std::collections::BTreeSet<u64> = boxes.iter().map(|b| b.id).collect();
    assert_eq!(ids.len(), boxes.len());
    // Detach J: the materialized subtree keeps working state.
    call(&mut e, "detachInstance", json!({"id":j}));
    assert_eq!(e.state.nodes[&j].kind, Kind::Frame);
    assert!(layout::evaluate(&e.state).is_ok());
    let _ = (inner, rc, rd);
}
#[test]
fn detach_remaps_variant_targets_on_cloned_component_nodes() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":20,"height":10}));
    // Outer component C.
    let c = call(&mut e, "addFrame", json!({"parent":1,"x":0,"y":0,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":c}));
    // Nested component D inside C's subtree, bearing a variant whose
    // override targets D's own child.
    let d = call(&mut e, "addFrame", json!({"parent":c,"x":0,"y":0,"width":5,"height":5})).data["node_id"].as_u64().unwrap();
    let rd = shape(&mut e, d, 0., 0., 1., 1., [7, 7, 7, 255]);
    call(&mut e, "createComponent", json!({"id":d}));
    call(&mut e, "updateComponent", json!({"id":d,"variants":[{"name":"alt","properties":[{"node":rd,"path":"fill","value":[5,5,5,255]}]}]}));
    // Instance J of C at the root, then detach materializes the expansion.
    let j = call(&mut e, "createInstance", json!({"component":c,"parent":1,"x":0,"y":0,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    call(&mut e, "detachInstance", json!({"id":j}));
    assert_eq!(e.state.nodes[&j].kind, Kind::Frame);
    // The detached subtree contains a component clone whose variant targets
    // were re-identified onto the detached child, not the template ids.
    let clone_comp = e.state.nodes[&j].children[0];
    let clone_node = &e.state.nodes[&clone_comp];
    assert_eq!(clone_node.kind, Kind::Component);
    let detached_child = clone_node.children[0];
    assert_ne!(detached_child, rd);
    let props = &clone_node.variants[0].properties;
    assert_eq!(props[0].node, detached_child);
    assert!(layout::evaluate(&e.state).is_ok());
    // Undo restores the instance; redo re-detaches cleanly.
    assert!(e.undo().unwrap());
    assert_eq!(e.state.nodes[&j].kind, Kind::Instance);
    assert!(e.redo().unwrap());
    assert_eq!(e.state.nodes[&j].kind, Kind::Frame);
}
#[test]
fn instance_sizing_is_fixed_on_mutation_and_hostile_restore() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let (comp, _) = make_component(&mut e, [9, 8, 7, 255]);
    let inst = call(&mut e, "createInstance", json!({"component":comp,"parent":1})).data["node_id"].as_u64().unwrap();
    let before = e.snapshot().unwrap();
    for mode in ["hug", "fill"] {
        for axis in ["x", "y"] {
            assert!(e
                .apply(Command::new("setAxisSizing", json!({"id":inst,"axis":axis,"mode":mode})))
                .is_err(), "{axis} {mode}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }
    // Fixed sizing with an explicit value stays admitted on instances.
    call(&mut e, "setAxisSizing", json!({"id":inst,"axis":"x","mode":"fixed","value":12.}));
    assert_eq!(e.state.nodes[&inst].width, 12.);
    // readAxisSizing reports hug/fill as unavailable for instances.
    let caps = call(&mut e, "readAxisSizing", json!({"id":inst}));
    assert_eq!(caps.data["x"]["canHug"], false);
    assert_eq!(caps.data["x"]["canFill"], false);
    // Hostile restore with non-fixed instance sizing fails closed (the
    // instance forces the schema:2 wrapper, so mutate `document`).
    let current = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&current).unwrap();
    let mut outer: Value = serde_json::from_slice(&raw).unwrap();
    outer["document"]["nodes"][inst.to_string()]["sizing"] = json!({"x":"fill","y":"fixed"});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&outer).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), current);
}
#[test]
fn component_containment_cycles_reject_at_validation_not_read_time() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    // Component B whose subtree embeds component A; A instances B. Expansion
    // would recurse B -> A -> B -> ..., so validation rejects the edge set.
    let b = call(&mut e, "addFrame", json!({"parent":1,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":b}));
    let a = call(&mut e, "addFrame", json!({"parent":b,"width":5,"height":5})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":a}));
    let snap = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("createInstance", json!({"component":b,"parent":a})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), snap);
    // Acyclic component-in-component nesting stays admitted: C contains
    // component E which instances unrelated D.
    let c = call(&mut e, "addFrame", json!({"parent":1,"width":10,"height":10})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":c}));
    let d = call(&mut e, "addFrame", json!({"parent":1,"width":4,"height":4})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":d}));
    let ecomp = call(&mut e, "addFrame", json!({"parent":c,"width":5,"height":5})).data["node_id"].as_u64().unwrap();
    call(&mut e, "createComponent", json!({"id":ecomp}));
    call(&mut e, "createInstance", json!({"component":d,"parent":ecomp}));
    call(&mut e, "createInstance", json!({"component":c,"parent":1}));
    assert!(components::expand(&e.state).is_ok());
    assert!(e.apply(Command::new("evaluateLayout", json!({}))).is_ok());
}
#[test]
fn override_and_variant_budgets_reject() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let (comp, child) = make_component(&mut e, [9, 8, 7, 255]);
    // Variant count cap.
    let variants: Vec<Value> = (0..MAX_VARIANTS + 1)
        .map(|i| json!({"name":format!("v{i}")}))
        .collect();
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("updateComponent", json!({"id":comp,"variants":variants})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // Override count cap via hostile restore (duplicate pairs would fail the
    // uniqueness check anyway; the budget check runs first).
    let inst = call(&mut e, "createInstance", json!({"component":comp,"parent":1})).data["node_id"].as_u64().unwrap();
    let wrapped = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&wrapped).unwrap();
    let mut outer: Value = serde_json::from_slice(&raw).unwrap();
    let overrides: Vec<Value> = (0..MAX_OVERRIDES + 1)
        .map(|_| json!({"node":child,"path":"visible","value":false}))
        .collect();
    outer["document"]["nodes"][inst.to_string()]["instance"]["overrides"] = json!(overrides);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&outer).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), wrapped);
}
// --- Prototype catalog (slice E) ---
fn screen(e: &mut DesignEngine) -> u64 {
    call(
        e,
        "addFrame",
        json!({"parent":1,"name":"Screen A","width":100,"height":100}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap()
}
fn proto_screen(e: &mut DesignEngine, node: u64, entry: bool) {
    call(
        e,
        "definePrototypeScreen",
        json!({"node":node,"entry":entry}),
    );
}
fn proto_hotspot(e: &mut DesignEngine, screen_node: u64, id: &str) {
    call(
        e,
        "definePrototypeHotspot",
        json!({"id":id,"screen":screen_node,"label":"Go","x":0.1,"y":0.1,"width":0.5,"height":0.5}),
    );
}
fn proto_transition(e: &mut DesignEngine, id: &str, kind: &str, duration: u64) {
    call(
        e,
        "definePrototypeTransition",
        json!({"id":id,"label":id,"kind":kind,"easing":"ease-in-out","duration_ms":duration}),
    );
}
#[test]
fn prototype_crud_graph_and_resolve_are_deterministic_and_eventless() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let a = screen(&mut e);
    let b = screen(&mut e);
    proto_screen(&mut e, a, true);
    proto_screen(&mut e, b, false);
    proto_hotspot(&mut e, a, "hot-1");
    proto_transition(&mut e, "tr-1", "dissolve", 250);
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-1","hotspot":"hot-1","trigger":"tap","action":"navigate","target":{"kind":"screen","node":b},"transition":"tr-1","delay_ms":0}),
    );
    // Screen-level timer interaction with no transition and a duration override.
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-2","screen":b,"trigger":"timer","delay_ms":500,"action":"back"}),
    );
    let before = e.snapshot().unwrap();
    // Reads are eventless and leave snapshot bytes identical.
    let g = call(&mut e, "prototypeGraph", json!({}));
    assert!(g.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    let graph = &g.data;
    assert_eq!(graph["screens"].as_array().unwrap().len(), 2);
    assert_eq!(graph["screens"][0]["entry"], true);
    assert_eq!(graph["hotspots"][0]["id"], "hot-1");
    assert_eq!(graph["interactions"].as_array().unwrap().len(), 2);
    assert_eq!(graph["transitions"][0]["kind"], "dissolve");
    // links derive from navigate interactions in catalog order.
    assert_eq!(graph["links"].as_array().unwrap().len(), 1);
    assert_eq!(graph["links"][0]["source"], a);
    assert_eq!(graph["links"][0]["target"], b);
    // resolvePrototypeEvent: hotspot + trigger resolves the interaction and
    // its transition; repeated calls return identical payloads.
    let r1 = call(
        &mut e,
        "resolvePrototypeEvent",
        json!({"hotspot":"hot-1","trigger":"tap"}),
    );
    assert!(r1.events.is_empty());
    let r2 = call(
        &mut e,
        "resolvePrototypeEvent",
        json!({"hotspot":"hot-1","trigger":"tap"}),
    );
    assert_eq!(r1.data, r2.data);
    assert_eq!(r1.data["matched"], true);
    assert_eq!(r1.data["interaction"]["id"], "ix-1");
    assert_eq!(r1.data["transition"]["id"], "tr-1");
    assert_eq!(r1.data["transition"]["duration_ms"], 250);
    assert_eq!(r1.data["scheduled_by"], "host");
    // No match returns JSON null; wrong trigger on the same hotspot too.
    let none = call(
        &mut e,
        "resolvePrototypeEvent",
        json!({"hotspot":"hot-1","trigger":"hover"}),
    );
    assert_eq!(none.data, Value::Null);
    // Screen scope reaches screen-level and hotspot interactions; trigger
    // filter picks the timer on screen b.
    let timer = call(
        &mut e,
        "resolvePrototypeEvent",
        json!({"screen":b,"trigger":"timer"}),
    );
    assert_eq!(timer.data["interaction"]["id"], "ix-2");
    assert_eq!(timer.data["transition"], Value::Null);
    assert_eq!(timer.data["delay_ms"], 500);
    // Event descriptor validation: unknown fields and missing scope reject.
    assert!(e
        .apply(Command::new(
            "resolvePrototypeEvent",
            json!({"hotspot":"hot-1","bogus":1})
        ))
        .is_err());
    assert!(e
        .apply(Command::new("resolvePrototypeEvent", json!({})))
        .is_err());
    // Undo restores the pre-define state; redo reapplies.
    assert!(e.undo().unwrap());
    assert_eq!(e.state.prototype.interactions.len(), 1);
    assert!(e.redo().unwrap());
    assert_eq!(e.state.prototype.interactions.len(), 2);
}
#[test]
fn prototype_validation_bounds_targets_and_atomic_rejection() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let a = screen(&mut e);
    proto_screen(&mut e, a, false);
    let before = e.snapshot().unwrap();
    // Hotspot geometry must stay inside the unit square.
    for (x, y, w, h) in [
        (1.1, 0., 0.5, 0.5),
        (0., 0., 0., 0.5),
        (0.6, 0., 0.5, 0.5),
        (0., -0.1, 0.5, 0.5),
    ] {
        assert!(e
            .apply(Command::new(
                "definePrototypeHotspot",
                json!({"id":"bad","screen":a,"label":"x","x":x,"y":y,"width":w,"height":h})
            ))
            .is_err());
    }
    assert_eq!(e.snapshot().unwrap(), before);
    // Interaction attachment is exactly-one hotspot XOR screen.
    proto_hotspot(&mut e, a, "hot-1");
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i1","trigger":"tap","action":"back"})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i2","hotspot":"hot-1","screen":a,"trigger":"tap","action":"back"})
        ))
        .is_err());
    // Action/target pairing: navigate needs a registered screen target.
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i3","hotspot":"hot-1","trigger":"tap","action":"navigate"})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i4","hotspot":"hot-1","trigger":"tap","action":"back","target":{"kind":"screen","node":a}})
        ))
        .is_err());
    // Timing bounds.
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i5","hotspot":"hot-1","trigger":"tap","action":"back","delay_ms":MAX_DELAY_MS+1})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i6","hotspot":"hot-1","trigger":"tap","action":"back","duration_ms":MAX_TRANSITION_MS+1})
        ))
        .is_err());
    // Slide transitions require a direction; other kinds reject one.
    assert!(e
        .apply(Command::new(
            "definePrototypeTransition",
            json!({"id":"ts","label":"s","kind":"slide","duration_ms":100})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "definePrototypeTransition",
            json!({"id":"td","label":"d","kind":"dissolve","direction":"left","duration_ms":100})
        ))
        .is_err());
    // Unknown references reject.
    assert!(e
        .apply(Command::new(
            "definePrototypeHotspot",
            json!({"id":"h2","screen":999,"label":"x","x":0.,"y":0.,"width":0.5,"height":0.5})
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i7","hotspot":"missing","trigger":"tap","action":"back"})
        ))
        .is_err());
    // set-variable needs an existing variable and a type-matching literal.
    call(&mut e, "defineVariable", json!({"id":"flag","name":"Flag","type":"boolean"}));
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i8","hotspot":"hot-1","trigger":"tap","action":"set-variable","target":{"kind":"variable","id":"flag"},"value":{"kind":"number","value":3}})
        ))
        .is_err());
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"i8","hotspot":"hot-1","trigger":"tap","action":"set-variable","target":{"kind":"variable","id":"flag"},"value":{"kind":"boolean","value":true}}),
    );
    // Duplicate ids reject; state is unchanged by every rejection above.
    assert!(e
        .apply(Command::new(
            "definePrototypeHotspot",
            json!({"id":"hot-1","screen":a,"label":"dup","x":0.,"y":0.,"width":0.5,"height":0.5})
        ))
        .is_err());
    // Unknown transition references reject too.
    assert!(e
        .apply(Command::new(
            "definePrototypeInteraction",
            json!({"id":"i9","hotspot":"hot-1","trigger":"hover","action":"navigate","target":{"kind":"screen","node":a},"transition":"tr-x"})
        ))
        .is_err());
    assert_eq!(e.state.prototype.interactions.len(), 1);
}
#[test]
fn prototype_transition_lifecycle_cascades_and_hostile_restore() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    let a = screen(&mut e);
    let b = screen(&mut e);
    proto_screen(&mut e, a, true);
    proto_screen(&mut e, b, false);
    proto_hotspot(&mut e, a, "hot-1");
    call(
        &mut e,
        "definePrototypeTransition",
        json!({"id":"tr-1","label":"slide","kind":"slide","direction":"left","easing":"ease-in-out","duration_ms":300}),
    );
    // A slide transition without a direction cannot even be defined.
    assert!(e
        .apply(Command::new(
            "definePrototypeTransition",
            json!({"id":"tr-bad","label":"bad","kind":"slide","duration_ms":100})
        ))
        .is_err());
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-1","hotspot":"hot-1","trigger":"tap","action":"navigate","target":{"kind":"screen","node":b},"transition":"tr-1","duration_ms":100}),
    );
    // Referenced transition cannot be removed.
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new("removePrototypeTransition", json!({"id":"tr-1"})))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // resolve applies the interaction duration override over the preset.
    let r = call(
        &mut e,
        "resolvePrototypeEvent",
        json!({"hotspot":"hot-1","trigger":"tap"}),
    );
    assert_eq!(r.data["transition"]["kind"], "slide");
    assert_eq!(r.data["transition"]["direction"], "left");
    assert_eq!(r.data["transition"]["duration_ms"], 100);
    // Removing the interaction frees the transition.
    call(&mut e, "removePrototypeInteraction", json!({"id":"ix-1"}));
    call(&mut e, "removePrototypeTransition", json!({"id":"tr-1"}));
    assert!(e.state.prototype.transitions.is_empty());
    // Removing a screen cascades its hotspots and interactions.
    proto_hotspot(&mut e, a, "hot-2");
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-2","hotspot":"hot-2","trigger":"tap","action":"navigate","target":{"kind":"screen","node":b}}),
    );
    call(&mut e, "removePrototypeScreen", json!({"node":a}));
    assert!(e.state.prototype.screens.iter().all(|s| s.node != a));
    assert!(e.state.prototype.hotspots.iter().all(|h| h.screen != a));
    assert!(e.state.prototype.interactions.is_empty());
    // removeNode on a screen node prunes the catalog the same way (b is
    // still a registered screen from above).
    proto_hotspot(&mut e, b, "hot-3");
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-3","hotspot":"hot-3","trigger":"tap","action":"navigate","target":{"kind":"screen","node":b}}),
    );
    call(&mut e, "removeNode", json!({"id":b}));
    assert!(e.state.prototype.is_empty());
    // Snapshot round-trips through the schema:2 wrapper byte-identically.
    let a2 = screen(&mut e);
    proto_screen(&mut e, a2, true);
    proto_hotspot(&mut e, a2, "hot-9");
    call(
        &mut e,
        "definePrototypeTransition",
        json!({"id":"tr-9","label":"fade","kind":"dissolve","duration_ms":200}),
    );
    call(
        &mut e,
        "definePrototypeInteraction",
        json!({"id":"ix-9","hotspot":"hot-9","trigger":"tap","action":"back","transition":"tr-9"}),
    );
    let bytes = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bytes).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["kind"], "design");
    assert_eq!(outer["schema"], 2);
    assert!(outer["document"]["prototype"]["interactions"].is_array());
    let mut e2 = DesignEngine::new();
    e2.restore(&bytes).unwrap();
    assert_eq!(e2.snapshot().unwrap(), bytes);
    let g = call(&mut e2, "prototypeGraph", json!({}));
    assert_eq!(g.data["interactions"][0]["id"], "ix-9");
    // Hostile restore: unwrapped state carrying prototype state rejects.
    let doc = serde_json::to_vec(&e2.state).unwrap();
    assert!(DesignEngine::new().restore(&encode_envelope(&doc)).is_err());
    // Hostile restore: interaction targeting a missing screen rejects.
    let mut tampered: Value = outer.clone();
    tampered["document"]["prototype"]["interactions"][0]["target"] =
        json!({"kind":"screen","node":424242});
    // back action with a target is itself invalid; use navigate instead.
    tampered["document"]["prototype"]["interactions"][0]["action"] = json!("navigate");
    assert!(e2
        .restore(&encode_envelope(&serde_json::to_vec(&tampered).unwrap()))
        .is_err());
    assert_eq!(e2.snapshot().unwrap(), bytes);
}
// --- Comment threads/pins (slice G) ---
fn comment_thread(e: &mut DesignEngine, id: &str, x: f64, y: f64) {
    call(
        e,
        "defineCommentThread",
        json!({"id":id,"anchor":{"x":x,"y":y},"body":"Please widen this","author":"Ada","time_label":"2 hours ago"}),
    );
}
#[test]
fn comments_crud_resolve_reply_list_and_undo_are_eventless_reads() {
    let mut e = DesignEngine::new();
    call(&mut e, "new", json!({"width":10,"height":10}));
    // Schema:1-only documents stay byte-identical with no comment state.
    let bare = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bare).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert!(outer.get("document").is_none());
    assert!(outer.get("comments").is_none());
    // defineCommentThread assigns comment-N ids when id is omitted.
    let auto = call(
        &mut e,
        "defineCommentThread",
        json!({"anchor":{"x":1.5,"y":2.5},"body":"Auto id"}),
    );
    assert_eq!(auto.data["id"], "comment-1");
    comment_thread(&mut e, "c-1", 3., 4.);
    // Replies get per-thread reply-N ids and return them.
    let reply = call(
        &mut e,
        "addCommentReply",
        json!({"thread":"c-1","body":"Done","author":"Bo"}),
    );
    assert_eq!(reply.data["id"], "reply-1");
    call(
        &mut e,
        "addCommentReply",
        json!({"thread":"c-1","body":"Thanks"}),
    );
    // listComments is a silent read: same snapshot before and after.
    let before = e.snapshot().unwrap();
    let listed = call(&mut e, "listComments", json!({}));
    assert!(listed.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), before);
    let threads = listed.data["threads"].as_array().unwrap();
    assert_eq!(threads.len(), 2);
    assert_eq!(threads[1]["id"], "c-1");
    assert_eq!(threads[1]["anchor"], json!({"x":3.0,"y":4.0}));
    assert_eq!(threads[1]["author"], "Ada");
    assert_eq!(threads[1]["replies"].as_array().unwrap().len(), 2);
    // `resolved:false` is omitted on the wire (serde skip); absent means open.
    assert_ne!(threads[1]["resolved"], json!(true));
    // Resolve is journaled; equal writes stay silent.
    let resolved = call(
        &mut e,
        "setCommentResolved",
        json!({"id":"c-1","resolved":true}),
    );
    assert!(!resolved.events.is_empty());
    let snap = e.snapshot().unwrap();
    let noop = call(
        &mut e,
        "setCommentResolved",
        json!({"id":"c-1","resolved":true}),
    );
    assert!(noop.events.is_empty());
    assert_eq!(e.snapshot().unwrap(), snap);
    // Undo restores open state; redo re-resolves; thread removal cascades
    // replies inside the same journal entry.
    assert!(e.undo().unwrap());
    let threads = call(&mut e, "listComments", json!({})).data;
    assert_ne!(threads["threads"][1]["resolved"], json!(true));
    assert!(e.redo().unwrap());
    assert!(e.undo().unwrap());
    assert!(e.undo().unwrap());
    call(&mut e, "removeCommentThread", json!({"id":"c-1"}));
    let threads = call(&mut e, "listComments", json!({})).data;
    assert_eq!(threads["threads"].as_array().unwrap().len(), 1);
    assert!(e
        .apply(Command::new("removeCommentThread", json!({"id":"c-1"})))
        .is_err());
}
#[test]
fn comments_validate_atomically_and_bounds_hold() {
    let mut e = DesignEngine::new();
    let snap = e.snapshot().unwrap();
    // Unknown fields, bad anchors and oversized bodies reject atomically.
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"anchor":{"x":0.,"y":0.},"body":"x","bogus":1}),
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"anchor":{"x":2e6,"y":0.},"body":"x"}),
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"anchor":{"x":0.,"y":0.},"body":""}),
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"anchor":{"x":0.,"y":0.},"body":"bad\u{7}char"}),
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "addCommentReply",
            json!({"thread":"nope","body":"x"}),
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), snap);
    // Duplicate ids and over-long ids reject.
    comment_thread(&mut e, "c-1", 0., 0.);
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"id":"c-1","anchor":{"x":0.,"y":0.},"body":"dup"}),
        ))
        .is_err());
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"id":"x".repeat(300),"anchor":{"x":0.,"y":0.},"body":"long"}),
        ))
        .is_err());
    // Thread cap: fill to 1024 then the next define rejects.
    for i in 2..=1024 {
        comment_thread(&mut e, &format!("cap-{i}"), 0., 0.);
    }
    assert!(e
        .apply(Command::new(
            "defineCommentThread",
            json!({"anchor":{"x":0.,"y":0.},"body":"over"}),
        ))
        .is_err());
}
#[test]
fn comments_snapshot_wrapper_round_trip_and_hostile_restore() {
    let mut e = DesignEngine::new();
    comment_thread(&mut e, "c-1", 12.5, -3.);
    call(
        &mut e,
        "addCommentReply",
        json!({"thread":"c-1","body":"reply","time_label":"now"}),
    );
    call(
        &mut e,
        "setCommentResolved",
        json!({"id":"c-1","resolved":true}),
    );
    let bytes = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bytes).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(outer["kind"], "design");
    assert_eq!(outer["schema"], 2);
    assert_eq!(
        outer["document"]["comments"]["threads"][0]["resolved"],
        true
    );
    // Byte-identical reopen.
    let mut e2 = DesignEngine::new();
    e2.restore(&bytes).unwrap();
    assert_eq!(e2.snapshot().unwrap(), bytes);
    let threads = call(&mut e2, "listComments", json!({})).data;
    assert_eq!(
        threads["threads"][0]["replies"].as_array().unwrap().len(),
        1
    );
    // Removing the last thread returns snapshots to bare schema:1.
    e2.apply(Command::new("removeCommentThread", json!({"id":"c-1"})))
        .unwrap();
    let bare = e2.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bare).unwrap();
    let outer: Value = serde_json::from_slice(&raw).unwrap();
    assert!(outer.get("document").is_none());
    assert!(outer.get("comments").is_none());
    // Hostile restore: unwrapped state carrying comments rejects.
    let doc = serde_json::to_vec(&e.state).unwrap();
    assert!(DesignEngine::new().restore(&encode_envelope(&doc)).is_err());
    // Hostile restore: duplicate thread ids reject.
    let mut tampered: Value = outer_doc_with_comments(&e);
    let t = tampered["document"]["comments"]["threads"]
        .as_array_mut()
        .unwrap();
    t.push(t[0].clone());
    assert!(e2
        .restore(&encode_envelope(&serde_json::to_vec(&tampered).unwrap()))
        .is_err());
    // Hostile restore: out-of-bounds anchor rejects.
    let mut tampered = outer_doc_with_comments(&e);
    tampered["document"]["comments"]["threads"][0]["anchor"]["x"] = json!(2e6);
    assert!(e2
        .restore(&encode_envelope(&serde_json::to_vec(&tampered).unwrap()))
        .is_err());
    // Hostile restore: oversized body rejects.
    let mut tampered = outer_doc_with_comments(&e);
    tampered["document"]["comments"]["threads"][0]["body"] = json!("x".repeat(70 * 1024));
    assert!(e2
        .restore(&encode_envelope(&serde_json::to_vec(&tampered).unwrap()))
        .is_err());
    assert_eq!(e2.snapshot().unwrap(), bare);
}
fn outer_doc_with_comments(e: &DesignEngine) -> Value {
    let bytes = e.snapshot().unwrap();
    let (_, raw) = decode_envelope(&bytes).unwrap();
    serde_json::from_slice(&raw).unwrap()
}


// --- Slice F: describeHandoff + exportSlice + state_revision ---

fn handoff(e: &mut DesignEngine) -> Value {
    call(e, "describeHandoff", json!({})).data
}
fn export(e: &mut DesignEngine, node: u64, scale: Option<f64>) -> CommandResult {
    let mut p = json!({"node": node});
    if let Some(s) = scale {
        p["scale"] = json!(s);
    }
    e.apply(Command::new("exportSlice", p)).unwrap()
}
#[test]
fn handoff_is_deterministic_bounded_and_eventless_with_revision_tag() {
    let mut e = DesignEngine::new();
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Card","x":10,"y":20,"width":200,"height":100,"fill":[10,20,30,255]}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let text = call(
        &mut e,
        "addText",
        json!({"parent":frame,"name":"Title","content":"Hello handoff","style":{"font_size":24,"font_weight":700}}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let rect = shape(&mut e, frame, 0., 0., 50., 50., [1, 2, 3, 255]);
    let before = e.snapshot().unwrap();
    let h1 = call(&mut e, "describeHandoff", json!({}));
    assert!(h1.events.is_empty(), "handoff read must be eventless");
    let h2 = call(&mut e, "describeHandoff", json!({}));
    assert_eq!(h1.data, h2.data, "handoff must be deterministic");
    assert_eq!(e.snapshot().unwrap(), before, "handoff must not mutate");
    let d = &h1.data;
    assert_eq!(d["state_revision"], json!(3)); // new + addFrame + addText + addShape... see below
    assert_eq!(d["units"], "document");
    assert_eq!(d["canvas"]["width"], json!(640.0));
    assert_eq!(d["assets"], json!([]));
    assert!(d["deferred"].as_array().unwrap().len() >= 3);
    // Nodes follow stored DFS order: root, frame, its children.
    let nodes = d["nodes"].as_array().unwrap();
    assert_eq!(nodes[0]["id"], json!(1));
    assert_eq!(nodes[1]["id"], json!(frame));
    let kinds: Vec<&str> = nodes.iter().map(|n| n["kind"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"text") && kinds.contains(&"rect") && kinds.contains(&"frame"));
    let tn = nodes.iter().find(|n| n["id"] == text).unwrap();
    assert_eq!(tn["text"]["font_size"], json!(24.0));
    assert_eq!(tn["text"]["content"], json!("Hello handoff"));
    assert_eq!(tn["text"]["content_truncated"], json!(false));
    // Measurements mirror evaluateLayout boxes.
    let eval = call(&mut e, "evaluateLayout", json!({}));
    assert_eq!(
        d["measurements"]["boxes"].as_array().unwrap().len(),
        eval.data["boxes"].as_array().unwrap().len()
    );
    assert_eq!(d["measurements"]["total"], eval.data["boxes"].as_array().unwrap().len());
    assert_eq!(d["measurements"]["truncated"], json!(false));
    // Typography carries the text node with its evaluated box.
    let typo = d["typography"].as_array().unwrap();
    assert_eq!(typo.len(), 1);
    assert_eq!(typo[0]["node"], json!(text));
    assert_eq!(typo[0]["text"]["font_weight"], json!(700));
    // Snippets are tagged with state_revision and deterministic.
    let snippets = d["snippets"].as_array().unwrap();
    assert_eq!(snippets.len() as u64, d["snippets_total"].as_u64().unwrap());
    assert!(snippets.iter().all(|s| s["state_revision"] == d["state_revision"]));
    let frame_snip = snippets.iter().find(|s| s["node"] == frame).unwrap();
    assert!(frame_snip["hint"].as_str().unwrap().contains("frame \"Card\""));
    let text_snip = snippets.iter().find(|s| s["node"] == text).unwrap();
    assert!(text_snip["hint"].as_str().unwrap().contains("Hello handoff"));
    // A registered screen surfaces with its evaluated box.
    call(&mut e, "definePrototypeScreen", json!({"node":frame,"entry":true}));
    let d2 = handoff(&mut e);
    assert_eq!(d2["screens"].as_array().unwrap().len(), 1);
    assert_eq!(d2["screens"][0]["node"], json!(frame));
    assert_eq!(d2["screens"][0]["entry"], json!(true));
    assert!(d2["screens"][0]["box"]["width"].is_number());
    // Reads never touch the journal: undo still removes the screen def.
    assert!(e.undo().unwrap());
    assert!(e.state.prototype.screens.is_empty());
    let _ = rect;
}
#[test]
fn state_revision_advances_on_mutation_batch_undo_redo_and_restore() {
    let mut e = DesignEngine::new();
    assert_eq!(handoff(&mut e)["state_revision"], json!(0));
    shape(&mut e, 1, 0., 0., 10., 10., [0, 0, 0, 255]);
    assert_eq!(handoff(&mut e)["state_revision"], json!(1));
    // A no-op mutation does not advance the revision.
    call(&mut e, "updateNode", json!({"id":2,"name":"same-name-check"}));
    let rev_after_rename = handoff(&mut e)["state_revision"].as_u64().unwrap();
    call(&mut e, "updateNode", json!({"id":2,"name":"same-name-check"}));
    assert_eq!(
        handoff(&mut e)["state_revision"].as_u64().unwrap(),
        rev_after_rename,
        "net-unchanged ops must not bump state_revision"
    );
    // Batch commits count as one revision regardless of step count.
    e.apply(Command::new(
        ignition_core::OP_BATCH,
        json!({"commands":[
            {"op":"addShape","payload":{"parent":1,"kind":"rect","x":0,"y":0,"width":5,"height":5}},
            {"op":"addShape","payload":{"parent":1,"kind":"ellipse","x":0,"y":0,"width":5,"height":5}},
        ]}),
    ))
    .unwrap();
    let batch_rev = handoff(&mut e)["state_revision"].as_u64().unwrap();
    assert_eq!(batch_rev, rev_after_rename + 1);
    assert!(e.undo().unwrap());
    assert_eq!(
        handoff(&mut e)["state_revision"].as_u64().unwrap(),
        batch_rev + 1,
        "undo advances the revision"
    );
    assert!(e.redo().unwrap());
    assert_eq!(
        handoff(&mut e)["state_revision"].as_u64().unwrap(),
        batch_rev + 2,
        "redo advances the revision"
    );
    // Restore advances the revision; the counter is engine-side so a
    // snapshot cannot smuggle an arbitrary value.
    let bytes = e.snapshot().unwrap();
    let mut e2 = DesignEngine::new();
    e2.restore(&bytes).unwrap();
    assert_eq!(handoff(&mut e2)["state_revision"], json!(1));
    e2.restore(&bytes).unwrap();
    assert_eq!(handoff(&mut e2)["state_revision"], json!(2));
}
#[test]
fn export_slice_renders_rgba_manifest_and_stays_eventless() {
    let mut e = DesignEngine::new();
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Slice","x":10,"y":10,"width":8,"height":6,"fill":[200,100,50,255]}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let child = shape(&mut e, frame, 1., 1., 2., 2., [0, 255, 0, 255]);
    let sibling = shape(&mut e, 1, 100., 100., 4., 4., [255, 0, 0, 255]);
    let before = e.snapshot().unwrap();
    let r = export(&mut e, frame, None);
    assert!(r.events.is_empty(), "exportSlice must be eventless");
    assert_eq!(e.snapshot().unwrap(), before, "exportSlice must not mutate");
    assert_eq!(r.data["slice"]["width"], json!(8));
    assert_eq!(r.data["slice"]["height"], json!(6));
    assert_eq!(r.data["slice"]["scale"], json!(1.0));
    assert_eq!(r.data["slice"]["format"], "rgba8");
    let px = r.data["pixels_b64"].as_str().unwrap();
    let bytes = ignition_core::base64_decode(px).unwrap();
    assert_eq!(bytes.len(), 8 * 6 * 4);
    // Frame fill covers the whole slice; the child rect is inside it.
    assert_eq!(&bytes[0..4], &[200, 100, 50, 255]);
    // Manifest nodes are slice-relative and subtree-scoped.
    let m = &r.data["manifest"];
    assert_eq!(m["pixel_format"], "rgba8");
    assert_eq!(m["nodes_total"], m["nodes"].as_array().unwrap().len());
    assert_eq!(m["nodes_truncated"], json!(false));
    let ids: Vec<u64> = m["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, vec![frame, child], "sibling outside the slice subtree must not appear");
    let c = &m["nodes"][1];
    assert_eq!(c["x"], json!(1.0));
    assert_eq!(c["y"], json!(1.0));
    assert_eq!(c["parent"], json!(frame));
    assert_eq!(c["depth"], json!(1));
    // Scale multiplies pixels and stays inside the budget.
    let r2 = export(&mut e, frame, Some(2.0));
    assert_eq!(r2.data["slice"]["width"], json!(16));
    assert_eq!(r2.data["slice"]["height"], json!(12));
    assert_eq!(
        ignition_core::base64_decode(r2.data["pixels_b64"].as_str().unwrap()).unwrap().len(),
        16 * 12 * 4
    );
    // Binary-output commands receive raw bytes on the output sidecar.
    let cmd = Command::new("exportSlice", json!({"node": frame})).with_binary(None);
    let rb = e.apply(cmd).unwrap();
    assert!(rb.output.is_some());
    assert_eq!(rb.output.as_ref().unwrap().len(), 8 * 6 * 4);
    assert!(rb.data.get("pixels_b64").is_none());
    // Prototype screens are frame/component nodes: exporting a registered
    // screen id is the same call.
    call(&mut e, "definePrototypeScreen", json!({"node":frame}));
    let rs = export(&mut e, frame, None);
    assert_eq!(rs.data["manifest"]["nodes_total"], json!(2));
    let _ = sibling;
}
#[test]
fn export_slice_rejects_bad_targets_scale_and_payloads_atomically() {
    let mut e = DesignEngine::new();
    let rect = shape(&mut e, 1, 0., 0., 10., 10., [0, 0, 0, 255]);
    let text = call(
        &mut e,
        "addText",
        json!({"parent":1,"content":"hi"}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let before = e.snapshot().unwrap();
    for bad in [
        json!({"node":999}),
        json!({"node":rect}),       // rect is not a frame/component
        json!({"node":text}),       // text is not a frame/component
        json!({"node":1,"scale":0.1}),
        json!({"node":1,"scale":5.0}),
        json!({"node":1,"scale":"2"}),
        json!({"node":1,"extra":true}),
        json!({}),
    ] {
        assert!(
            e.apply(Command::new("exportSlice", bad.clone())).is_err(),
            "exportSlice must reject {bad}"
        );
    }
    assert_eq!(e.snapshot().unwrap(), before, "rejections must be atomic");
    // Oversized slice: shrink is impossible, so a huge authored child frame
    // at scale 4 must fail the pixel budget honestly.
    let big = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"x":0,"y":0,"width":2000.,"height":2000.}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    let snap = e.snapshot().unwrap();
    // 2000*4=8000px per side → 64M px > 1_048_576 budget → apply errors.
    assert!(e
        .apply(Command::new("exportSlice", json!({"node":big,"scale":4.0})))
        .is_err());
    // At scale 0.25 it fits: 500x500 = 250_000 px.
    let ok = e
        .apply(Command::new("exportSlice", json!({"node":big,"scale":0.25})))
        .unwrap();
    assert_eq!(ok.data["slice"]["width"], json!(500));
    assert_eq!(e.snapshot().unwrap(), snap);
}
#[test]
fn handoff_covers_instances_variables_and_prototype_state() {
    let mut e = DesignEngine::new();
    // Component with a variant + instance exercises expansion provenance.
    let comp = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Btn","width":80,"height":40,"fill":[9,9,9,255]}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, comp, 0., 0., 80., 40., [9, 9, 9, 255]);
    call(
        &mut e,
        "createComponent",
        json!({"id":comp,"variants":[{"name":"primary","properties":[{"node":comp,"path":"fill","value":[1,2,3,255]}]}]}),
    );
    let inst = call(
        &mut e,
        "createInstance",
        json!({"component":comp,"x":5,"y":5,"variant":"primary"}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    call(&mut e, "defineMode", json!({"id":"dark","name":"Dark"}));
    call(
        &mut e,
        "defineVariable",
        json!({"id":"gap","name":"Gap","type":"number","values":{"dark":{"kind":"number","value":12}}}),
    );
    call(
        &mut e,
        "bindVariable",
        json!({"node_id":1,"path":"fill_r","variable_id":"gap"}),
    );
    let d = handoff(&mut e);
    // Instance node reports its spec; expanded clone ids appear only in
    // measurements (synthetic >= 2^53), never in stored `nodes`.
    let inst_entry = d["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == inst)
        .unwrap();
    assert_eq!(inst_entry["instance"]["component"], json!(comp));
    assert_eq!(inst_entry["instance"]["variant"], json!("primary"));
    assert!(d["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|n| n["id"].as_u64().unwrap() < 9_007_199_254_740_991));
    // exportSlice on the component subtree includes the expanded render.
    let r = export(&mut e, comp, None);
    assert!(r.data["manifest"]["nodes_total"].as_u64().unwrap() >= 2);
}
#[test]
fn export_slice_clips_oversized_members_and_culls_out_of_slice_boxes() {
    let mut e = DesignEngine::new();
    // Small slice; members use local coords relative to the frame origin.
    let frame = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Slice","x":100,"y":100,"width":8,"height":8,"fill":[200,100,50,255]}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    // Huge rect covering the whole slice: at scale 4 its translated/scaled
    // w/h = 12e6 exceed Prism's 1e7 coordinate bound. It must be clamped to
    // the canvas intersection — pixel-identical — not rejected.
    shape(&mut e, frame, -50., -50., 3_000_000., 3_000_000., [0, 255, 0, 255]);
    // Member fully outside the slice is culled before reaching Prism.
    shape(&mut e, frame, 900_000., 0., 10., 10., [255, 0, 0, 255]);
    let r = export(&mut e, frame, Some(4.0));
    assert_eq!(r.data["slice"]["width"], json!(32));
    let bytes = ignition_core::base64_decode(r.data["pixels_b64"].as_str().unwrap()).unwrap();
    assert_eq!(bytes.len(), 32 * 32 * 4);
    // The covering rect paints every pixel over the frame fill.
    assert!(
        bytes.chunks_exact(4).all(|p| p == [0, 255, 0, 255]),
        "clamped oversized rect must cover the whole slice canvas"
    );
    // A canvas-covering oversized ellipse has no exact Prism shape either,
    // but full coverage makes a canvas rect pixel-identical.
    let frame2 = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Slice2","x":200,"y":200,"width":8,"height":8}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    call(
        &mut e,
        "addShape",
        json!({"parent":frame2,"kind":"ellipse","x":-999_999.,"y":-999_999.,"width":3_000_000.,"height":3_000_000.,"fill":[0,0,255,255]}),
    );
    let r2 = export(&mut e, frame2, Some(4.0));
    let bytes2 = ignition_core::base64_decode(r2.data["pixels_b64"].as_str().unwrap()).unwrap();
    assert!(
        bytes2.chunks_exact(4).all(|p| p == [0, 0, 255, 255]),
        "canvas-covering oversized ellipse must rasterize as a full canvas rect"
    );
    // A partially visible oversized ellipse cannot be represented exactly
    // inside Prism's coordinate bound and must reject honestly.
    let frame3 = call(
        &mut e,
        "addFrame",
        json!({"parent":1,"name":"Slice3","x":300,"y":300,"width":8,"height":8}),
    )
    .data["node_id"]
        .as_u64()
        .unwrap();
    // Wide flat ellipse: scaled w = 12e6 overflows, and its vertical band
    // covers only the bottom half of the slice canvas.
    call(
        &mut e,
        "addShape",
        json!({"parent":frame3,"kind":"ellipse","x":-999_999.,"y":4.,"width":3_000_000.,"height":200.,"fill":[255,0,0,255]}),
    );
    let err = e
        .apply(Command::new("exportSlice", json!({"node": frame3, "scale": 4.0})))
        .unwrap_err();
    assert!(
        err.message.contains("coordinate budget"),
        "unexpected error: {}",
        err.message
    );
}
