//! Project markers in ticks: `addMarker`, `addMarkers`, `updateMarker`,
//! `removeMarker`, `listMarkers`.
//!
//! Markers live on the document (`Doc.markers`), so they persist in
//! snapshots and undo like every other edit. Positions are ticks, not
//! seconds, so a marker stays on its beat when the tempo changes. Clip
//! edits never move markers. Each mutating op validates the whole payload
//! before it records one undo step; `addMarkers` records one step for the
//! whole batch, which is how a host stores a beat-detection result.

use crate::{opt_str, req_ticks, req_u64, CadenceEngine, Doc};
use ignition_core::{CommandResult, EngineError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Most markers one document holds, and one `addMarkers` call adds.
pub(crate) const MAX_MARKERS: usize = 8192;
const MAX_NAME_CHARS: usize = 120;
const MAX_NOTE_CHARS: usize = 2000;
/// `ticks + length_ticks` bound: the largest integer a JavaScript number
/// holds exactly, so positions survive the TypeScript boundary.
pub(crate) const MAX_MARKER_TICKS: u64 = (1 << 53) - 1;

type OpResult = Result<CommandResult, EngineError>;

/// A point marker (`length_ticks == 0`) or a range marker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Marker {
    pub id: u64,
    pub ticks: u64,
    #[serde(default)]
    pub length_ticks: u64,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A validated marker before it has an id.
struct MarkerInput {
    ticks: u64,
    length_ticks: u64,
    name: Option<String>,
    note: Option<String>,
}

fn check_span(ticks: u64, length_ticks: u64) -> Result<(), EngineError> {
    match ticks.checked_add(length_ticks) {
        Some(end) if end <= MAX_MARKER_TICKS => Ok(()),
        _ => Err(EngineError::out_of_bounds(format!(
            "marker must end by tick {MAX_MARKER_TICKS}"
        ))),
    }
}

/// Trimmed, non-empty, at most 120 characters.
fn check_name(name: &str) -> Result<String, EngineError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(EngineError::validation("name must not be empty"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(EngineError::validation(format!(
            "name is longer than {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name.to_string())
}

/// At most 2000 characters; an empty note is stored as no note.
fn check_note(note: String) -> Result<Option<String>, EngineError> {
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(EngineError::validation(format!(
            "note is longer than {MAX_NOTE_CHARS} characters"
        )));
    }
    Ok(if note.is_empty() { None } else { Some(note) })
}

fn opt_ticks(p: &Value, key: &str) -> Result<Option<u64>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => req_ticks(p, key).map(Some),
    }
}

/// Parse one `{ticks, length_ticks?, name?, note?}` entry. Unknown keys
/// reject so a typo cannot silently drop a field.
fn parse_input(p: &Value) -> Result<MarkerInput, EngineError> {
    let obj = p
        .as_object()
        .ok_or_else(|| EngineError::invalid("marker must be an object"))?;
    if let Some(k) = obj
        .keys()
        .find(|k| !matches!(k.as_str(), "ticks" | "length_ticks" | "name" | "note"))
    {
        return Err(EngineError::invalid(format!("unknown marker field '{k}'")));
    }
    let ticks = req_ticks(p, "ticks")?;
    let length_ticks = opt_ticks(p, "length_ticks")?.unwrap_or(0);
    check_span(ticks, length_ticks)?;
    let name = match opt_str(p, "name")? {
        Some(n) => Some(check_name(&n)?),
        None => None,
    };
    let note = match opt_str(p, "note")? {
        Some(n) => check_note(n)?,
        None => None,
    };
    Ok(MarkerInput { ticks, length_ticks, name, note })
}

/// Marker invariants, for `restore`.
pub(crate) fn check_restored(markers: &[Marker]) -> Result<(), EngineError> {
    if markers.len() > MAX_MARKERS {
        return Err(EngineError::validation("too many markers"));
    }
    let mut ids = std::collections::HashSet::new();
    for m in markers {
        if m.id == 0 || m.id > MAX_MARKER_TICKS {
            return Err(EngineError::validation(
                "marker id must be a positive JavaScript-safe integer",
            ));
        }
        if !ids.insert(m.id) {
            return Err(EngineError::validation(format!("duplicate marker id {}", m.id)));
        }
        check_span(m.ticks, m.length_ticks)?;
        if check_name(&m.name)? != m.name {
            return Err(EngineError::validation("marker name is not trimmed"));
        }
        if let Some(note) = &m.note {
            if check_note(note.clone())?.is_none() {
                return Err(EngineError::validation("empty marker note"));
            }
        }
    }
    Ok(())
}

pub(crate) fn sort(doc: &mut Doc) {
    doc.markers.sort_by(|a, b| a.ticks.cmp(&b.ticks).then(a.id.cmp(&b.id)));
}

/// Append validated inputs; default names count from the current total.
fn push_all(doc: &mut Doc, inputs: Vec<MarkerInput>) -> Vec<u64> {
    let mut ids = Vec::with_capacity(inputs.len());
    for input in inputs {
        let name = input
            .name
            .unwrap_or_else(|| format!("Marker {}", doc.markers.len() + 1));
        let id = doc.alloc_id();
        doc.markers.push(Marker {
            id,
            ticks: input.ticks,
            length_ticks: input.length_ticks,
            name,
            note: input.note,
        });
        ids.push(id);
    }
    sort(doc);
    ids
}

impl CadenceEngine {
    /// Marker ops; `None` when `op` is not one of them.
    pub(crate) fn apply_markers(&mut self, op: &str, p: &Value) -> Option<OpResult> {
        let r = match op {
            "addMarker" => self.add_marker(p),
            "addMarkers" => self.add_markers(p),
            "updateMarker" => self.update_marker(p),
            "removeMarker" => self.remove_marker(p),
            "listMarkers" => Ok(Self::read_only(json!({ "markers": self.doc.markers }))),
            _ => return None,
        };
        Some(r)
    }

    fn check_capacity(&self, adding: usize) -> Result<(), EngineError> {
        // Restore may load a legacy document whose allocator is beyond the JS
        // number boundary. Refuse new marker IDs before recording or mutating.
        if self.doc.next_id == 0
            || self.doc.next_id > MAX_MARKER_TICKS
            || (adding as u64).saturating_sub(1) > MAX_MARKER_TICKS - self.doc.next_id
        {
            return Err(EngineError::out_of_bounds(
                "no JavaScript-safe marker ids remain",
            ));
        }
        if self.doc.markers.len() + adding > MAX_MARKERS {
            return Err(EngineError::out_of_bounds(format!(
                "a project holds at most {MAX_MARKERS} markers"
            )));
        }
        Ok(())
    }

    /// `addMarker {ticks, length_ticks?, name?, note?}` → `{marker_id}`.
    fn add_marker(&mut self, p: &Value) -> OpResult {
        let input = parse_input(p)?;
        self.check_capacity(1)?;
        self.record();
        let ids = push_all(&mut self.doc, vec![input]);
        Ok(Self::changed(json!({ "marker_id": ids[0] })))
    }

    /// `addMarkers {markers: [...]}` → `{marker_ids}`, in input order. All
    /// or nothing, one undo step.
    fn add_markers(&mut self, p: &Value) -> OpResult {
        let list = p
            .get("markers")
            .and_then(Value::as_array)
            .ok_or_else(|| EngineError::invalid("missing or invalid 'markers'"))?;
        if list.is_empty() {
            return Err(EngineError::validation("markers must hold 1..=8192 entries"));
        }
        if list.len() > MAX_MARKERS {
            return Err(EngineError::out_of_bounds(format!(
                "markers must hold 1..={MAX_MARKERS} entries"
            )));
        }
        let inputs = list.iter().map(parse_input).collect::<Result<Vec<_>, _>>()?;
        self.check_capacity(inputs.len())?;
        self.record();
        let ids = push_all(&mut self.doc, inputs);
        Ok(Self::changed(json!({ "marker_ids": ids })))
    }

    /// `updateMarker {id, ticks?, length_ticks?, name?, note?}`: at least
    /// one field; `note: null` or `""` clears the note. The id never
    /// changes. A patch that changes nothing records nothing.
    fn update_marker(&mut self, p: &Value) -> OpResult {
        let id = req_u64(p, "id")?;
        let obj = p
            .as_object()
            .ok_or_else(|| EngineError::invalid("payload must be an object"))?;
        if let Some(k) = obj.keys().find(|k| {
            !matches!(k.as_str(), "id" | "ticks" | "length_ticks" | "name" | "note")
        }) {
            return Err(EngineError::invalid(format!("unknown marker field '{k}'")));
        }
        if obj.len() < 2 {
            return Err(EngineError::invalid(
                "updateMarker requires at least one of 'ticks', 'length_ticks', 'name', 'note'",
            ));
        }
        let i = self
            .doc
            .markers
            .iter()
            .position(|m| m.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no marker {id}")))?;
        let cur = &self.doc.markers[i];
        let ticks = opt_ticks(p, "ticks")?.unwrap_or(cur.ticks);
        let length_ticks = opt_ticks(p, "length_ticks")?.unwrap_or(cur.length_ticks);
        check_span(ticks, length_ticks)?;
        let name = match opt_str(p, "name")? {
            Some(n) => check_name(&n)?,
            None if p.get("name").is_some() => {
                return Err(EngineError::validation("name must not be empty"))
            }
            None => cur.name.clone(),
        };
        let note = match p.get("note") {
            None => cur.note.clone(),
            Some(Value::Null) => None,
            Some(_) => check_note(opt_str(p, "note")?.unwrap_or_default())?,
        };
        let next = Marker { id, ticks, length_ticks, name, note };
        if &next == cur {
            return Ok(Self::read_only(json!({ "ok": true })));
        }
        self.record();
        self.doc.markers[i] = next;
        sort(&mut self.doc);
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `removeMarker {id}`.
    fn remove_marker(&mut self, p: &Value) -> OpResult {
        let id = req_u64(p, "id")?;
        let i = self
            .doc
            .markers
            .iter()
            .position(|m| m.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no marker {id}")))?;
        self.record();
        self.doc.markers.remove(i);
        Ok(Self::changed(json!({ "ok": true })))
    }
}
