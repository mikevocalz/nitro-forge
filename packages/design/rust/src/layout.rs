use crate::{model::*, sizing};
use ignition_core::EngineError;
use serde::Serialize;
#[derive(Clone, Debug, Serialize)]
pub struct BoxNode {
    pub id: u64,
    pub kind: Kind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: [u8; 4],
    pub visible: bool,
    /// False for `Kind::Text`: the box participates in layout but
    /// `renderFrame` emits only its fill background, never glyphs.
    pub renderable: bool,
}
pub fn evaluate(s: &State) -> Result<Vec<BoxNode>, EngineError> {
    let sizes = sizing::evaluate(s)?;
    let mut out = vec![];
    place(s, &sizes, 1, 0., 0., true, &mut out)?;
    Ok(out)
}
fn place(
    s: &State,
    sizes: &sizing::Sizes,
    id: u64,
    x: f64,
    y: f64,
    visible: bool,
    out: &mut Vec<BoxNode>,
) -> Result<(), EngineError> {
    let width = sizes.values[&(id, Axis::X)];
    let height = sizes.values[&(id, Axis::Y)];
    if ![x, y, width, height]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 1e7)
        || width <= 0.
        || height <= 0.
    {
        return Err(bad("evaluated box exceeds Prism shape bounds"));
    }
    let n = &s.nodes[&id];
    let visible = visible && n.visible;
    out.push(BoxNode {
        id,
        kind: n.kind,
        x,
        y,
        width,
        height,
        fill: n.fill,
        visible,
        renderable: n.kind != Kind::Text,
    });
    if let Some(l) = &n.layout {
        let axis = sizing::main(l);
        let row = axis == Axis::X;
        let inner_w = width - l.padding_left - l.padding_right;
        let inner_h = height - l.padding_top - l.padding_bottom;
        if inner_w <= 0. || inner_h <= 0. {
            return Err(bad("evaluated layout content box is empty"));
        }
        let main = if row { inner_w } else { inner_h };
        let cross = if row { inner_h } else { inner_w };
        let lines = sizing::lines(&n.children, main, l.gap, l.wrap, |id| {
            sizes.values[&(id, axis)]
        });
        let mut cross_cursor = 0.;
        for line in lines {
            let line_cross = if l.wrap {
                line.iter()
                    .map(|id| sizes.values[&(*id, axis.other())])
                    .fold(0., f64::max)
            } else {
                cross
            };
            let count = line.len();
            let used = line
                .iter()
                .map(|id| sizes.values[&(*id, axis)])
                .sum::<f64>()
                + l.gap * count.saturating_sub(1) as f64;
            let extra = (main - used).max(0.);
            let mut cursor = match l.justify {
                Justify::Center => extra / 2.,
                Justify::End => extra,
                _ => 0.,
            };
            let gap = l.gap
                + if l.justify == Justify::SpaceBetween && count > 1 {
                    extra / (count - 1) as f64
                } else {
                    0.
                };
            for id in line {
                let size = sizes.values[&(id, axis.other())];
                let offset = match l.align {
                    Align::Center => (line_cross - size) / 2.,
                    Align::End => line_cross - size,
                    _ => 0.,
                };
                let (cx, cy) = if row {
                    (cursor, cross_cursor + offset)
                } else {
                    (cross_cursor + offset, cursor)
                };
                place(
                    s,
                    sizes,
                    id,
                    x + l.padding_left + cx,
                    y + l.padding_top + cy,
                    visible,
                    out,
                )?;
                cursor += sizes.values[&(id, axis)] + gap;
            }
            cross_cursor += line_cross + l.gap;
        }
    } else {
        for id in &n.children {
            let c = &s.nodes[id];
            place(s, sizes, *id, x + c.x, y + c.y, visible, out)?;
        }
    }
    Ok(())
}
