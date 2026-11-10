//! Bounded dependency evaluation. Hug derives content; fill requires definite parent space.
use crate::model::*;
use ignition_core::EngineError;
use std::collections::{BTreeMap, BTreeSet};
pub fn authored(n: &Node, a: Axis) -> f64 {
    match a {
        Axis::X => n.width,
        Axis::Y => n.height,
    }
}
pub fn mode(n: &Node, a: Axis) -> SizeMode {
    match a {
        Axis::X => n.sizing.x,
        Axis::Y => n.sizing.y,
    }
}
pub fn main(l: &Layout) -> Axis {
    if l.direction == Direction::Row {
        Axis::X
    } else {
        Axis::Y
    }
}
pub fn padding(l: &Layout, a: Axis) -> f64 {
    if a == Axis::X {
        l.padding_left + l.padding_right
    } else {
        l.padding_top + l.padding_bottom
    }
}
pub fn lines(
    ids: &[u64],
    available: f64,
    gap: f64,
    wrap: bool,
    mut size: impl FnMut(u64) -> f64,
) -> Vec<Vec<u64>> {
    let mut result = vec![];
    let mut line = vec![];
    let mut used = 0.;
    for id in ids {
        let extent = size(*id);
        if wrap && !line.is_empty() && used + gap + extent > available {
            result.push(std::mem::take(&mut line));
            used = 0.;
        }
        if !line.is_empty() {
            used += gap;
        }
        line.push(*id);
        used += extent;
    }
    if !line.is_empty() {
        result.push(line);
    }
    result
}
pub struct Sizes {
    pub values: BTreeMap<(u64, Axis), f64>,
}
pub fn evaluate(s: &State) -> Result<Sizes, EngineError> {
    let mut owner = Resolver {
        s,
        values: BTreeMap::new(),
        visiting: BTreeSet::new(),
    };
    for id in s.nodes.keys() {
        owner.resolve(*id, Axis::X)?;
        owner.resolve(*id, Axis::Y)?;
    }
    Ok(Sizes {
        values: owner.values,
    })
}
struct Resolver<'a> {
    s: &'a State,
    values: BTreeMap<(u64, Axis), f64>,
    visiting: BTreeSet<(u64, Axis)>,
}
impl Resolver<'_> {
    fn resolve(&mut self, id: u64, axis: Axis) -> Result<f64, EngineError> {
        if let Some(v) = self.values.get(&(id, axis)) {
            return Ok(*v);
        }
        if self.visiting.len() >= 256 || !self.visiting.insert((id, axis)) {
            return Err(bad("cyclic or excessive sizing dependencies"));
        }
        let n = &self.s.nodes[&id];
        let sizing = mode(n, axis);
        if id == 1 && sizing != SizeMode::Fixed {
            return Err(bad("root canvas must remain fixed"));
        }
        let parent = self.s.parent(id);
        let stretch = parent
            .and_then(|p| self.s.nodes[&p].layout.as_ref().map(|l| (p, l)))
            .filter(|(_, l)| main(l) != axis && l.align == Align::Stretch);
        let value = if let Some((p, l)) = stretch {
            if sizing == SizeMode::Hug {
                return Err(bad("cross-axis hug conflicts with parent stretch"));
            }
            if l.wrap {
                if sizing == SizeMode::Fill {
                    return Err(bad("fill is unavailable inside wrapped flow"));
                }
                let groups = self.groups(p)?;
                let group = groups
                    .iter()
                    .find(|g| g.contains(&id))
                    .ok_or_else(|| bad("missing wrapped line"))?;
                let mut max = 0f64;
                for child in group {
                    let child = &self.s.nodes[child];
                    if mode(child, axis) != SizeMode::Fixed {
                        return Err(bad("wrapped stretch needs fixed cross-axis children"));
                    }
                    max = max.max(authored(child, axis));
                }
                max
            } else {
                self.resolve(p, axis)? - padding(l, axis)
            }
        } else {
            match sizing {
                SizeMode::Fixed => authored(n, axis),
                SizeMode::Fill => {
                    let p = parent.ok_or_else(|| bad("fill needs a parent"))?;
                    let parent = &self.s.nodes[&p];
                    if parent.layout.as_ref().is_some_and(|l| l.wrap) {
                        return Err(bad("fill is unavailable inside wrapped flow"));
                    }
                    let available = self.resolve(p, axis)?
                        - parent.layout.as_ref().map_or(0., |l| padding(l, axis));
                    if let Some(l) = &parent.layout {
                        if main(l) == axis {
                            let mut fixed = 0.;
                            let mut fills = 0;
                            for child in &parent.children {
                                if mode(&self.s.nodes[child], axis) == SizeMode::Fill {
                                    fills += 1;
                                } else {
                                    fixed += self.resolve(*child, axis)?;
                                }
                            }
                            (available
                                - fixed
                                - l.gap * parent.children.len().saturating_sub(1) as f64)
                                / fills as f64
                        } else {
                            available
                        }
                    } else {
                        available - if axis == Axis::X { n.x } else { n.y }
                    }
                }
                SizeMode::Hug => self.hug(id, axis)?,
            }
        };
        if !value.is_finite() || value <= 0. || value > 1e7 {
            return Err(bad(
                "sizing result must be positive and within renderer bounds",
            ));
        }
        self.visiting.remove(&(id, axis));
        self.values.insert((id, axis), value);
        Ok(value)
    }
    fn groups(&mut self, id: u64) -> Result<Vec<Vec<u64>>, EngineError> {
        let n = &self.s.nodes[&id];
        let l = n.layout.as_ref().unwrap();
        let axis = main(l);
        let available = self.resolve(id, axis)? - padding(l, axis);
        if available <= 0. {
            return Err(bad("sizing leaves no layout content space"));
        }
        let mut sizes = BTreeMap::new();
        for child in &n.children {
            sizes.insert(*child, self.resolve(*child, axis)?);
        }
        Ok(lines(&n.children, available, l.gap, l.wrap, |id| {
            sizes[&id]
        }))
    }
    fn hug(&mut self, id: u64, axis: Axis) -> Result<f64, EngineError> {
        let n = &self.s.nodes[&id];
        if n.kind != Kind::Frame {
            return Err(bad("hug requires a frame"));
        }
        if let Some(l) = &n.layout {
            if axis == main(l) {
                if l.wrap {
                    return Err(bad("wrapped main-axis hug has no definite line width"));
                }
                let mut size = l.gap * n.children.len().saturating_sub(1) as f64;
                for child in &n.children {
                    size += self.resolve(*child, axis)?;
                }
                Ok(size.max(0.001) + padding(l, axis))
            } else {
                let groups = if l.wrap {
                    self.groups(id)?
                } else {
                    vec![n.children.clone()]
                };
                let mut extent = l.gap * groups.len().saturating_sub(1) as f64;
                for line in groups {
                    let mut cross = 0f64;
                    for child in line {
                        let value = if l.align == Align::Stretch {
                            let c = &self.s.nodes[&child];
                            if mode(c, axis) != SizeMode::Fixed {
                                return Err(bad(
                                    "hug/stretch needs fixed intrinsic cross-axis children",
                                ));
                            }
                            authored(c, axis)
                        } else {
                            self.resolve(child, axis)?
                        };
                        cross = cross.max(value);
                    }
                    extent += cross;
                }
                Ok(extent.max(0.001) + padding(l, axis))
            }
        } else {
            let mut extent = 0f64;
            for child in &n.children {
                let c = &self.s.nodes[child];
                extent = extent
                    .max((if axis == Axis::X { c.x } else { c.y }) + self.resolve(*child, axis)?);
            }
            Ok(extent.max(0.001))
        }
    }
}
