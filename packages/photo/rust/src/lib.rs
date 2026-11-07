#![forbid(unsafe_code)]
//! Persistent catalog and bounded sRGB preview processing. RAW decoding and durable originals are host-owned.
mod develop;
pub use develop::Develop;

use ignition_core::{
    decode_envelope, encode_envelope, Command, CommandResult, Engine, EngineError, EngineKind,
    Journal,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
const MAX_BYTES: usize = 8 * 1024 * 1024;
const HISTORY: usize = 16;
const MAX_ID: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Original {
    pub id: String,
    pub sha256: String,
    pub asset_ref: String,
    pub byte_length: u64,
    pub camera_make: String,
    pub camera_model: String,
    pub rating: u8,
    pub labels: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Version {
    #[serde(default, skip_serializing_if = "Develop::is_identity")]
    pub develop: Develop,
    pub id: String,
    pub original_id: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    kind: String,
    schema: u32,
    next_id: u64,
    originals: BTreeMap<String, Arc<Original>>,
    versions: BTreeMap<String, Arc<Version>>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            kind: "photo".into(),
            schema: 1,
            next_id: 1,
            originals: BTreeMap::new(),
            versions: BTreeMap::new(),
        }
    }
}
fn bad(message: &str) -> EngineError {
    EngineError::validation(message)
}
fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, EngineError> {
    p.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| bad(&format!("{key} must be a string")))
}
fn bounded(s: &str, max: usize, empty: bool) -> bool {
    s.len() <= max && (empty || !s.trim().is_empty()) && !s.chars().any(char::is_control)
}
fn valid_id(id: &str, prefix: &str, next: u64) -> bool {
    id.strip_prefix(prefix)
        .and_then(|n| {
            n.parse::<u64>()
                .ok()
                .filter(|v| *v > 0 && *v < next && format!("{prefix}{v}") == id)
        })
        .is_some()
}
fn validate(s: &State) -> Result<(), EngineError> {
    if s.kind != "photo" || s.schema != 1 {
        return Err(bad("expected photo schema 1"));
    }
    if s.next_id == 0
        || s.next_id > MAX_ID
        || s.originals.len() > 10_000
        || s.versions.len() > 100_000
    {
        return Err(bad("catalog limits exceeded"));
    }
    let mut hashes = BTreeSet::new();
    for (id, o) in &s.originals {
        if id != &o.id
            || !valid_id(id, "original-", s.next_id)
            || o.sha256.len() != 64
            || !o
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !hashes.insert(&o.sha256)
        {
            return Err(bad("invalid or duplicate original identity/hash"));
        }
        if o.asset_ref.is_empty()
            || o.asset_ref.len() > 256
            || !o
                .asset_ref
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
            || o.byte_length == 0
            || o.byte_length > MAX_ID
        {
            return Err(bad("invalid immutable host asset descriptor"));
        }
        if !bounded(&o.camera_make, 128, true)
            || !bounded(&o.camera_model, 128, true)
            || o.rating > 5
            || o.labels.len() > 32
            || o.labels.iter().any(|l| !bounded(l, 64, false))
            || o.labels.windows(2).any(|w| w[0] >= w[1])
        {
            return Err(bad("invalid original metadata"));
        }
    }
    let mut counts = BTreeMap::<&str, usize>::new();
    for (id, v) in &s.versions {
        v.develop.validate()?;
        if id != &v.id
            || !valid_id(id, "version-", s.next_id)
            || !s.originals.contains_key(&v.original_id)
            || !bounded(&v.name, 128, false)
        {
            return Err(bad("invalid version identity/reference/name"));
        }
        *counts.entry(&v.original_id).or_default() += 1;
    }
    if s.originals
        .keys()
        .any(|id| !matches!(counts.get(id.as_str()), Some(1..=100)))
    {
        return Err(bad("every original needs 1..100 versions"));
    }
    // A concrete encoded-state limit, not a claim about measured process RSS.
    if serde_json::to_vec(s)?.len() > MAX_BYTES {
        return Err(bad("catalog encoded state exceeds 8 MiB"));
    }
    Ok(())
}
fn alloc(s: &mut State, prefix: &str) -> Result<String, EngineError> {
    let id = s.next_id;
    s.next_id = id
        .checked_add(1)
        .filter(|n| *n <= MAX_ID)
        .ok_or_else(|| bad("catalog id space exhausted"))?;
    Ok(format!("{prefix}{id}"))
}
fn readonly(data: Value) -> CommandResult {
    CommandResult {
        data,
        events: vec![],
        output: None,
    }
}
pub struct PhotoEngine {
    state: Arc<State>,
    journal: Journal<Arc<State>>,
}
impl Default for PhotoEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl PhotoEngine {
    pub fn new() -> Self {
        Self {
            state: Arc::new(State::default()),
            journal: Journal::new(HISTORY),
        }
    }
    fn replace(&mut self, next: State, data: Value) -> Result<CommandResult, EngineError> {
        validate(&next)?;
        if *self.state == next {
            return Ok(readonly(data));
        }
        self.journal.record(Arc::clone(&self.state));
        self.state = Arc::new(next);
        Ok(CommandResult::data(data))
    }
}
impl Engine for PhotoEngine {
    fn kind(&self) -> EngineKind {
        EngineKind::Photo
    }
    fn apply(&mut self, cmd: Command) -> Result<CommandResult, EngineError> {
        if cmd.op == ignition_core::OP_BATCH {
            let batch = ignition_core::parse_batch(cmd)?;
            let staged = Self {
                state: Arc::clone(&self.state),
                journal: Journal::new(1),
            };
            let (staged, result) = ignition_core::execute_batch(staged, batch)?;
            if result.events.iter().any(|e| e.kind == "document:changed") {
                self.journal.record(Arc::clone(&self.state));
                self.state = staged.state;
            }
            return Ok(result);
        }
        if cmd.v != 1 {
            return Err(EngineError::unsupported(
                "unsupported photo command version",
            ));
        }
        if cmd.op == "processPreview" { return self.process_preview(cmd, None); }
        let p = &cmd.payload;
        if cmd.op == "setDevelop" { return self.set_develop(p); }
        if cmd.op == "readDevelop" { return self.read_develop(p); }
        if cmd.op == "describe" {
            return Ok(readonly(serde_json::to_value(&*self.state)?));
        }
        if cmd.op == "readOriginal" {
            let id = text(p, "id")?;
            let original = self
                .state
                .originals
                .get(id)
                .ok_or_else(|| EngineError::not_found("original not found"))?;
            let versions: Vec<_> = self
                .state
                .versions
                .values()
                .filter(|v| v.original_id == id)
                .collect();
            return Ok(readonly(json!({"original":original,"versions":versions})));
        }
        // Structural copies share immutable original/version records with history.
        let mut next = (*self.state).clone();
        let data = match cmd.op.as_str() {
            "new" => {
                next = State::default();
                json!({"ok":true})
            }
            "addOriginal" => {
                let hash = text(p, "sha256")?.to_owned();
                if next.originals.values().any(|o| o.sha256 == hash) {
                    return Err(bad("original content hash already cataloged"));
                }
                let original_id = alloc(&mut next, "original-")?;
                let version_id = alloc(&mut next, "version-")?;
                let original = Original {
                    id: original_id.clone(),
                    sha256: hash,
                    asset_ref: text(p, "asset_ref")?.into(),
                    byte_length: p
                        .get("byte_length")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| bad("byte_length must be an integer"))?,
                    camera_make: text(p, "camera_make")?.into(),
                    camera_model: text(p, "camera_model")?.into(),
                    rating: 0,
                    labels: vec![],
                };
                next.originals
                    .insert(original_id.clone(), Arc::new(original));
                next.versions.insert(
                    version_id.clone(),
                    Arc::new(Version {
                        develop: Develop::default(),
                        id: version_id.clone(),
                        original_id: original_id.clone(),
                        name: "Original".into(),
                    }),
                );
                json!({"original_id":original_id,"version_id":version_id})
            }
            "removeOriginal" => {
                let id = text(p, "id")?;
                if next.originals.remove(id).is_none() {
                    return Err(EngineError::not_found("original not found"));
                }
                next.versions.retain(|_, v| v.original_id != id);
                json!({"ok":true})
            }
            "setRating" | "setLabels" => {
                let id = text(p, "id")?;
                let original = next
                    .originals
                    .get_mut(id)
                    .ok_or_else(|| EngineError::not_found("original not found"))?;
                if cmd.op == "setRating" {
                    Arc::make_mut(original).rating = p
                        .get("rating")
                        .and_then(Value::as_u64)
                        .and_then(|n| u8::try_from(n).ok())
                        .ok_or_else(|| bad("rating must be 0..5"))?;
                } else {
                    let mut labels: Vec<String> = serde_json::from_value(
                        p.get("labels")
                            .cloned()
                            .ok_or_else(|| bad("labels required"))?,
                    )?;
                    labels.sort();
                    if labels.windows(2).any(|w| w[0] == w[1]) {
                        return Err(bad("duplicate label"));
                    }
                    Arc::make_mut(original).labels = labels;
                }
                json!({"ok":true})
            }
            "createVersion" => {
                let original_id = text(p, "original_id")?.to_owned();
                if !next.originals.contains_key(&original_id) {
                    return Err(EngineError::not_found("original not found"));
                }
                let id = alloc(&mut next, "version-")?;
                next.versions.insert(
                    id.clone(),
                    Arc::new(Version {
                        develop: Develop::default(),
                        id: id.clone(),
                        original_id,
                        name: text(p, "name")?.into(),
                    }),
                );
                json!({"version_id":id})
            }
            "renameVersion" => {
                let id = text(p, "id")?;
                let v = next
                    .versions
                    .get_mut(id)
                    .ok_or_else(|| EngineError::not_found("version not found"))?;
                Arc::make_mut(v).name = text(p, "name")?.into();
                json!({"ok":true})
            }
            "removeVersion" => {
                if next.versions.remove(text(p, "id")?).is_none() {
                    return Err(EngineError::not_found("version not found"));
                }
                json!({"ok":true})
            }
            _ => return Err(EngineError::invalid("unknown photo operation")),
        };
        self.replace(next, data)
    }
    fn binary_input_ops(&self) -> &'static [&'static str] { &["processPreview"] }
    fn apply_long(&mut self, command: Command, ctx: &ignition_core::TaskContext) -> Result<CommandResult, EngineError> {
        if command.v != 1 { return Err(EngineError::unsupported("unsupported photo command version")); }
        if command.op == "processPreview" { return self.process_preview(command, Some(ctx)); }
        ctx.checkpoint()?;let result=self.apply(command)?;ctx.set_progress(1.0);Ok(result)
    }
    fn snapshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(encode_envelope(&serde_json::to_vec(&*self.state)?))
    }
    fn restore(&mut self, bytes: &[u8]) -> Result<(), EngineError> {
        let (_, payload) = decode_envelope(bytes)?;
        if payload.len() > MAX_BYTES {
            return Err(bad("catalog encoded state exceeds 8 MiB"));
        }
        let next: State = serde_json::from_slice(payload)?;
        validate(&next)?;
        self.state = Arc::new(next);
        self.journal = Journal::new(HISTORY);
        Ok(())
    }
    fn undo(&mut self) -> Result<bool, EngineError> {
        if let Some(previous) = self.journal.pop_undo() {
            let current = std::mem::replace(&mut self.state, previous);
            self.journal.push_redo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn redo(&mut self) -> Result<bool, EngineError> {
        if let Some(next) = self.journal.pop_redo() {
            let current = std::mem::replace(&mut self.state, next);
            self.journal.push_undo(current);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[cfg(test)]
mod tests;
