//! World viewport is supplied per read, never stored as document geometry.
use crate::model::*;
use ignition_core::{Command, CommandResult, Engine, EngineError, TaskContext};
use serde::Deserialize;
use serde_json::json;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
    pub origin_x: f64,
    pub origin_y: f64,
    pub scale: f64,
}
pub fn render(
    s: &State,
    cmd: &Command,
    ctx: Option<&TaskContext>,
) -> Result<CommandResult, EngineError> {
    let view: Viewport = serde_json::from_value(cmd.payload.clone())?;
    if view.width == 0
        || view.height == 0
        || view.width > 4096
        || view.height > 4096
        || u64::from(view.width) * u64::from(view.height) > 1_048_576
        || !coord(view.origin_x)
        || !coord(view.origin_y)
        || !view.scale.is_finite()
        || !(1e-6..=1e4).contains(&view.scale)
    {
        return Err(bad("invalid bounded world viewport"));
    }
    let mut paths = Vec::new();
    for id in &s.order {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        let seg = s.segment(*id)?;
        if !seg.visible {
            continue;
        }
        let a = s.point(seg.a)?;
        let b = s.point(seg.b)?;
        let (x1, y1, x2, y2, width) = (
            (a.x - view.origin_x) * view.scale,
            (a.y - view.origin_y) * view.scale,
            (b.x - view.origin_x) * view.scale,
            (b.y - view.origin_y) * view.scale,
            seg.width * view.scale,
        );
        if ![x1, y1, x2, y2, width]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1e7)
            || width <= 0.
        {
            return Err(bad(
                "projected geometry exceeds Prism public coordinate/stroke limits",
            ));
        }
        if x1 == x2 && y1 == y2 {
            continue;
        }
        paths.push(json!({"path":{"subpaths":[{"closed":false,"nodes":[{"x":x1,"y":y1},{"x":x2,"y":y2}]}]},"stroke":{"paint":{"type":"solid","color":seg.color},"width":width,"cap":"butt"}}));
    }
    // Validate the entire projected scene before constructing Prism/output allocations.
    let mut prism = prism_engine::PrismEngine::new(view.width, view.height);
    for path in paths {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        prism.apply(Command::new("addPath", path))?;
    }
    if let Some(ctx) = ctx {
        ctx.checkpoint()?
    }
    let pixels = prism
        .apply(Command::new("flatten", json!({})).with_binary(None))?
        .output
        .ok_or_else(|| bad("Prism did not return RGBA"))?;
    if let Some(ctx) = ctx {
        ctx.checkpoint()?
    }
    Ok(
        CommandResult::read_only(json!({"width":view.width,"height":view.height})).with_bytes(
            cmd,
            "pixels_b64",
            pixels,
        ),
    )
}
