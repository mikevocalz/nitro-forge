//! Freehand Ink and URI Link annotations (ISO 32000-1 §12.5.6.13/§12.5.6.18).
//!
//! Both ops share the `addAnnotation` contract: full validation before any
//! mutation, one journal entry, one `document:changed`, and the whole change
//! is staged on a cloned `Document` so a mid-build failure cannot corrupt
//! state. `/InkList` is the spec form — an array of paths, each an array of
//! alternating x/y coordinates (not path-painting operators).
use super::*;

/// Ink payload bounds: strokes per annotation, total points, coordinate
/// magnitude (same ±1 000 000 user-space limit as markup rectangles).
const MAX_INK_PATHS: usize = 64;
const MAX_INK_POINTS: usize = 2048;
const MAX_INK_COORD: f64 = 1_000_000.;
/// Ink stroke width in PDF points; `/BS /W` is a border width.
const MAX_INK_WIDTH: f64 = 100.;
/// URI actions: non-empty, bounded, one valid scheme, no whitespace/controls.
const MAX_URI_BYTES: usize = 2048;
const MAX_URI_SCHEME: usize = 32;

/// Verify the page's `/Annots` destination is well-formed before journaling,
/// mirroring the `addAnnotation` pre-flight.
fn check_annots(doc: &Document, page_id: ObjectId, loc: &AnnotsLoc) -> Result<(), EngineError> {
    match loc {
        AnnotsLoc::Inline => {
            doc.get_object(page_id)
                .and_then(|o| o.as_dict())
                .map_err(ser_err)?
                .get(b"Annots")
                .and_then(|o| o.as_array())
                .map_err(ser_err)?;
        }
        AnnotsLoc::Ref(r) => {
            doc.get_object(*r)
                .and_then(|o| o.as_array())
                .map_err(ser_err)?;
        }
        AnnotsLoc::Missing => {
            doc.get_object(page_id)
                .and_then(|o| o.as_dict())
                .map_err(ser_err)?;
        }
    }
    Ok(())
}

/// Append `annot` to the page's `/Annots` inside `doc` (inline array or
/// indirect array object) and return the new annotation's object id.
pub(super) fn attach(
    doc: &mut Document,
    page_id: ObjectId,
    loc: &AnnotsLoc,
    annot: lopdf::Dictionary,
) -> Result<ObjectId, EngineError> {
    let annot_id = doc.add_object(Object::Dictionary(annot));
    match loc {
        AnnotsLoc::Inline => {
            doc.get_object_mut(page_id)
                .and_then(|o| o.as_dict_mut())
                .map_err(ser_err)?
                .get_mut(b"Annots")
                .and_then(|o| o.as_array_mut())
                .map_err(ser_err)?
                .push(Object::Reference(annot_id));
        }
        AnnotsLoc::Ref(r) => {
            doc.get_object_mut(*r)
                .and_then(|o| o.as_array_mut())
                .map_err(ser_err)?
                .push(Object::Reference(annot_id));
        }
        AnnotsLoc::Missing => {
            doc.get_object_mut(page_id)
                .and_then(|o| o.as_dict_mut())
                .map_err(ser_err)?
                .set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        }
    }
    Ok(annot_id)
}

/// Optional `/Contents` plus caller-supplied author/date metadata, identical
/// rules to `addAnnotation`.
type CommentText = (Option<String>, Option<(String, String)>);

fn optional_text(p: &Value) -> Result<CommentText, EngineError> {
    let contents = match p.get("contents") {
        None | Some(Value::Null) => None,
        Some(_) => {
            let c = req_str(p, "contents")?;
            if c.encode_utf16().count() > 32767 {
                return Err(EngineError::validation(
                    "annotation contents exceeds 32767 UTF-16 units",
                ));
            }
            Some(c.to_string())
        }
    };
    let metadata = if p.get("author").is_some() || p.get("modified").is_some() {
        Some(comments::metadata(p)?)
    } else {
        None
    };
    Ok((contents, metadata))
}

fn apply_text(annot: &mut lopdf::Dictionary, contents: Option<String>, metadata: Option<(String, String)>) {
    if let Some(c) = contents {
        annot.set("Contents", lopdf::text_string(&c));
    }
    if let Some((author, modified)) = metadata {
        annot.set("T", lopdf::text_string(&author));
        annot.set("M", lopdf::text_string(&modified));
    }
}

/// `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` per RFC 3986, then
/// arbitrary non-whitespace, non-control URI characters.
fn valid_uri(uri: &str) -> bool {
    if uri.is_empty() || uri.len() > MAX_URI_BYTES {
        return false;
    }
    let Some(colon) = uri.find(':') else {
        return false;
    };
    let scheme = &uri[..colon];
    if scheme.is_empty()
        || scheme.len() > MAX_URI_SCHEME
        || !scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return false;
    }
    !uri.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl FolioEngine {
    /// Resolve the page and pre-validate its annots destination; returns the
    /// pieces `commit_annot` needs. Runs before any journal/object mutation.
    fn annots_target(&self, page: u64) -> Result<(ObjectId, AnnotsLoc), EngineError> {
        let page_id = self.page_id(page)?;
        let loc = annots_loc(&self.doc, page_id)?;
        check_annots(&self.doc, page_id, &loc)?;
        Ok((page_id, loc))
    }

    /// Stage `annot` on a cloned document, then record undo and commit —
    /// atomic even if attachment fails partway.
    fn commit_annot(
        &mut self,
        page_id: ObjectId,
        loc: &AnnotsLoc,
        annot: lopdf::Dictionary,
    ) -> Result<ObjectId, EngineError> {
        let mut next = self.doc.clone();
        let annot_id = attach(&mut next, page_id, loc, annot)?;
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(annot_id)
    }

    /// `addInkAnnotation {page, paths, color?, width?, opacity?, contents?,
    /// author?, modified?}` → `{annot_id}`. `paths` is an array of strokes;
    /// each stroke is an array of at least 2 `[x, y]` points (PDF user
    /// space). At most
    /// 64 strokes / 2048 points total; coordinates finite within ±1 000 000.
    /// `color` is an optional `[r, g, b]` triplet in 0..=1 (`/C`); `width`
    /// is the `/BS /W` stroke width in points (default 1, max 100); `opacity`
    /// 0..=1 emits `/CA`. `/Rect` is the stroke bounding box padded by half
    /// the stroke width (minimum 1 pt).
    pub(super) fn op_add_ink(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (page_id, loc) = self.annots_target(req_u64(p, "page")?)?;
        let paths_v = field(p, "paths")?
            .as_array()
            .ok_or_else(|| EngineError::invalid("'paths' must be an array of strokes"))?;
        if paths_v.is_empty() || paths_v.len() > MAX_INK_PATHS {
            return Err(EngineError::validation(format!(
                "'paths' must contain 1..={MAX_INK_PATHS} strokes"
            )));
        }
        let mut ink_list = Vec::with_capacity(paths_v.len());
        let mut total = 0usize;
        let mut min = [f64::MAX; 2];
        let mut max = [f64::MIN; 2];
        for stroke in paths_v {
            let pts = stroke.as_array().ok_or_else(|| {
                EngineError::invalid("each 'paths' entry must be an array of [x, y] points")
            })?;
            if pts.len() < 2 {
                return Err(EngineError::validation(
                    "each ink stroke needs at least 2 points",
                ));
            }
            total += pts.len();
            if total > MAX_INK_POINTS {
                return Err(EngineError::validation(format!(
                    "ink annotation exceeds {MAX_INK_POINTS} total points"
                )));
            }
            let mut coords = Vec::with_capacity(pts.len() * 2);
            for pt in pts {
                let xy = pt.as_array().ok_or_else(|| {
                    EngineError::invalid("ink points must be [x, y] pairs")
                })?;
                if xy.len() != 2 {
                    return Err(EngineError::invalid("ink points must be [x, y] pairs"));
                }
                let mut pair = [0f32; 2];
                for (i, v) in xy.iter().enumerate() {
                    let f = v.as_f64().ok_or_else(|| {
                        EngineError::invalid("ink point coordinates must be numbers")
                    })?;
                    if !f.is_finite()
                        || !((f as f32).is_finite())
                        || f.abs() > MAX_INK_COORD
                    {
                        return Err(EngineError::validation(
                            "ink coordinates must be finite within +/-1000000 PDF units",
                        ));
                    }
                    pair[i] = f as f32;
                    if f < min[i] {
                        min[i] = f;
                    }
                    if f > max[i] {
                        max[i] = f;
                    }
                }
                coords.push(Object::Real(pair[0]));
                coords.push(Object::Real(pair[1]));
            }
            ink_list.push(Object::Array(coords));
        }
        let color = match p.get("color") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let c = v.as_array().ok_or_else(|| {
                    EngineError::invalid("'color' must be an [r, g, b] array")
                })?;
                if c.len() != 3 {
                    return Err(EngineError::invalid("'color' must have exactly 3 elements"));
                }
                let mut rgb = [0f32; 3];
                for (i, v) in c.iter().enumerate() {
                    let f = v.as_f64().ok_or_else(|| {
                        EngineError::invalid("'color' elements must be numbers")
                    })?;
                    if !f.is_finite() || !(0.0..=1.0).contains(&f) {
                        return Err(EngineError::validation(
                            "'color' components must be finite numbers in 0..=1",
                        ));
                    }
                    rgb[i] = f as f32;
                }
                Some(rgb)
            }
        };
        let width = match p.get("width") {
            None | Some(Value::Null) => 1.0,
            Some(v) => {
                let f = v.as_f64().ok_or_else(|| {
                    EngineError::invalid("'width' must be a number")
                })?;
                if !f.is_finite() || f <= 0.0 || f > MAX_INK_WIDTH {
                    return Err(EngineError::validation(format!(
                        "'width' must be a finite number in (0, {MAX_INK_WIDTH}]"
                    )));
                }
                f
            }
        };
        let opacity = match p.get("opacity") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let f = v.as_f64().ok_or_else(|| {
                    EngineError::invalid("'opacity' must be a number")
                })?;
                if !f.is_finite() || !(0.0..=1.0).contains(&f) {
                    return Err(EngineError::validation(
                        "'opacity' must be a finite number in 0..=1",
                    ));
                }
                Some(f as f32)
            }
        };
        let (contents, metadata) = optional_text(p)?;
        // /Rect: stroke bounds padded by half the width, at least 1 pt, so a
        // single-point stroke still yields a nondegenerate rectangle.
        let pad = (width as f64 / 2.0).max(1.0);
        let rect = vec![
            Object::Real((min[0] - pad) as f32),
            Object::Real((min[1] - pad) as f32),
            Object::Real((max[0] + pad) as f32),
            Object::Real((max[1] + pad) as f32),
        ];
        let mut annot = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Ink",
            "Rect" => Object::Array(rect),
            "InkList" => Object::Array(ink_list),
            "BS" => dictionary! { "Type" => "Border", "W" => Object::Real(width as f32), "S" => "S" },
        };
        if let Some(rgb) = color {
            annot.set(
                "C",
                Object::Array(rgb.into_iter().map(Object::Real).collect()),
            );
        }
        if let Some(o) = opacity {
            annot.set("CA", Object::Real(o));
        }
        apply_text(&mut annot, contents, metadata);
        let annot_id = self.commit_annot(page_id, &loc, annot)?;
        Ok(CommandResult::data(json!({ "annot_id": annot_id.0 })))
    }

    /// `addLinkAnnotation {page, rect, uri, contents?, author?, modified?}` →
    /// `{annot_id}`. `/Subtype /Link` with `/A << /S /URI /URI (…) >>`; `rect`
    /// is `[x, y, w, h]` in PDF user space and must be positive, nondegenerate
    /// and within ±1 000 000 like shape annotations. The URI needs a valid
    /// RFC 3986 scheme, is non-empty, at most 2048 bytes, and carries no
    /// whitespace or control characters. `/BS /W 0` keeps the link border
    /// invisible; viewers still render the URI affordance.
    pub(super) fn op_add_link(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let (page_id, loc) = self.annots_target(req_u64(p, "page")?)?;
        let rect = req_rect(p)?;
        let uri = req_str(p, "uri")?;
        if !valid_uri(uri) {
            return Err(EngineError::validation(
                "'uri' must be a non-empty URI (≤2048 bytes) with a valid scheme and no whitespace or control characters",
            ));
        }
        let [x1, y1, x2, y2] = markup::checked_rect(rect)?;
        let (contents, metadata) = optional_text(p)?;
        let mut annot = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Link",
            "Rect" => Object::Array(vec![
                Object::Real(x1),
                Object::Real(y1),
                Object::Real(x2),
                Object::Real(y2),
            ]),
            "A" => dictionary! { "S" => "URI", "URI" => lopdf::text_string(uri) },
            "BS" => dictionary! { "Type" => "Border", "W" => 0, "S" => "S" },
        };
        apply_text(&mut annot, contents, metadata);
        let annot_id = self.commit_annot(page_id, &loc, annot)?;
        Ok(CommandResult::data(json!({ "annot_id": annot_id.0 })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn engine() -> FolioEngine {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({"pages":2}));
        e
    }
    fn annot_dict(e: &FolioEngine, id: u64) -> lopdf::Dictionary {
        e.doc
            .get_object((id as u32, 0))
            .unwrap()
            .as_dict()
            .unwrap()
            .clone()
    }

    #[test]
    fn ink_annotation_dict_save_reopen_list_and_history() {
        let mut e = engine();
        let id = apply(
            &mut e,
            "addInkAnnotation",
            json!({"page":0,"paths":[[[10,20],[30,40],[50,20]],[[100,100],[110,90]]],"color":[1,0,0],"width":2.5,"opacity":0.5,"contents":"scribble"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let d = annot_dict(&e, id);
        assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
        assert_eq!(d.get(b"Type").unwrap().as_name().unwrap(), b"Annot");
        let ink = d.get(b"InkList").unwrap().as_array().unwrap();
        assert_eq!(ink.len(), 2);
        let path0 = ink[0].as_array().unwrap();
        // alternating x/y pairs for three points
        assert_eq!(path0.len(), 6);
        assert_eq!(path0[0].as_float().unwrap(), 10.0);
        assert_eq!(path0[5].as_float().unwrap(), 20.0);
        let bs = d.get(b"BS").unwrap().as_dict().unwrap();
        assert_eq!(bs.get(b"W").unwrap().as_float().unwrap(), 2.5);
        let c = d.get(b"C").unwrap().as_array().unwrap();
        assert_eq!(c[0].as_float().unwrap(), 1.0);
        assert_eq!(d.get(b"CA").unwrap().as_float().unwrap(), 0.5);
        assert_eq!(
            lopdf::decode_text_string(d.get(b"Contents").unwrap()).unwrap(),
            "scribble"
        );
        // /Rect is the stroke bounds padded by half the width (min 1 pt).
        let rect = d.get(b"Rect").unwrap().as_array().unwrap();
        let nums: Vec<f32> = rect.iter().map(|o| o.as_float().unwrap()).collect();
        // points span x 10..110, y 20..100; pad = max(2.5/2, 1) = 1.25
        assert_eq!(nums, vec![8.75, 18.75, 111.25, 101.25]);

        let listed = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(listed["annots"][0]["subtype"], "Ink");
        assert_eq!(listed["annots"][0]["contents"], "scribble");

        // save → open → list round-trips the real PDF objects.
        let saved = apply(&mut e, "save", json!({}));
        let bytes = b64_decode(saved["bytes_b64"].as_str().unwrap()).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        let mut reopened = FolioEngine::new();
        apply(
            &mut reopened,
            "open",
            json!({"bytes_b64":saved["bytes_b64"]}),
        );
        let relisted = apply(&mut reopened, "listAnnotations", json!({"page":0}));
        assert_eq!(relisted["annots"][0]["subtype"], "Ink");
        let rid = relisted["annots"][0]["id"].as_u64().unwrap();
        let rd = annot_dict(&reopened, rid);
        assert_eq!(rd.get(b"InkList").unwrap().as_array().unwrap().len(), 2);
        assert_eq!(rd.get(b"CA").unwrap().as_float().unwrap(), 0.5);

        // snapshot restore preserves it; undo/redo removes and restores it.
        let snap = e.snapshot().unwrap();
        let mut restored = FolioEngine::new();
        restored.restore(&snap).unwrap();
        assert_eq!(
            apply(&mut restored, "listAnnotations", json!({"page":0}))["annots"][0]["subtype"],
            "Ink"
        );
        assert!(e.undo().unwrap());
        assert!(annot_ids(&e.doc, e.page_id(0).unwrap())
            .unwrap()
            .is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(annot_dict(&e, id).get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
        // generic removeAnnotation still owns the ink subtree.
        apply(&mut e, "removeAnnotation", json!({"page":0,"id":id}));
        assert!(annot_ids(&e.doc, e.page_id(0).unwrap())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn ink_defaults_and_minimal_payload() {
        let mut e = engine();
        let id = apply(
            &mut e,
            "addInkAnnotation",
            json!({"page":1,"paths":[[[0,0],[612,792]]]}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let d = annot_dict(&e, id);
        assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(), b"Ink");
        let bs = d.get(b"BS").unwrap().as_dict().unwrap();
        assert_eq!(bs.get(b"W").unwrap().as_float().unwrap(), 1.0);
        assert!(d.get(b"C").is_err());
        assert!(d.get(b"CA").is_err());
        assert!(d.get(b"Contents").is_err());
        // pad = max(1/2, 1) = 1 → rect [-1,-1,613,793]
        let rect = d.get(b"Rect").unwrap().as_array().unwrap();
        let nums: Vec<f32> = rect.iter().map(|o| o.as_float().unwrap()).collect();
        assert_eq!(nums, vec![-1.0, -1.0, 613.0, 793.0]);
    }

    #[test]
    fn ink_bounds_and_bad_fields_reject_atomically() {
        let mut e = engine();
        apply(
            &mut e,
            "addInkAnnotation",
            json!({"page":0,"paths":[[[0,0],[1,1]]]}),
        );
        assert!(e.undo().unwrap());
        let before = e.serialize_doc().unwrap();
        let good = json!({"page":0,"paths":[[[0,0],[1,1]]]});
        let mut cases: Vec<Value> = vec![
            // 65 paths
            json!({"page":0,"paths":vec![json!([[0,0],[1,1]]);65]}),
            // 2049 points across two strokes
            json!({"page":0,"paths":[vec![json!([0,0]);2048],[[0,0],[1,1]]]}),
            // empty paths / empty stroke / bad point shapes
            json!({"page":0,"paths":[]}),
            json!({"page":0,"paths":[[]]}),
            json!({"page":0,"paths":[[[0,0]]]}),
            json!({"page":0,"paths":[[[0],[1,1]]]}),
            json!({"page":0,"paths":[[[0,0,0],[1,1]]]}),
            json!({"page":0,"paths":[[[0,"x"],[1,1]]]}),
            // non-finite / out-of-range coordinates
            json!({"page":0,"paths":[[[0,0],[1e308,1]]]}),
            json!({"page":0,"paths":[[[0,0],[1e6+1.0,1]]]}),
            // bad color / width / opacity / page
            json!({"page":0,"paths":[[[0,0],[1,1]]],"color":[1,0]}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"color":[1.5,0,0]}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"color":[0,0,"red"]}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"width":0}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"width":-2}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"width":101}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"opacity":1.5}),
            json!({"page":0,"paths":[[[0,0],[1,1]]],"opacity":"half"}),
            json!({"page":9,"paths":[[[0,0],[1,1]]]}),
            json!({"page":0}),
        ];
        cases.push(good.clone()); // sanity: valid payload still works later
        for (i, p) in cases.iter().enumerate().take(cases.len() - 1) {
            let _ = i;
            assert!(
                e.apply(Command::new("addInkAnnotation", p.clone())).is_err(),
                "case {p} should reject"
            );
            assert_eq!(e.serialize_doc().unwrap(), before);
        }
        // redo path still intact
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"][0]["subtype"],
            "Ink"
        );
    }

    #[test]
    fn link_annotation_dict_uri_list_and_history() {
        let mut e = engine();
        let id = apply(
            &mut e,
            "addLinkAnnotation",
            json!({"page":0,"rect":[10,20,110,40],"uri":"https://example.com/spec?q=1&r=2"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let d = annot_dict(&e, id);
        assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(), b"Link");
        let action = d.get(b"A").unwrap().as_dict().unwrap();
        assert_eq!(action.get(b"S").unwrap().as_name().unwrap(), b"URI");
        assert_eq!(
            lopdf::decode_text_string(action.get(b"URI").unwrap()).unwrap(),
            "https://example.com/spec?q=1&r=2"
        );
        // [x,y,w,h] → /Rect [x1,y1,x2,y2]
        let rect = d.get(b"Rect").unwrap().as_array().unwrap();
        let nums: Vec<f32> = rect.iter().map(|o| o.as_float().unwrap()).collect();
        assert_eq!(nums, vec![10.0, 20.0, 120.0, 60.0]);
        let listed = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(listed["annots"][0]["subtype"], "Link");
        assert_eq!(
            listed["annots"][0]["uri"],
            "https://example.com/spec?q=1&r=2"
        );
        assert!(listed["annots"][0].get("dest").is_none());

        // Explicit /Dest surfaces in listAnnotations.
        e.doc
            .get_object_mut((id as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Dest", Object::Name(b"chapter1".to_vec()));
        let listed = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(listed["annots"][0]["dest"], "chapter1");

        // Real PDF round-trip.
        let saved = apply(&mut e, "save", json!({}));
        let mut reopened = FolioEngine::new();
        apply(
            &mut reopened,
            "open",
            json!({"bytes_b64":saved["bytes_b64"]}),
        );
        let relisted = apply(&mut reopened, "listAnnotations", json!({"page":0}));
        assert_eq!(relisted["annots"][0]["subtype"], "Link");
        assert_eq!(
            relisted["annots"][0]["uri"],
            "https://example.com/spec?q=1&r=2"
        );
        assert_eq!(relisted["annots"][0]["dest"], "chapter1");

        assert!(e.undo().unwrap());
        assert!(annot_ids(&e.doc, e.page_id(0).unwrap())
            .unwrap()
            .is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(annot_dict(&e, id).get(b"Subtype").unwrap().as_name().unwrap(), b"Link");
    }

    #[test]
    fn link_uri_and_rect_validation_reject_atomically() {
        let mut e = engine();
        let before = e.serialize_doc().unwrap();
        for uri in [
            "",
            "no-scheme",
            "1http://x",
            "ht tp://x",
            "http://exa mple.com",
            "http://x\u{7}",
            "http://x\u{85}",
            "+foo://x",
            "a_b://x",
            &format!("https://example.com/{}", "x".repeat(2050)),
        ] {
            assert!(
                e.apply(Command::new(
                    "addLinkAnnotation",
                    json!({"page":0,"rect":[1,2,3,4],"uri":uri})
                ))
                .is_err(),
                "uri {uri:?} should reject"
            );
            assert_eq!(e.serialize_doc().unwrap(), before);
        }
        for rect in [
            [0., 0., 0., 1.],
            [0., 0., 1., -1.],
            [1e6, 0., 1., 1.],
            [1e308, 0., 1., 1.],
        ] {
            assert!(e
                .apply(Command::new(
                    "addLinkAnnotation",
                    json!({"page":0,"rect":rect,"uri":"https://example.com"})
                ))
                .is_err());
            assert_eq!(e.serialize_doc().unwrap(), before);
        }
        assert!(e
            .apply(Command::new(
                "addLinkAnnotation",
                json!({"page":9,"rect":[1,2,3,4],"uri":"https://example.com"})
            ))
            .is_err());
        assert_eq!(e.serialize_doc().unwrap(), before);
        // valid schemes pass: mailto, custom +.- scheme chars, unicode path
        for uri in [
            "mailto:a@b.c",
            "my-app.v2+x://host/path",
            "https://example.com/東京?q=値",
        ] {
            let r = e.apply(Command::new(
                "addLinkAnnotation",
                json!({"page":0,"rect":[1,2,3,4],"uri":uri}),
            ));
            assert!(r.is_ok(), "uri {uri:?} should pass: {:?}", r.err());
        }
        // three successful links → three annots; undo removes only the last.
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(e.undo().unwrap());
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}
