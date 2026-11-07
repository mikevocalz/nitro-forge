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
    // Storage only: evaluated boxes keep authored x/y.
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (1., 1.));
    // Repeating the same write is a silent no-op.
    assert!(call(
        &mut e,
        "setConstraints",
        json!({"id":rect,"constraints":{"horizontal":"left","vertical":"top","relative_to":1}})
    )
    .events
    .is_empty());
    // readConstraints is silent and reports storage-only enforcement.
    let read = call(&mut e, "readConstraints", json!({}));
    assert!(read.events.is_empty());
    assert_eq!(read.data["solving"], "storage-only");
    assert_eq!(read.data["accepted"]["horizontal"], json!(["left","right","center","stretch"]));
    assert_eq!(read.data["nodes"].as_array().unwrap().len(), 1);
    assert_eq!(read.data["nodes"][0]["node_id"], rect);
    assert_eq!(read.data["nodes"][0]["enforced"], false);
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
    // Storage only: evaluated boxes keep authored x/y.
    let boxes = layout::evaluate(&e.state).unwrap();
    assert_eq!((boxes[1].x, boxes[1].y), (1., 1.));
    // readConstraints echoes the stored C2 fields and stays silent.
    let read = call(&mut e, "readConstraints", json!({"id":rect}));
    assert!(read.events.is_empty());
    assert_eq!(read.data["solving"], "storage-only");
    assert_eq!(read.data["nodes"][0]["enforced"], false);
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
