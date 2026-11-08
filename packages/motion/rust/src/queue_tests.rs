use super::*;
fn call(e: &mut MotionEngine, op: &str, p: Value) -> CommandResult {
    e.apply(Command::new(op, p)).unwrap()
}
fn try_call(e: &mut MotionEngine, op: &str, p: Value) -> Result<CommandResult, EngineError> {
    e.apply(Command::new(op, p))
}
fn shape(e: &mut MotionEngine, comp: Option<u64>) -> u64 {
    let mut p = json!({"shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1,"fill":[255,0,0,255]}});
    if let Some(c) = comp {
        p["comp"] = json!(c);
    }
    call(e, "addShapeLayer", p).data["layer_id"]
        .as_u64()
        .unwrap()
}
fn job(e: &mut MotionEngine, p: Value) -> u64 {
    call(e, "addRenderJob", p).data["job_id"].as_u64().unwrap()
}
fn step(e: &mut MotionEngine, p: Value) -> CommandResult {
    e.apply(Command::new("renderQueueFrame", p).with_binary(None))
        .unwrap()
}
fn pixels(e: &mut MotionEngine, t: f64) -> Vec<u8> {
    e.apply(Command::new("renderFrame", json!({"time_s":t})).with_binary(None))
        .unwrap()
        .output
        .unwrap()
}
fn queue(e: &MotionEngine) -> Vec<RenderJob> {
    serde_json::from_value(serde_json::to_value(&*e.state).unwrap()["render_queue"].clone())
        .unwrap_or_default()
}

#[test]
fn enqueue_reorder_cancel_remove_and_describe_report_real_state() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":2,"height":1,"duration_s":1,"frame_rate":{"num":2,"den":1}}),
    );
    let a = job(&mut e, json!({"name":"A","from_frame":0,"to_frame":1}));
    let b = job(&mut e, json!({"name":"B","from_frame":0,"to_frame":0}));
    assert_eq!(a, 1);
    assert_eq!(b, 2);
    let described = call(&mut e, "describe", json!({})).data;
    assert_eq!(described["next_job_id"], json!(3));
    assert_eq!(described["render_queue"].as_array().unwrap().len(), 2);
    assert_eq!(described["render_queue"][0]["status"], json!("pending"));
    // Exact permutation reorder; partial/duplicate/foreign orders reject.
    call(&mut e, "setRenderQueueOrder", json!({"order":[b,a]}));
    assert_eq!(
        queue(&e).iter().map(|j| j.id).collect::<Vec<_>>(),
        vec![b, a]
    );
    let before = e.snapshot().unwrap();
    for bad_order in [json!([a]), json!([a, a]), json!([a, 99])] {
        assert!(try_call(&mut e, "setRenderQueueOrder", json!({"order":bad_order})).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    // Cancel only pending jobs; stepping order follows the reordered list.
    call(&mut e, "cancelRenderJob", json!({"job":b}));
    assert!(try_call(&mut e, "cancelRenderJob", json!({"job":b})).is_err());
    let r = step(&mut e, json!({}));
    assert_eq!(r.data["job_id"], json!(a));
    assert_eq!(r.data["frame"], json!(0));
    assert_eq!(r.data["queue"]["pending"], json!(1));
    assert_eq!(r.data["queue"]["cancelled"], json!(1));
    call(&mut e, "removeRenderJob", json!({"job":b}));
    assert!(try_call(&mut e, "removeRenderJob", json!({"job":b})).is_err());
    assert!(try_call(&mut e, "cancelRenderJob", json!({"job":99})).is_err());
}

#[test]
fn stepping_renders_real_frames_and_completes_jobs() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":2,"height":1,"duration_s":1,"frame_rate":{"num":2,"den":1}}),
    );
    let id = shape(&mut e, None);
    // Move the rect right over time so frames differ: tx 0→1 linear over 1s.
    call(
        &mut e,
        "setPropertyKeys",
        json!({"layer":id,"property":"tx","keys":[
            {"time":0,"value":0,"interpolation":"linear","in_handle":null,"out_handle":null},
            {"time":1,"value":1,"interpolation":"linear","in_handle":null,"out_handle":null}
        ]}),
    );
    let j = job(&mut e, json!({"from_frame":0,"to_frame":2}));
    // 2fps: frames 0,1,2 map to t=0,0.5,1.0 — identical to renderFrame output.
    for (i, t) in [0., 0.5, 1.].iter().enumerate() {
        let r = step(&mut e, json!({}));
        assert_eq!(r.data["job_id"], json!(j));
        assert_eq!(r.data["frame"], json!(i as u64));
        assert_eq!(r.data["frames_done"], json!(i as u64 + 1));
        assert_eq!(r.data["frames_total"], json!(3));
        assert_eq!(
            r.data["status"],
            json!(if i == 2 { "done" } else { "pending" })
        );
        assert_eq!(r.data["width"], json!(2));
        assert_eq!(r.data["height"], json!(1));
        assert_eq!(r.output.clone().unwrap(), pixels(&mut e, *t));
        assert_eq!(r.output.as_ref().unwrap().len(), 2 * 1 * 4);
        // Each step is a real mutation: one document:changed event.
        assert_eq!(r.events.len(), 1);
        assert_eq!(r.events[0].kind, "document:changed");
    }
    // Queue drained: stepping errors without touching state.
    let settled = e.snapshot().unwrap();
    assert!(try_call(&mut e, "renderQueueFrame", json!({})).is_err());
    assert!(try_call(&mut e, "renderQueueFrame", json!({"job":j})).is_err());
    assert_eq!(e.snapshot().unwrap(), settled);
    // JSON path (no binary sidecar) still carries pixels_b64.
    let j2 = job(&mut e, json!({"from_frame":0,"to_frame":0}));
    let r = call(&mut e, "renderQueueFrame", json!({"job":j2}));
    assert!(r.output.is_none());
    assert!(r.data["pixels_b64"].is_string());
    assert_eq!(r.data["queue"]["pending_frames"], json!(0));
}

#[test]
fn explicit_job_stepping_and_queue_summary_are_exact() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":1,"height":1,"duration_s":4,"frame_rate":{"num":1,"den":1}}),
    );
    shape(&mut e, None);
    let first = job(&mut e, json!({"from_frame":0,"to_frame":1}));
    let second = job(&mut e, json!({"from_frame":0,"to_frame":3}));
    // Stepping a named later job does not require draining the first.
    let r = step(&mut e, json!({"job":second}));
    assert_eq!(r.data["job_id"], json!(second));
    assert_eq!(r.data["queue"]["pending"], json!(2));
    // Remaining frames only: first has 2, second has 3 after one step.
    assert_eq!(r.data["queue"]["pending_frames"], json!(5));
    let r = step(&mut e, json!({"job":first}));
    assert_eq!(r.data["job_id"], json!(first));
    // Cancelled mid-progress keeps frames_done; done jobs cannot step.
    call(&mut e, "cancelRenderJob", json!({"job":second}));
    let q = queue(&e);
    assert_eq!(q[1].status, JobStatus::Cancelled);
    assert_eq!(q[1].frames_done, 1);
    assert!(try_call(&mut e, "renderQueueFrame", json!({"job":second})).is_err());
}

#[test]
fn comp_jobs_render_standalone_and_removal_is_guarded() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":4,"height":4,"duration_s":1}));
    let cid = call(
        &mut e,
        "addComposition",
        json!({"width":2,"height":2,"duration_s":1}),
    )
    .data["comp_id"]
        .as_u64()
        .unwrap();
    shape(&mut e, Some(cid));
    let j = job(&mut e, json!({"comp":cid,"from_frame":0,"to_frame":0}));
    let r = step(&mut e, json!({"job":j}));
    assert_eq!(r.data["width"], json!(2));
    assert_eq!(r.data["height"], json!(2));
    assert_eq!(r.data["comp_id"], json!(cid));
    assert_eq!(r.output.unwrap().len(), 2 * 2 * 4);
    // removeComposition rejects while ANY job (even done/cancelled history)
    // references the comp; removing the job releases it.
    assert!(try_call(&mut e, "removeComposition", json!({"id":cid})).is_err());
    call(&mut e, "removeRenderJob", json!({"job":j}));
    call(&mut e, "removeComposition", json!({"id":cid}));
    // Unknown comp at enqueue rejects atomically.
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "addRenderJob",
        json!({"comp":77,"from_frame":0,"to_frame":0})
    )
    .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn undo_redo_snapshot_and_restore_round_trip_queue_state() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":1,"height":1,"duration_s":1,"frame_rate":{"num":2,"den":1}}),
    );
    shape(&mut e, None);
    job(&mut e, json!({"from_frame":0,"to_frame":2}));
    step(&mut e, json!({}));
    let mid = e.snapshot().unwrap();
    step(&mut e, json!({}));
    // Each stepped frame is one journal entry: undo rewinds real progress.
    assert!(e.undo().unwrap());
    assert_eq!(e.snapshot().unwrap(), mid);
    assert!(e.redo().unwrap());
    assert_ne!(e.snapshot().unwrap(), mid);
    let bytes = e.snapshot().unwrap();
    let mut reopened = MotionEngine::new();
    reopened.restore(&bytes).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), bytes);
    assert_eq!(queue(&reopened)[0].frames_done, 2);
    // Enqueue/step mutations journal like everything else on the live engine:
    // each undo rewinds one real frame of progress, then the job itself.
    assert!(e.undo().unwrap());
    assert_eq!(queue(&e)[0].frames_done, 1);
    assert!(e.undo().unwrap());
    assert_eq!(queue(&e)[0].frames_done, 0);
    assert!(e.undo().unwrap());
    assert!(queue(&e).is_empty());
    // restore() resets history, so the reopened engine has nothing to undo.
    assert!(!reopened.undo().unwrap());
    // Hostile restore: unknown status fails serde; every bound re-checks.
    let mut hostile = serde_json::to_value(&*reopened.state).unwrap();
    hostile["render_queue"][0]["status"] = json!("rendering");
    assert!(reopened
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    let mut hostile = serde_json::to_value(&*reopened.state).unwrap();
    hostile["render_queue"][0]["frames_done"] = json!(3);
    assert!(reopened
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    let mut hostile = serde_json::to_value(&*reopened.state).unwrap();
    hostile["render_queue"][0]["comp_id"] = json!(42);
    assert!(reopened
        .restore(&encode_envelope(&serde_json::to_vec(&hostile).unwrap()))
        .is_err());
    assert_eq!(reopened.snapshot().unwrap(), reopened.snapshot().unwrap());
}

#[test]
fn hostile_restore_rejects_queue_bounds_and_inconsistent_progress() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
    let baseline = e.snapshot().unwrap();
    job(&mut e, json!({"from_frame":0,"to_frame":5}));
    let good = e.snapshot().unwrap();
    let cases: Vec<(&str, Value)> = vec![
        ("dup ids", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            let j = s["render_queue"][0].clone();
            s["render_queue"].as_array_mut().unwrap().push(j);
            s
        }),
        ("progress past end", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["frames_done"] = json!(7);
            s["render_queue"][0]["status"] = json!("done");
            s
        }),
        ("done without progress", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["status"] = json!("done");
            s
        }),
        ("pending fully done", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["frames_done"] = json!(6);
            s
        }),
        ("inverted range", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["from_frame"] = json!(9);
            s
        }),
        ("frames beyond duration", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            // 30fps default: frame 400 -> ~13.3s > 1s duration.
            s["render_queue"][0]["to_frame"] = json!(400);
            s
        }),
        ("unknown field", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["encoder"] = json!("h264");
            s
        }),
        ("zero job id", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["render_queue"][0]["id"] = json!(0);
            s
        }),
        ("next_job_id zero", {
            let mut s = serde_json::to_value(&*e.state).unwrap();
            s["next_job_id"] = json!(0);
            s
        }),
    ];
    for (name, state) in cases {
        assert!(
            e.restore(&encode_envelope(&serde_json::to_vec(&state).unwrap()))
                .is_err(),
            "hostile restore accepted: {name}"
        );
        assert_eq!(e.snapshot().unwrap(), good, "state changed by {name}");
    }
    // Job-count and span budgets via crafted state.
    let mut s = serde_json::to_value(&*e.state).unwrap();
    let template = s["render_queue"][0].clone();
    let mut jobs = vec![];
    for i in 0..=MAX_RENDER_JOBS {
        let mut j = template.clone();
        j["id"] = json!(i as u64 + 1);
        j["from_frame"] = json!(0);
        j["to_frame"] = json!(0);
        jobs.push(j);
    }
    s["render_queue"] = json!(jobs);
    s["next_job_id"] = json!(MAX_RENDER_JOBS as u64 + 2);
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&s).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), good);
    // Oversized single-job span.
    let mut s = serde_json::to_value(&*e.state).unwrap();
    s["render_queue"][0]["to_frame"] = json!(MAX_JOB_FRAMES);
    s["render_queue"][0]["frames_done"] = json!(0);
    // Pending job's last frame must fit duration: raise duration so only the
    // span budget can reject.
    s["duration_s"] = json!(604800.0);
    s["frame_rate"] = json!({"num":240,"den":1});
    assert!(e
        .restore(&encode_envelope(&serde_json::to_vec(&s).unwrap()))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), good);
    let _ = baseline;
}

#[test]
fn queue_frame_and_job_budgets_are_enforced_at_op_time() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":1,"height":1,"duration_s":604800,"frame_rate":{"num":240,"den":1}}),
    );
    shape(&mut e, None);
    // Per-job span: 4096 frames ok, 4097 rejects.
    job(&mut e, json!({"from_frame":0,"to_frame":4095}));
    let before = e.snapshot().unwrap();
    assert!(try_call(
        &mut e,
        "addRenderJob",
        json!({"from_frame":0,"to_frame":4096})
    )
    .is_err());
    assert!(try_call(&mut e, "addRenderJob", json!({"from_frame":5,"to_frame":3})).is_err());
    assert!(try_call(&mut e, "addRenderJob", json!({"from_frame":0})).is_err());
    // Total queue frames: 16384 cap — three more 4096-frame jobs fit (16384 total).
    for _ in 0..3 {
        job(&mut e, json!({"from_frame":0,"to_frame":4095}));
    }
    assert!(try_call(&mut e, "addRenderJob", json!({"from_frame":0,"to_frame":0})).is_err());
    // Job count cap: fill remaining slots with 1-frame jobs up to 256 total.
    // Currently 4 jobs; add 252 more (each 1 frame; total frames 16384+252>16384!
    // so shrink: remove the big jobs first).
    for j in queue(&e).iter().map(|j| j.id).collect::<Vec<_>>() {
        call(&mut e, "removeRenderJob", json!({"job":j}));
    }
    for _ in 0..256 {
        job(&mut e, json!({"from_frame":0,"to_frame":0}));
    }
    assert!(try_call(&mut e, "addRenderJob", json!({"from_frame":0,"to_frame":0})).is_err());
    assert_eq!(e.snapshot().unwrap(), e.snapshot().unwrap());
    let _ = before;
}

#[test]
fn set_composition_cannot_strand_pending_jobs_but_history_is_free() {
    let mut e = MotionEngine::new();
    call(
        &mut e,
        "new",
        json!({"width":1,"height":1,"duration_s":10,"frame_rate":{"num":30,"den":1}}),
    );
    shape(&mut e, None);
    // Frames 0..=299 map to t=0..9.967s at 30fps inside the 10s duration.
    let j = job(&mut e, json!({"from_frame":0,"to_frame":299}));
    // Shrinking root duration below the pending job's last frame rejects.
    assert!(try_call(&mut e, "setComposition", json!({"duration_s":9})).is_err());
    // Frame-rate change that pushes the last frame past duration also rejects.
    assert!(try_call(
        &mut e,
        "setComposition",
        json!({"frame_rate":{"num":10,"den":1}})
    )
    .is_err());
    // Cancelling frees the constraint (cancelled jobs are retained history).
    call(&mut e, "cancelRenderJob", json!({"job":j}));
    call(&mut e, "setComposition", json!({"duration_s":5}));
    // A done job likewise does not constrain duration.
    let k = job(&mut e, json!({"from_frame":0,"to_frame":0}));
    step(&mut e, json!({"job":k}));
    call(&mut e, "setComposition", json!({"duration_s":1}));
}

#[test]
fn queue_ops_compose_inside_atomic_batches() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
    shape(&mut e, None);
    let r = call(
        &mut e,
        ignition_core::OP_BATCH,
        json!({"commands":[
            {"op":"addRenderJob","payload":{"from_frame":0,"to_frame":0}},
            {"op":"renderQueueFrame","payload":{}}
        ]}),
    );
    assert_eq!(r.data["results"].as_array().unwrap().len(), 2);
    assert_eq!(queue(&e)[0].status, JobStatus::Done);
    // A failing batch step leaves queue untouched.
    let before = e.snapshot().unwrap();
    assert!(e
        .apply(Command::new(
            ignition_core::OP_BATCH,
            json!({"commands":[
                {"op":"addRenderJob","payload":{"from_frame":0,"to_frame":0}},
                {"op":"removeRenderJob","payload":{"job":999}}
            ]})
        ))
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
}

#[test]
fn cancelled_task_never_consumes_a_frame() {
    let mut e = MotionEngine::new();
    call(&mut e, "new", json!({"width":1,"height":1,"duration_s":1}));
    shape(&mut e, None);
    job(&mut e, json!({"from_frame":0,"to_frame":5}));
    let before = e.snapshot().unwrap();
    let ctx = TaskContext::new();
    ctx.cancel();
    assert!(e
        .apply_long(Command::new("renderQueueFrame", json!({})), &ctx)
        .is_err());
    assert_eq!(e.snapshot().unwrap(), before);
    // apply_long on a live context steps and journals identically.
    let ctx = TaskContext::new();
    let r = e
        .apply_long(Command::new("renderQueueFrame", json!({})), &ctx)
        .unwrap();
    assert_eq!(r.data["frames_done"], json!(1));
    assert_eq!(queue(&e)[0].frames_done, 1);
}
