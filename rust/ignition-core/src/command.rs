use crate::error::EngineError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Reserved ops understood by the engine *host*, not by individual `apply`
/// implementations: `__undo`, `__redo`, `__snapshot`. `__restore` is routed to
/// `Engine::restore`.
pub const OP_UNDO: &str = "__undo";
pub const OP_REDO: &str = "__redo";
pub const OP_SNAPSHOT: &str = "__snapshot";

/// Current command schema version.
pub const COMMAND_VERSION: u32 = 1;

/// A unit of intent. `op` names the verb; `payload` carries its arguments.
/// Commands are pure data — they serialize as JSON across every transport
/// (Nitro, nf-cli, WASM, AI tool calls).
///
/// `input` and `binary_output` form the binary sidecar (docs/ARCHITECTURE.md,
/// "Binary transport"). They never serialize: the JSON form of a command is
/// unchanged, and only binary-capable hosts set them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Command {
    #[serde(default = "default_version")]
    pub v: u32,
    pub op: String,
    #[serde(default)]
    pub payload: Value,
    /// Raw input bytes for ops that accept them (listed by
    /// `Engine::binary_input_ops`). Engines read this when the op's `*_b64`
    /// payload field is absent; sending both is an `InvalidCommand` error.
    #[serde(skip)]
    pub input: Option<Vec<u8>>,
    /// The caller wants byte results in `CommandResult::output` instead of a
    /// base64 string inside `data`. Ops without byte results ignore it.
    #[serde(skip)]
    pub binary_output: bool,
}

fn default_version() -> u32 {
    COMMAND_VERSION
}

impl Command {
    pub fn new(op: impl Into<String>, payload: Value) -> Self {
        Self {
            v: COMMAND_VERSION,
            op: op.into(),
            payload,
            input: None,
            binary_output: false,
        }
    }

    /// The same command carrying a binary sidecar and asking for binary output.
    pub fn with_binary(mut self, input: Option<Vec<u8>>) -> Self {
        self.input = input;
        self.binary_output = true;
        self
    }

    /// Resolve an op's byte input: the base64 payload field when present,
    /// otherwise the binary sidecar. Exactly one of the two must be supplied.
    /// `decode` is the engine's base64 decoder, so error codes stay
    /// engine-specific. The sidecar is moved out, never copied.
    pub fn bytes_input<E>(
        &mut self,
        b64_field: &str,
        decode: impl FnOnce(&str) -> Result<Vec<u8>, E>,
    ) -> Result<Vec<u8>, EngineError>
    where
        E: Into<EngineError>,
    {
        match (self.payload.get(b64_field), &mut self.input) {
            (Some(Value::String(_)), Some(_)) => Err(EngineError::invalid(format!(
                "send either '{b64_field}' or binary input, not both"
            ))),
            (Some(Value::String(text)), None) => decode(text).map_err(Into::into),
            (Some(Value::Null) | None, input @ Some(_)) => Ok(input.take().unwrap_or_default()),
            (Some(Value::Null) | None, None) => Err(EngineError::invalid(format!(
                "'{}' requires '{b64_field}' or binary input",
                self.op
            ))),
            (Some(_), _) => Err(EngineError::invalid(format!(
                "field '{b64_field}' must be a string"
            ))),
        }
    }
}

/// A state-change notification produced by a successful `apply`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub kind: String,
    #[serde(default)]
    pub detail: Value,
}

impl Event {
    pub fn new(kind: impl Into<String>, detail: Value) -> Self {
        Self {
            kind: kind.into(),
            detail,
        }
    }
}

/// The result of a successful `apply`: op-specific return data plus the events
/// the host should fan out to listeners.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandResult {
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default)]
    pub data: Value,
    /// Byte result for a command sent with `binary_output`. Never serialized;
    /// the base64 form of the same bytes is what JSON-only callers receive.
    #[serde(skip)]
    pub output: Option<Vec<u8>>,
}

impl CommandResult {
    pub fn empty() -> Self {
        Self::data(Value::Null)
    }

    pub fn data(data: Value) -> Self {
        Self {
            events: vec![Event::new("document:changed", Value::Null)],
            data,
            output: None,
        }
    }

    /// A result that changed nothing: no events.
    pub fn read_only(data: Value) -> Self {
        Self {
            events: Vec::new(),
            data,
            output: None,
        }
    }

    /// Return `bytes` the way the command asked for them: in `output` for a
    /// binary command, or as base64 under `b64_field` in `data` otherwise.
    /// `data` must be a JSON object (or null, which becomes one).
    pub fn with_bytes(mut self, cmd: &Command, b64_field: &str, bytes: Vec<u8>) -> Self {
        if cmd.binary_output {
            self.output = Some(bytes);
        } else {
            if self.data.is_null() {
                self.data = Value::Object(Default::default());
            }
            if let Value::Object(map) = &mut self.data {
                map.insert(
                    b64_field.to_owned(),
                    Value::String(crate::protocol::base64_encode(&bytes)),
                );
            }
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sidecar_never_serializes() {
        let cmd = Command::new("open", json!({"a": 1})).with_binary(Some(vec![1, 2, 3]));
        let text = serde_json::to_string(&cmd).unwrap();
        assert_eq!(text, r#"{"v":1,"op":"open","payload":{"a":1}}"#);
        let back: Command = serde_json::from_str(&text).unwrap();
        assert!(back.input.is_none() && !back.binary_output);
        let mut result = CommandResult::read_only(json!({"size": 3}));
        result.output = Some(vec![9]);
        assert_eq!(serde_json::to_string(&result).unwrap(), r#"{"events":[],"data":{"size":3}}"#);
    }

    #[test]
    fn bytes_input_takes_exactly_one_source() {
        let decode = |s: &str| crate::protocol::base64_decode(s);
        let mut b64 = Command::new("open", json!({"bytes_b64": "AQID"}));
        assert_eq!(b64.bytes_input("bytes_b64", decode).unwrap(), vec![1, 2, 3]);
        let mut raw = Command::new("open", json!({})).with_binary(Some(vec![4]));
        assert_eq!(raw.bytes_input("bytes_b64", decode).unwrap(), vec![4]);
        let mut both = Command::new("open", json!({"bytes_b64": "AQID"})).with_binary(Some(vec![4]));
        assert!(both.bytes_input("bytes_b64", decode).unwrap_err().message.contains("not both"));
        let mut none = Command::new("open", json!({}));
        assert!(none.bytes_input("bytes_b64", decode).is_err());
        let mut wrong = Command::new("open", json!({"bytes_b64": 5}));
        assert!(wrong.bytes_input("bytes_b64", decode).unwrap_err().message.contains("string"));
    }

    #[test]
    fn with_bytes_routes_by_request() {
        let json_cmd = Command::new("save", json!({}));
        let r = CommandResult::read_only(json!({"size": 2})).with_bytes(&json_cmd, "bytes_b64", vec![1, 2]);
        assert_eq!(r.data, json!({"size": 2, "bytes_b64": "AQI="}));
        assert!(r.output.is_none());
        let bin_cmd = json_cmd.with_binary(None);
        let r = CommandResult::read_only(json!({"size": 2})).with_bytes(&bin_cmd, "bytes_b64", vec![1, 2]);
        assert_eq!(r.data, json!({"size": 2}));
        assert_eq!(r.output, Some(vec![1, 2]));
    }
}
