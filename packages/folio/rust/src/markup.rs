//! ISO 32000-1 Table 179: one +X text quad in default PDF user space.
//! No inferred glyph selection, page rotation transform or appearance stream.
use super::*;
pub(super) fn quad(rect: [f64; 4], markup: bool) -> Result<Option<Vec<Object>>, EngineError> {
    let [x, y, w, h] = rect;
    let coords = [x, y, x + w, y + h];
    if coords
        .iter()
        .any(|v| !v.is_finite() || !(*v as f32).is_finite())
    {
        return Err(EngineError::validation(
            "annotation rectangle exceeds PDF numeric representation",
        ));
    }
    if !markup {
        return Ok(None);
    }
    let [left, bottom, right, top] = coords.map(|v| v as f32);
    if w <= 0.
        || h <= 0.
        || coords.iter().any(|v| v.abs() > 1_000_000.)
        || left >= right
        || bottom >= top
    {
        return Err(EngineError::validation(
            "markup requires positive nondegenerate rectangle within +/-1000000 PDF units",
        ));
    }
    // Counterclockwise BL, BR, TR, TL. First edge defines +X text direction.
    Ok(Some(
        [left, bottom, right, bottom, right, top, left, top]
            .into_iter()
            .map(Object::Real)
            .collect(),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn points(e: &FolioEngine) -> Vec<f32> {
        let page = e.page_id(0).unwrap();
        let ids = annot_ids(&e.doc, page).unwrap();
        e.doc
            .get_object(*ids.last().unwrap())
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"QuadPoints")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o.as_float().unwrap())
            .collect()
    }
    #[test]
    fn actual_markup_pdf_geometry_history_save_and_reopen() {
        for subtype in ["Highlight", "Underline", "StrikeOut"] {
            let mut e = FolioEngine::new();
            apply(&mut e, "new", json!({"pages":1}));
            apply(
                &mut e,
                "addAnnotation",
                json!({"page":0,"rect":[10,20,30,40],"contents":"mark","subtype":subtype}),
            );
            let expected = vec![10., 20., 40., 20., 40., 60., 10., 60.];
            assert_eq!(points(&e), expected);
            let object = annot_ids(&e.doc, e.page_id(0).unwrap()).unwrap()[0];
            let d = e.doc.get_object(object).unwrap().as_dict().unwrap();
            assert!(d.get(b"AP").is_err());
            if subtype != "Highlight" {
                assert!(e
                    .apply(Command::new(
                        "setAnnotationContents",
                        json!({"page":0,"id":object.0,"contents":"edited"})
                    ))
                    .is_err());
            }
            let saved = apply(&mut e, "save", json!({}));
            let mut reopened = FolioEngine::new();
            apply(
                &mut reopened,
                "open",
                json!({"bytes_b64":saved["bytes_b64"]}),
            );
            assert_eq!(points(&reopened), expected);
            assert_eq!(
                apply(&mut reopened, "listAnnotations", json!({"page":0}))["annots"][0]["subtype"],
                subtype
            );
            let snapshot = e.snapshot().unwrap();
            reopened.restore(&snapshot).unwrap();
            assert_eq!(points(&reopened), expected);
            assert!(e.undo().unwrap());
            assert!(annot_ids(&e.doc, e.page_id(0).unwrap()).unwrap().is_empty());
            assert!(e.redo().unwrap());
            assert_eq!(points(&e), expected);
        }
    }
    #[test]
    fn invalid_markup_preserves_document_and_redo() {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({"pages":1}));
        apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[1,2,3,4],"contents":"ok","subtype":"Highlight"}),
        );
        assert!(e.undo().unwrap());
        let before = e.serialize_doc().unwrap();
        for rect in [
            [0., 0., 0., 1.],
            [0., 0., 1., -1.],
            [1e6, 0., 1., 1.],
            [1., 1., 1e-12, 1.],
            [1e308, 0., 1e308, 1.],
        ] {
            for subtype in ["Highlight", "Underline", "StrikeOut"] {
                assert!(e
                    .apply(Command::new(
                        "addAnnotation",
                        json!({"page":0,"rect":rect,"contents":"bad","subtype":subtype})
                    ))
                    .is_err());
                assert_eq!(e.serialize_doc().unwrap(), before);
            }
        }
        assert!(e.redo().unwrap());
        assert_eq!(points(&e).len(), 8);
    }
}
