//! World viewport is supplied per read, never stored as document geometry.
//! `renderFrame` without `sheet_id` renders model space through the supplied
//! world viewport exactly as before; with `sheet_id` it renders the named
//! paper-space sheet: a white paper field, margin chrome, then each visible
//! viewport's model window composited from an offscreen Prism scene sized to
//! the viewport's pixel rectangle. The offscreen raster boundary is the
//! honest clip — Prism exposes no vector path-clip (`addMask` is a
//! canvas-space alpha buffer, `setClipped` clips a whole layer), so nothing
//! outside the viewport rectangle is ever rasterized rather than clipped
//! after the fact.
use crate::{circular, model::*};
use ignition_core::{Command, CommandResult, Engine, EngineError, TaskContext};
use serde::Deserialize;
use serde_json::json;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FramePayload {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub origin_x: Option<f64>,
    pub origin_y: Option<f64>,
    pub scale: Option<f64>,
    pub sheet_id: Option<u64>,
    pub dpi: Option<f64>,
}
/// Default and admitted print resolution for sheet rendering.
pub const DEFAULT_DPI: f64 = 96.;
/// Paper chrome stroke: 0.25 mm, clamped to at least one device pixel.
const CHROME_MM: f64 = 0.25;
fn chrome_px(ppm: f64) -> u32 {
    ((CHROME_MM * ppm).round() as u32).max(1)
}
/// Rasterize the full model scene (hatches, entities, dimensions) into a
/// `width`x`height` straight-RGBA buffer through an ephemeral Prism scene.
/// `(origin_x,origin_y,scale)` is the world→pixel transform shared by every
/// path builder; projected-coordinate checks reject unsupported extents
/// before compositor/output allocation.
fn rasterize(
    s: &State,
    width: u32,
    height: u32,
    origin_x: f64,
    origin_y: f64,
    scale: f64,
    ctx: Option<&TaskContext>,
) -> Result<Vec<u8>, EngineError> {
    let mut paths = crate::hatch::render(s, origin_x, origin_y, scale, ctx)?;
    let circular = circular::geometries(s);
    for id in &s.order {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        if let Some(seg) = s.segments.get(id) {
            if !seg.visible || !s.layer_visible(seg.layer) {
                continue;
            }
            let a = s.point(seg.a)?;
            let b = s.point(seg.b)?;
            let (x1, y1, x2, y2, width) = (
                (a.x - origin_x) * scale,
                (a.y - origin_y) * scale,
                (b.x - origin_x) * scale,
                (b.y - origin_y) * scale,
                seg.width * scale,
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
        } else {
            let Some(geometry) = circular.iter().find(|g| g.id == *id) else {
                continue;
            };
            let (color, width) = if let Some(c) = s.circles.get(id) {
                (c.color, c.width)
            } else {
                let a = s
                    .arcs
                    .get(id)
                    .ok_or_else(|| bad("ordered circular entity missing"))?;
                (a.color, a.width)
            };
            let width = width * scale;
            if !width.is_finite() || width <= 0. || width > 1e7 {
                return Err(bad("projected circular stroke exceeds Prism limit"));
            }
            let mut nodes = geometry.nodes();
            for node in &mut nodes {
                node.x = (node.x - origin_x) * scale;
                node.y = (node.y - origin_y) * scale;
                if ![node.x, node.y]
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 1e7)
                {
                    return Err(bad("projected circular coordinate exceeds Prism limit"));
                }
                for handle in [&mut node.incoming, &mut node.outgoing] {
                    if let Some(handle) = handle {
                        handle[0] *= scale;
                        handle[1] *= scale;
                        if ![handle[0], handle[1], node.x + handle[0], node.y + handle[1]]
                            .iter()
                            .all(|v| v.is_finite() && v.abs() <= 1e7)
                        {
                            return Err(bad("projected circular handle exceeds Prism limit"));
                        }
                    }
                }
            }
            paths.push(json!({"path":{"subpaths":[{"closed":geometry.closed,"nodes":nodes}]},"stroke":{"paint":{"type":"solid","color":color},"width":width,"cap":"butt"}}));
        }
    }
    // Dimension annotations composite above entity strokes; orphaned or
    // hidden dimensions emit nothing (see dimensions::render).
    paths.extend(crate::dimensions::render(
        s,
        origin_x,
        origin_y,
        scale,
        ctx,
    )?);
    // Validate the entire projected scene before constructing Prism/output allocations.
    let mut prism = prism_engine::PrismEngine::new(width, height);
    for path in paths {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        prism.apply(Command::new("addPath", path))?;
    }
    if let Some(ctx) = ctx {
        ctx.checkpoint()?
    }
    prism
        .apply(Command::new("flatten", json!({})).with_binary(None))?
        .output
        .ok_or_else(|| bad("Prism did not return RGBA"))
}
/// Source-over composite of a straight-RGBA sprite onto `dst` at integer
/// offset `(dx,dy)`; pixels outside `dst` are clipped by the canvas bounds.
fn composite_over(dst: &mut [u8], dw: u32, dh: u32, src: &[u8], sw: u32, sh: u32, dx: u32, dy: u32) {
    let (sw, sh) = (sw as usize, sh as usize);
    let (dw, dh) = (dw as usize, dh as usize);
    for y in 0..sh {
        let dy_row = dy as usize + y;
        if dy_row >= dh {
            break;
        }
        for x in 0..sw {
            let dx_col = dx as usize + x;
            if dx_col >= dw {
                break;
            }
            let si = (y * sw + x) * 4;
            let di = (dy_row * dw + dx_col) * 4;
            let sa = f64::from(src[si + 3]) / 255.;
            if sa <= 0. {
                continue;
            }
            let da = f64::from(dst[di + 3]) / 255.;
            let oa = sa + da * (1. - sa);
            if oa <= 0. {
                continue;
            }
            for c in 0..3 {
                dst[di + c] = ((f64::from(src[si + c]) * sa
                    + f64::from(dst[di + c]) * da * (1. - sa))
                    / oa)
                    .round()
                    .clamp(0., 255.) as u8;
            }
            dst[di + 3] = (oa * 255.).round().clamp(0., 255.) as u8;
        }
    }
}
/// Filled axis-aligned rectangle with source-over blending of `color`.
fn fill_rect(buf: &mut [u8], w: u32, h: u32, x0: u32, y0: u32, x1: u32, y1: u32, color: [u8; 4]) {
    let (w, h) = (w as usize, h as usize);
    let (x0, y0) = (x0 as usize, y0 as usize);
    let (x1, y1) = ((x1 as usize).min(w), (y1 as usize).min(h));
    for y in y0..y1 {
        for x in x0..x1 {
            let i = (y * w + x) * 4;
            let sa = f64::from(color[3]) / 255.;
            let da = f64::from(buf[i + 3]) / 255.;
            let oa = sa + da * (1. - sa);
            if oa <= 0. {
                continue;
            }
            for c in 0..3 {
                buf[i + c] = ((f64::from(color[c]) * sa
                    + f64::from(buf[i + c]) * da * (1. - sa))
                    / oa)
                    .round()
                    .clamp(0., 255.) as u8;
            }
            buf[i + 3] = (oa * 255.).round().clamp(0., 255.) as u8;
        }
    }
}
/// Rectangular border stroke of `thickness` device pixels, inset `inset`.
fn stroke_rect(
    buf: &mut [u8],
    w: u32,
    h: u32,
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
    thickness: u32,
    color: [u8; 4],
) {
    let t = thickness.max(1);
    fill_rect(buf, w, h, x0, y0, x1.min(x0 + t), y1, color);
    fill_rect(buf, w, h, x0, y1.saturating_sub(t), x1, y1, color);
    fill_rect(buf, w, h, x0, y0, x1, y0 + t, color);
    fill_rect(buf, w, h, x1.saturating_sub(t), y0, x1, y1, color);
}
fn sheet_pixels(
    s: &State,
    sheet_id: u64,
    dpi: f64,
    ctx: Option<&TaskContext>,
) -> Result<(u32, u32, Vec<u8>), EngineError> {
    let sheet = s
        .sheets
        .get(&sheet_id)
        .ok_or_else(|| bad("unknown sheet"))?;
    if !dpi.is_finite() || !(24.0..=600.0).contains(&dpi) {
        return Err(bad("sheet dpi outside admitted range"));
    }
    let ppm = dpi / 25.4;
    let px = |mm: f64| (mm * ppm).round();
    let (width, height) = (px(sheet.width), px(sheet.height));
    if width < 1.
        || height < 1.
        || width > 4096.
        || height > 4096.
        || width * height > 1_048_576.
    {
        return Err(bad("sheet pixel dimensions exceed render budget"));
    }
    let (width, height) = (width as u32, height as u32);
    // Paper renders as an opaque white field; margins and viewport borders
    // are fixed black chrome (title-block styling is deferred).
    // `vec![255u8; ..]` already yields an opaque white field per pixel.
    let mut buf = vec![255u8; width as usize * height as usize * 4];
    // Sheet coordinates are millimetres with +y up from the bottom-left;
    // pixel coordinates are +y down from the top-left.
    let margin = [
        px(sheet.margin_left),
        px(sheet.margin_top),
        px(sheet.width - sheet.margin_right),
        px(sheet.height - sheet.margin_bottom),
    ];
    let chrome = chrome_px(ppm);
    stroke_rect(
        &mut buf,
        width,
        height,
        margin[0] as u32,
        margin[1] as u32,
        margin[2] as u32,
        margin[3] as u32,
        chrome,
        [0, 0, 0, 255],
    );
    for vp in s.viewports.values() {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        if vp.sheet != sheet_id || !vp.visible {
            continue;
        }
        let (vx0, vy0) = (px(vp.x), px(sheet.height - vp.y - vp.height));
        let (vw, vh) = (px(vp.width).round() as i64, px(vp.height).round() as i64);
        // A sub-pixel viewport has no honest raster; it draws nothing rather
        // than being clamped into a distorted rectangle.
        if vw < 1 || vh < 1 {
            continue;
        }
        if vw > 4096 || vh > 4096 || vw * vh > 1_048_576 {
            return Err(bad("viewport pixel dimensions exceed render budget"));
        }
        let (vw, vh) = (vw as u32, vh as u32);
        // pixels/world-unit = paper-mm-per-unit * pixels-per-mm. The world
        // center lands on the viewport pixel center; expressed in the shared
        // (origin,scale) transform: pixel = (world - origin) * scale.
        let k = vp.scale * ppm;
        if !k.is_finite() || k <= 0. || k > 1e6 {
            return Err(bad("viewport scale exceeds render budget"));
        }
        let origin_x = vp.center_x - (vw as f64 / 2.) / k;
        let origin_y = vp.center_y - (vh as f64 / 2.) / k;
        let pixels = rasterize(s, vw, vh, origin_x, origin_y, k, ctx)?;
        composite_over(
            &mut buf,
            width,
            height,
            &pixels,
            vw,
            vh,
            vx0.round().max(0.) as u32,
            vy0.round().max(0.) as u32,
        );
        stroke_rect(
            &mut buf,
            width,
            height,
            vx0.round().max(0.) as u32,
            vy0.round().max(0.) as u32,
            (vx0 + vp.width * ppm).round().max(0.) as u32,
            (vy0 + vp.height * ppm).round().max(0.) as u32,
            chrome,
            [0, 0, 0, 255],
        );
    }
    Ok((width, height, buf))
}
pub fn render(
    s: &State,
    cmd: &Command,
    ctx: Option<&TaskContext>,
) -> Result<CommandResult, EngineError> {
    let payload: FramePayload = serde_json::from_value(cmd.payload.clone())?;
    if let Some(sheet_id) = payload.sheet_id {
        if payload
            .width
            .is_some()
            || payload.height.is_some()
            || payload.origin_x.is_some()
            || payload.origin_y.is_some()
            || payload.scale.is_some()
        {
            return Err(bad("sheet_id excludes the world viewport fields"));
        }
        let dpi = payload.dpi.unwrap_or(DEFAULT_DPI);
        let (width, height, pixels) = sheet_pixels(s, sheet_id, dpi, ctx)?;
        if let Some(ctx) = ctx {
            ctx.checkpoint()?
        }
        return Ok(
            CommandResult::read_only(json!({"width":width,"height":height})).with_bytes(
                cmd,
                "pixels_b64",
                pixels,
            ),
        );
    }
    let (width, height, origin_x, origin_y, scale) = match (
        payload.width,
        payload.height,
        payload.origin_x,
        payload.origin_y,
        payload.scale,
    ) {
        (Some(w), Some(h), Some(x), Some(y), Some(sc)) => (w, h, x, y, sc),
        _ => return Err(bad("world viewport requires width,height,origin_x,origin_y,scale")),
    };
    if payload.dpi.is_some() {
        return Err(bad("dpi requires sheet_id"));
    }
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 1_048_576
        || !coord(origin_x)
        || !coord(origin_y)
        || !scale.is_finite()
        || !(1e-6..=1e4).contains(&scale)
    {
        return Err(bad("invalid bounded world viewport"));
    }
    let pixels = rasterize(s, width, height, origin_x, origin_y, scale, ctx)?;
    if let Some(ctx) = ctx {
        ctx.checkpoint()?
    }
    Ok(
        CommandResult::read_only(json!({"width":width,"height":height})).with_bytes(
            cmd,
            "pixels_b64",
            pixels,
        ),
    )
}
