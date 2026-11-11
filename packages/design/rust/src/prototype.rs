//! Prototype catalog reads and referential pruning (slice E). Everything
//! here is pure and deterministic: no clocks, no playback state, no
//! animation. `resolvePrototypeEvent` returns which stored interaction
//! fires for an event descriptor plus its resolved transition parameters;
//! the host owns scheduling `delay_ms`/`duration_ms` on its own clock.
//! `prototypeGraph` projects the catalog into the NYC-Tron L-08..L-11
//! contract shapes (screens, hotspots, interactions, transitions, links).
use crate::model::*;
use ignition_core::EngineError;
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// Read op `prototypeGraph`: the full catalog plus derived `links` for the
/// FlowOverview contract (one link per navigate/overlay interaction with a
/// screen target, in stored interaction order).
pub fn graph(s: &State) -> Value {
    let screens: Vec<Value> = s
        .prototype
        .screens
        .iter()
        .filter_map(|sc| {
            let n = s.nodes.get(&sc.node)?;
            Some(json!({
                "node": sc.node,
                "name": n.name,
                "kind": n.kind,
                "entry": sc.entry,
                "x": n.x,
                "y": n.y,
                "width": n.width,
                "height": n.height,
            }))
        })
        .collect();
    let hotspots: Vec<Value> = s
        .prototype
        .hotspots
        .iter()
        .map(|h| {
            json!({
                "id": h.id,
                "screen": h.screen,
                "label": h.label,
                "x": h.x,
                "y": h.y,
                "width": h.width,
                "height": h.height,
            })
        })
        .collect();
    let transitions: Vec<Value> = s
        .prototype
        .transitions
        .iter()
        .map(|t| {
            let mut v = json!({
                "id": t.id,
                "label": t.label,
                "kind": t.kind,
                "easing": t.easing,
                "duration_ms": t.duration_ms,
            });
            if let Some(d) = t.direction {
                v["direction"] = json!(d);
            }
            v
        })
        .collect();
    let interactions: Vec<Value> = s.prototype.interactions.iter().map(interaction_json).collect();
    // FlowOverview links: navigate/overlay interactions with a screen
    // target become edges between the interaction's screen (via its
    // hotspot when attached to one) and the destination screen.
    let screen_of_hotspot: std::collections::BTreeMap<&str, u64> = s
        .prototype
        .hotspots
        .iter()
        .map(|h| (h.id.as_str(), h.screen))
        .collect();
    let links: Vec<Value> = s
        .prototype
        .interactions
        .iter()
        .filter_map(|i| {
            let source = i.screen.or_else(|| {
                i.hotspot
                    .as_deref()
                    .and_then(|h| screen_of_hotspot.get(h).copied())
            })?;
            let Some(PrototypeTarget::Screen { node }) = &i.target else {
                return None;
            };
            if !matches!(i.action, PrototypeAction::Navigate | PrototypeAction::Overlay) {
                return None;
            }
            Some(json!({
                "id": i.id,
                "source": source,
                "target": node,
                "label": i.action,
            }))
        })
        .collect();
    json!({
        "screens": screens,
        "hotspots": hotspots,
        "interactions": interactions,
        "transitions": transitions,
        "links": links,
        "runtime": {
            "clock": "host-owned",
            "playback": "host-owned",
            "note": "The engine stores the catalog and resolves events deterministically; it never fakes animation playback or schedules delays.",
        },
    })
}

fn interaction_json(i: &PrototypeInteraction) -> Value {
    let mut v = json!({
        "id": i.id,
        "trigger": i.trigger,
        "delay_ms": i.delay_ms,
        "action": i.action,
    });
    if let Some(h) = &i.hotspot {
        v["hotspot"] = json!(h);
    }
    if let Some(n) = i.screen {
        v["screen"] = json!(n);
    }
    if let Some(t) = &i.target {
        v["target"] = json!(t);
    }
    if let Some(t) = &i.transition {
        v["transition"] = json!(t);
    }
    if let Some(d) = i.duration_ms {
        v["duration_ms"] = json!(d);
    }
    if let Some(val) = &i.value {
        v["value"] = json!(val);
    }
    v
}

/// Read op `resolvePrototypeEvent`: pure deterministic resolution. Payload
/// `{hotspot?: string, screen?: number, trigger?: "tap"|"press"|"hover"|
/// "drag"|"timer"}`. Returns JSON `null` when nothing matches; otherwise
/// the matched interaction plus its resolved transition
/// (`{id,kind,easing,direction?,duration_ms}` with the interaction's
/// `duration_ms` override applied, or `null` when the interaction names no
/// transition) and `delay_ms` for the host to schedule. `screen`-scoped
/// queries match screen-level interactions and interactions on that
/// screen's hotspots; the first catalog-order match wins.
pub fn resolve(s: &State, p: &Value) -> Result<Value, EngineError> {
    let object = p
        .as_object()
        .ok_or_else(|| bad("expected event descriptor object"))?;
    for k in object.keys() {
        if !["hotspot", "screen", "trigger"].contains(&k.as_str()) {
            return Err(bad("unknown event field"));
        }
    }
    let hotspot = match p.get("hotspot") {
        Some(Value::Null) | None => None,
        Some(v) => Some(
            v.as_str()
                .ok_or_else(|| bad("hotspot must be a string id"))?,
        ),
    };
    let screen = match p.get("screen") {
        Some(Value::Null) | None => None,
        Some(v) => Some(
            v.as_u64()
                .ok_or_else(|| bad("screen must be a node id"))?,
        ),
    };
    let trigger: Option<PrototypeTrigger> = match p.get("trigger") {
        Some(Value::Null) | None => None,
        Some(v) => Some(serde_json::from_value(v.clone())?),
    };
    if hotspot.is_none() && screen.is_none() {
        return Err(bad("event requires a hotspot or screen"));
    }
    // Screen scope expands to the screen's hotspots so a bare screen event
    // can still reach region interactions; catalog order decides ties.
    let hotspot_screens: std::collections::BTreeMap<&str, u64> = s
        .prototype
        .hotspots
        .iter()
        .map(|h| (h.id.as_str(), h.screen))
        .collect();
    let matched = s.prototype.interactions.iter().find(|i| {
        if let Some(t) = trigger {
            if i.trigger != t {
                return false;
            }
        }
        if let Some(h) = hotspot {
            return i.hotspot.as_deref() == Some(h);
        }
        let node = screen.unwrap();
        if i.screen == Some(node) {
            return true;
        }
        i.hotspot
            .as_deref()
            .and_then(|h| hotspot_screens.get(h).copied())
            == Some(node)
    });
    let Some(i) = matched else {
        return Ok(Value::Null);
    };
    let transition = match &i.transition {
        Some(tid) => s
            .prototype
            .transitions
            .iter()
            .find(|t| &t.id == tid)
            .map(|t| {
                let mut v = json!({
                    "id": t.id,
                    "kind": t.kind,
                    "easing": t.easing,
                    "duration_ms": i.duration_ms.unwrap_or(t.duration_ms),
                });
                if let Some(d) = t.direction {
                    v["direction"] = json!(d);
                }
                v
            }),
        None => None,
    };
    Ok(json!({
        "matched": true,
        "interaction": interaction_json(i),
        "transition": transition,
        "delay_ms": i.delay_ms,
        "scheduled_by": "host",
    }))
}

/// Referential pruning for mutation ops: after nodes or catalog entries
/// are removed, drop screens whose node is gone or no longer a
/// Frame/Component, hotspots on dropped screens, and interactions left
/// dangling (unknown hotspot/screen attachment or a screen target that is
/// no longer registered). Variable targets are pruned by the variable ops.
/// Runs before whole-document `validate`, which still rejects anything
/// this pass does not cover.
pub fn prune(s: &mut State) {
    s.prototype.screens.retain(|sc| {
        s.nodes
            .get(&sc.node)
            .is_some_and(|n| matches!(n.kind, Kind::Frame | Kind::Component))
    });
    let screens: BTreeSet<u64> = s.prototype.screens.iter().map(|sc| sc.node).collect();
    s.prototype.hotspots.retain(|h| screens.contains(&h.screen));
    let hotspots: BTreeSet<&str> = s
        .prototype
        .hotspots
        .iter()
        .map(|h| h.id.as_str())
        .collect();
    s.prototype.interactions.retain(|i| {
        let attached = match (&i.hotspot, i.screen) {
            (Some(h), None) => hotspots.contains(h.as_str()),
            (None, Some(n)) => screens.contains(&n),
            _ => false,
        };
        if !attached {
            return false;
        }
        !matches!(&i.target, Some(PrototypeTarget::Screen { node }) if !screens.contains(node))
    });
}
