//! One bounded explicit command grammar; no expression evaluation or source execution.
use crate::model::{bad, coord, HATCH_PATTERNS, SAFE_ID};
use ignition_core::EngineError;
use serde_json::{json, Value};
pub enum Plan {
    Circular {
        center: [f64; 2],
        radius: f64,
        arc: Option<(f64, f64)>,
    },
    Command {
        op: &'static str,
        payload: Value,
        message: &'static str,
    },
    Line {
        a: [f64; 2],
        b: [f64; 2],
    },
}
fn number(token: &str) -> Result<f64, EngineError> {
    let value = token
        .parse::<f64>()
        .map_err(|_| bad("expected decimal/scientific finite number"))?;
    if !value.is_finite() {
        return Err(bad("command numbers must be finite"));
    }
    Ok(value)
}
fn world(token: &str) -> Result<f64, EngineError> {
    let value = number(token)?;
    if !coord(value) {
        return Err(bad("command coordinate exceeds world budget"));
    }
    Ok(value)
}
fn id(token: &str) -> Result<u64, EngineError> {
    if token.is_empty() || !token.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad("expected positive entity ID"));
    }
    let value = token.parse::<u64>().map_err(|_| bad("invalid entity ID"))?;
    if value == 0 || value > SAFE_ID {
        return Err(bad("entity ID outside safe range"));
    }
    Ok(value)
}
fn flag(token: &str) -> Result<bool, EngineError> {
    match token.to_ascii_lowercase().as_str() {
        "on" | "true" | "yes" | "1" => Ok(true),
        "off" | "false" | "no" | "0" => Ok(false),
        _ => Err(bad("expected on/off flag")),
    }
}
fn layer(words: &[&str]) -> Result<Plan, EngineError> {
    let command = |op, payload, message| {
        Ok(Plan::Command {
            op,
            payload,
            message,
        })
    };
    match (words[1].to_ascii_uppercase().as_str(), words.len()) {
        ("NEW", 3) => command("addLayer", json!({"name":words[2]}), "Layer created"),
        ("RENAME", 4) => command(
            "updateLayer",
            json!({"id":id(words[2])?,"name":words[3]}),
            "Layer renamed",
        ),
        ("VISIBLE", 4) => command(
            "updateLayer",
            json!({"id":id(words[2])?,"visible":flag(words[3])?}),
            "Layer visibility updated",
        ),
        ("LOCK", 4) => command(
            "updateLayer",
            json!({"id":id(words[2])?,"locked":flag(words[3])?}),
            "Layer lock updated",
        ),
        ("DELETE", 3) => command("removeLayer", json!({"id":id(words[2])?}), "Layer removed"),
        _ => Err(bad(
            "LAYER supports NEW name, RENAME id name, VISIBLE id on|off, LOCK id on|off or DELETE id",
        )),
    }
}
fn hatch(words: &[&str]) -> Result<Plan, EngineError> {
    let pattern = words[1].to_ascii_lowercase();
    if !HATCH_PATTERNS.contains(&pattern.as_str()) {
        return Err(bad("HATCH pattern must be one of solid, ansi31, crosshatch or horizontal"));
    }
    let mut ids = Vec::with_capacity(words.len() - 2);
    for token in &words[2..] {
        ids.push(id(token)?);
    }
    Ok(Plan::Command {
        op: "addHatch",
        payload: json!({"pattern":pattern,"boundary_ids":ids}),
        message: "Hatch created",
    })
}
fn dimension(words: &[&str]) -> Result<Plan, EngineError> {
    let command = |kind: &str, mut payload: Value| {
        payload["kind"] = json!(kind);
        Ok(Plan::Command {
            op: "addDimension",
            payload,
            message: "Dimension created",
        })
    };
    match (words[1].to_ascii_uppercase().as_str(), words.len()) {
        ("LINEAR", 5) => {
            let axis = match words[4].to_ascii_lowercase().as_str() {
                "x" => "x",
                "y" => "y",
                _ => return Err(bad("DIM LINEAR axis must be x or y")),
            };
            command(
                "linear",
                json!({"points":[id(words[2])?,id(words[3])?],"axis":axis}),
            )
        }
        ("ALIGNED", 4) => command(
            "aligned",
            json!({"points":[id(words[2])?,id(words[3])?]}),
        ),
        ("ANGULAR", 5) => command(
            "angular",
            json!({"points":[id(words[2])?,id(words[3])?,id(words[4])?]}),
        ),
        ("RADIAL", 3) | ("DIAMETER", 3) => {
            let kind = words[1].to_ascii_lowercase();
            command(&kind, json!({"entity":id(words[2])?}))
        }
        _ => Err(bad(
            "DIM supports LINEAR a b x|y, ALIGNED a b, ANGULAR vertex first second, RADIAL entity or DIAMETER entity",
        )),
    }
}
pub fn parse(text: &str) -> Result<Plan, EngineError> {
    if text.len() > 4096 || !text.is_ascii() {
        return Err(bad("commands require at most 4096 ASCII bytes"));
    }
    let words: Vec<_> = text.split_ascii_whitespace().collect();
    if words.is_empty() || words.len() > 8 || words.iter().any(|w| w.len() > 64) {
        return Err(bad("command requires 1..8 tokens of at most 64 bytes"));
    }
    let verb = words[0].to_ascii_uppercase();
    let command = |op, payload, message| {
        Ok(Plan::Command {
            op,
            payload,
            message,
        })
    };
    match(verb.as_str(),words.len()){
  ("POINT",3)=>command("addPoint",json!({"x":world(words[1])?,"y":world(words[2])?}),"Point created"),
  ("LINE",5)=>Ok(Plan::Line{a:[world(words[1])?,world(words[2])?],b:[world(words[3])?,world(words[4])?]}),
  ("CIRCLE",4)=>Ok(Plan::Circular{center:[world(words[1])?,world(words[2])?],radius:world(words[3])?,arc:None}),
  ("ARC",6)=>Ok(Plan::Circular{center:[world(words[1])?,world(words[2])?],radius:world(words[3])?,arc:Some((number(words[4])?,number(words[5])?))}),
  ("SEGMENT",3)=>command("addSegment",json!({"a":id(words[1])?,"b":id(words[2])?}),"Segment created"),
  ("MOVE",4)=>command("updatePoint",json!({"id":id(words[1])?,"x":world(words[2])?,"y":world(words[3])?}),"Point position updated"),
  ("DELETE",3)=>{let op=match words[1].to_ascii_uppercase().as_str(){"POINT"=>"removePoint","SEGMENT"=>"removeSegment","CONSTRAINT"=>"removeConstraint","CIRCLE"=>"removeCircle","ARC"=>"removeArc","HATCH"=>"removeHatch","DIMENSION"=>"removeDimension","LAYER"=>"removeLayer",_=>return Err(bad("DELETE supports POINT, SEGMENT, CIRCLE, ARC, CONSTRAINT, HATCH, DIMENSION or LAYER"))};command(op,json!({"id":id(words[2])?}),"Entity removed")},
  ("SOLVE",1|2)=>command("solve",if words.len()==2{json!({"tolerance":number(words[1])?})}else{json!({})},"Linear solve evaluated"),
  ("SNAP",4|6)=>{let mut payload=json!({"x":world(words[1])?,"y":world(words[2])?,"tolerance":number(words[3])?});if words.len()==6{payload["anchor"]=json!({"x":world(words[4])?,"y":world(words[5])?})}command("querySnap",payload,"Snap query evaluated")},
  ("LAYER",3..=4)=>layer(&words),
  ("HATCH",3..=8)=>hatch(&words),
  ("DIM",3..=5)=>dimension(&words),
  _=>Err(bad("unsupported command or argument count; use POINT, LINE, CIRCLE, ARC, SEGMENT, MOVE, DELETE, SOLVE, SNAP, LAYER, HATCH or DIM"))
 }
}
