use crate::model::*;
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
}
/// Fixed authored sizes; stretch is an evaluated cross-axis override, never a stored resize.
pub fn evaluate(s: &State) -> Result<Vec<BoxNode>, EngineError> {
    let mut out = vec![];
    place(
        s,
        1,
        0.,
        0.,
        s.nodes[&1].width,
        s.nodes[&1].height,
        true,
        &mut out,
    )?;
    Ok(out)
}
fn place(
    s: &State,
    id: u64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    out: &mut Vec<BoxNode>,
) -> Result<(), EngineError> {
    // Match Prism Shape::validate, including hidden boxes, before state admission.
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
    });
    if let Some(l) = &n.layout {
        let row = l.direction == Direction::Row;
        let inner_w = width - l.padding_left - l.padding_right;
        let inner_h = height - l.padding_top - l.padding_bottom;
        if inner_w <= 0. || inner_h <= 0. {
            return Err(bad("evaluated layout content box is empty"));
        }
        let main = if row { inner_w } else { inner_h };
        let cross = if row { inner_h } else { inner_w };
        let count = n.children.len();
        let used: f64 = n
            .children
            .iter()
            .map(|id| {
                let c = &s.nodes[id];
                if row {
                    c.width
                } else {
                    c.height
                }
            })
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
        for id in &n.children {
            let child = &s.nodes[id];
            let size = if row { child.height } else { child.width };
            let offset = match l.align {
                Align::Center => (cross - size) / 2.,
                Align::End => cross - size,
                _ => 0.,
            };
            let stretched = if l.align == Align::Stretch {
                cross
            } else {
                size
            };
            let (cx, cy, cw, ch) = if row {
                (cursor, offset, child.width, stretched)
            } else {
                (offset, cursor, stretched, child.height)
            };
            place(
                s,
                *id,
                x + l.padding_left + cx,
                y + l.padding_top + cy,
                cw,
                ch,
                visible,
                out,
            )?;
            cursor += if row { child.width } else { child.height };
            cursor += gap;
        }
    } else {
        for id in &n.children {
            let c = &s.nodes[id];
            place(s, *id, x + c.x, y + c.y, c.width, c.height, visible, out)?;
        }
    }
    Ok(())
}
