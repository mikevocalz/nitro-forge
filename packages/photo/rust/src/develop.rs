//! Bounded straight RGBA8 sRGB preview processing. Not a RAW decoder or color-management system.
use super::*;
use ignition_core::{base64_decode, base64_encode, TaskContext};
const MAX_PIXELS: u64 = 1_048_576;
const MAX_SIDE: u64 = 4096;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Develop {
    pub schema: u32,
    pub exposure_ev: f64,
    pub contrast: f64,
    pub rgb_gain: [f64; 3],
}
impl Default for Develop {
    fn default() -> Self {
        Self {
            schema: 1,
            exposure_ev: 0.0,
            contrast: 1.0,
            rgb_gain: [1.0; 3],
        }
    }
}
impl Develop {
    pub(super) fn validate(&self) -> Result<(), EngineError> {
        if self.schema != 1
            || !self.exposure_ev.is_finite()
            || !(-8.0..=8.0).contains(&self.exposure_ev)
            || !self.contrast.is_finite()
            || !(0.0..=4.0).contains(&self.contrast)
            || self
                .rgb_gain
                .iter()
                .any(|g| !g.is_finite() || !(0.0..=8.0).contains(g))
        {
            return Err(bad("unsupported or invalid develop recipe"));
        }
        Ok(())
    }
    pub(super) fn is_identity(&self) -> bool {
        self == &Self::default()
    }
}
fn linear(value: u8) -> f64 {
    let value = f64::from(value) / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}
fn encoded(value: f64) -> u8 {
    let value = value.clamp(0.0, 1.0);
    let value = if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (value * 255.0).round().clamp(0.0, 255.0) as u8
}
impl PhotoEngine {
    pub(super) fn read_develop(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let version = self
            .state
            .versions
            .get(text(p, "id")?)
            .ok_or_else(|| EngineError::not_found("version not found"))?;
        Ok(readonly(json!({"develop":version.develop})))
    }
    pub(super) fn set_develop(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let id = text(p, "id")?;
        let develop: Develop = serde_json::from_value(
            p.get("develop")
                .cloned()
                .ok_or_else(|| bad("develop recipe required"))?,
        )?;
        develop.validate()?;
        let mut next = (*self.state).clone();
        let version = next
            .versions
            .get_mut(id)
            .ok_or_else(|| EngineError::not_found("version not found"))?;
        Arc::make_mut(version).develop = develop;
        self.replace(next, json!({"ok":true}))
    }
    pub(super) fn process_preview(
        &self,
        mut command: Command,
        ctx: Option<&TaskContext>,
    ) -> Result<CommandResult, EngineError> {
        if let Some(ctx) = ctx {
            ctx.checkpoint()?;
        }
        let p = &command.payload;
        let version_id = text(p, "version_id")?;
        let original_id = text(p, "original_id")?;
        let hash = text(p, "original_sha256")?;
        let version = self
            .state
            .versions
            .get(version_id)
            .ok_or_else(|| EngineError::not_found("version not found"))?;
        let original = self
            .state
            .originals
            .get(original_id)
            .ok_or_else(|| EngineError::not_found("original not found"))?;
        if version.original_id != original_id || original.sha256 != hash {
            return Err(bad("preview original/version identity mismatch"));
        }
        let expected: Develop = serde_json::from_value(
            p.get("expected_develop")
                .cloned()
                .ok_or_else(|| bad("expected_develop required"))?,
        )?;
        expected.validate()?;
        if expected != version.develop {
            return Err(bad("preview develop recipe changed"));
        }
        if text(p, "format")? != "rgba8-straight-srgb" {
            return Err(EngineError::unsupported(
                "preview format must be rgba8-straight-srgb",
            ));
        }
        let width = p
            .get("width")
            .and_then(Value::as_u64)
            .ok_or_else(|| bad("width must be an integer"))?;
        let height = p
            .get("height")
            .and_then(Value::as_u64)
            .ok_or_else(|| bad("height must be an integer"))?;
        let pixels = width
            .checked_mul(height)
            .filter(|n| *n > 0 && *n <= MAX_PIXELS && width <= MAX_SIDE && height <= MAX_SIDE)
            .ok_or_else(|| bad("preview exceeds side/pixel budget"))?;
        let length = (pixels * 4) as usize;
        // Preflight encoded/binary lengths before decoding or allocating the processing buffer.
        if command
            .input
            .as_ref()
            .is_some_and(|bytes| bytes.len() != length)
        {
            return Err(bad(
                "preview byte length does not match packed RGBA dimensions",
            ));
        }
        if let Some(Value::String(encoded)) = p.get("pixels_b64") {
            if encoded.len() > length.div_ceil(3) * 4 {
                return Err(bad("preview base64 exceeds declared RGBA byte budget"));
            }
        }
        let mut data = readonly(
            json!({"version_id":version_id,"original_id":original_id,"original_sha256":hash,"develop":expected,"format":"rgba8-straight-srgb","width":width,"height":height,"row_stride":width*4}),
        );
        let mut bytes = command.bytes_input("pixels_b64", base64_decode)?;
        if bytes.len() != length {
            return Err(bad(
                "preview byte length does not match packed RGBA dimensions",
            ));
        }
        if !expected.is_identity() {
            let exposure = 2.0f64.powf(expected.exposure_ev);
            for (index, pixel) in bytes.chunks_exact_mut(4).enumerate() {
                if index % 4096 == 0 {
                    if let Some(ctx) = ctx {
                        ctx.checkpoint()?;
                        ctx.set_progress(index as f32 / pixels as f32);
                    }
                }
                for channel in 0..3 {
                    let value = linear(pixel[channel]) * exposure * expected.rgb_gain[channel];
                    pixel[channel] = encoded((value - 0.18) * expected.contrast + 0.18);
                }
                // Straight alpha is retained byte-for-byte; hidden RGB is still processed.
            }
        }
        if command.binary_output {
            data.output = Some(bytes);
        } else {
            data.data["pixels_b64"] = json!(base64_encode(&bytes));
        }
        if let Some(ctx) = ctx {
            ctx.checkpoint()?;
            ctx.set_progress(1.0);
        }
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PhotoEngine {
        let mut e = PhotoEngine::new();
        e.apply(Command::new("addOriginal",json!({"sha256":"a".repeat(64),"asset_ref":"retained:raw","byte_length":20,"camera_make":"Pentax","camera_model":"K-7"}))).unwrap();
        e
    }
    fn recipe(exposure_ev: f64, contrast: f64, rgb_gain: [f64; 3]) -> Develop {
        Develop {
            schema: 1,
            exposure_ev,
            contrast,
            rgb_gain,
        }
    }
    fn set(e: &mut PhotoEngine, develop: &Develop) {
        e.apply(Command::new(
            "setDevelop",
            json!({"id":"version-2","develop":develop}),
        ))
        .unwrap();
    }
    fn command(develop: &Develop, bytes: Vec<u8>) -> Command {
        Command::new("processPreview",json!({"version_id":"version-2","original_id":"original-1","original_sha256":"a".repeat(64),"expected_develop":develop,"format":"rgba8-straight-srgb","width":bytes.len()/4,"height":1})).with_binary(Some(bytes))
    }
    #[test]
    fn actual_linear_processing_matches_known_srgb_pixels_and_preserves_alpha() {
        let mut e = fixture();
        for (settings, input, expected) in [
            (
                recipe(1.0, 1.0, [1.0; 3]),
                vec![128, 64, 32, 99],
                vec![176, 90, 47, 99],
            ),
            (
                recipe(-1.0, 1.0, [1.0; 3]),
                vec![255, 255, 255, 128],
                vec![188, 188, 188, 128],
            ),
            (
                recipe(0.0, 1.0, [2.0, 0.0, 1.0]),
                vec![64, 128, 255, 0],
                vec![90, 0, 255, 0],
            ),
            (
                recipe(0.0, 0.0, [1.0; 3]),
                vec![0, 128, 255, 255],
                vec![118, 118, 118, 255],
            ),
            (
                recipe(8.0, 4.0, [8.0; 3]),
                vec![255, 255, 255, 7],
                vec![255, 255, 255, 7],
            ),
        ] {
            set(&mut e, &settings);
            let before = e.snapshot().unwrap();
            let result = e.apply(command(&settings, input)).unwrap();
            assert!(result.events.is_empty());
            assert_eq!(result.output.unwrap(), expected);
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }
    #[test]
    fn identity_is_byte_exact_binary_and_json_agree_and_do_not_mutate_history() {
        let mut e = fixture();
        let identity = Develop::default();
        let input: Vec<u8> = (0..=255).flat_map(|n| [n, 255 - n, n / 2, n]).collect();
        let before = e.snapshot().unwrap();
        let binary = e.apply(command(&identity, input.clone())).unwrap();
        assert_eq!(binary.output.unwrap(), input);
        let mut json_command = command(&identity, input.clone());
        json_command.input = None;
        json_command.binary_output = false;
        json_command.payload["pixels_b64"] = json!(base64_encode(&input));
        let result = e.apply(json_command).unwrap();
        assert!(result.output.is_none());
        assert_eq!(
            base64_decode(result.data["pixels_b64"].as_str().unwrap()).unwrap(),
            input
        );
        assert_eq!(e.snapshot().unwrap(), before);
        assert!(e.undo().unwrap());
        assert!(e.state.originals.is_empty());
    }
    #[test]
    fn recipes_persist_validate_legacy_defaults_and_preserve_redo() {
        let mut e = fixture();
        let legacy = e.snapshot().unwrap();
        let settings = recipe(1.0, 2.0, [1.0, 0.8, 1.2]);
        set(&mut e, &settings);
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        let noop = e
            .apply(Command::new(
                "setDevelop",
                json!({"id":"version-2","develop":Develop::default()}),
            ))
            .unwrap();
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        let mut reopened = PhotoEngine::new();
        reopened.restore(&changed).unwrap();
        assert_eq!(reopened.state.versions["version-2"].develop, settings);
        reopened.restore(&legacy).unwrap();
        assert!(reopened.state.versions["version-2"].develop.is_identity());
        assert_eq!(reopened.snapshot().unwrap(), legacy);
        let before = e.snapshot().unwrap();
        for invalid in [
            json!({"schema":2,"exposure_ev":0,"contrast":1,"rgb_gain":[1,1,1]}),
            json!({"schema":1,"exposure_ev":9,"contrast":1,"rgb_gain":[1,1,1]}),
            json!({"schema":1,"exposure_ev":0,"contrast":-1,"rgb_gain":[1,1,1]}),
            json!({"schema":1,"exposure_ev":0,"contrast":1,"rgb_gain":[1,9,1]}),
            json!({"schema":1,"exposure_ev":null,"contrast":1,"rgb_gain":[1,1,1]}),
        ] {
            assert!(e
                .apply(Command::new(
                    "setDevelop",
                    json!({"id":"version-2","develop":invalid})
                ))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        let mut invalid = serde_json::to_value(&*e.state).unwrap();
        invalid["versions"]["version-2"]["develop"]["contrast"] = json!(-1);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn identity_stale_recipe_format_byte_limits_and_cancel_reject_without_mutation() {
        let mut e = fixture();
        let before = e.snapshot().unwrap();
        for (field, value) in [
            ("original_id", json!("missing")),
            ("original_sha256", json!("b".repeat(64))),
            ("expected_develop", json!(recipe(1.0, 1.0, [1.0; 3]))),
            ("format", json!("rgba8-linear-premultiplied")),
            ("width", json!(4097)),
            ("height", json!(0)),
        ] {
            let mut cmd = command(&Develop::default(), vec![1, 2, 3, 4]);
            cmd.payload[field] = value;
            assert!(e.apply(cmd).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        let mut cmd = command(&Develop::default(), vec![1, 2, 3, 4]);
        cmd.payload["pixels_b64"] = json!("AQIDBA==");
        assert!(e.apply(cmd).is_err());
        let mut cmd = command(&Develop::default(), vec![1, 2, 3, 4]);
        cmd.input = Some(vec![1, 2, 3]);
        assert!(e.apply(cmd).is_err());
        let mut cmd = command(&Develop::default(), vec![1, 2, 3, 4]);
        cmd.payload["width"] = json!(2048);
        cmd.payload["height"] = json!(2048);
        assert!(e.apply(cmd).is_err());
        let context = TaskContext::new();
        context.cancel();
        assert!(e
            .apply_long(command(&Develop::default(), vec![1, 2, 3, 4]), &context)
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
}
