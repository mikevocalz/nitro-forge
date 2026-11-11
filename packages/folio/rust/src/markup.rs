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
            "annotation requires positive nondegenerate rectangle within +/-1000000 PDF units",
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
/// Positive, bounded, f32-representable `[x, y, w, h]` caller rectangle,
/// returned as PDF `/Rect` corners `[x1, y1, x2, y2]`. Shared by annotations
/// that carry geometry without `/QuadPoints` (Link, computed Ink bounds).
pub(super) fn checked_rect(rect: [f64; 4]) -> Result<[f32; 4], EngineError> {
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
    let [left, bottom, right, top] = coords.map(|v| v as f32);
    if w <= 0.
        || h <= 0.
        || coords.iter().any(|v| v.abs() > 1_000_000.)
        || left >= right
        || bottom >= top
    {
        return Err(EngineError::validation(
            "annotation requires positive nondegenerate rectangle within +/-1000000 PDF units",
        ));
    }
    Ok([left, bottom, right, top])
}
// Shape dictionaries emit PDF1.4 IC; preserve higher headers and catalog metadata.
pub(super) fn shape_version(current: &str) -> Result<String,EngineError> {
    let (major,minor)=current.split_once('.').ok_or_else(||EngineError::validation("unknown PDF header version"))?;
    let major=major.parse::<u16>().map_err(|_|EngineError::validation("unknown PDF header version"))?;
    let minor=minor.parse::<u16>().map_err(|_|EngineError::validation("unknown PDF header version"))?;
    if major==0 {return Err(EngineError::validation("unknown PDF header version"));}
    Ok(if major==1 && minor<4 {"1.4".into()} else {current.into()})
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
    #[test]
    fn actual_shape_dictionaries_save_reopen_delete_and_history() {
        for subtype in ["Square", "Circle"] {
            let mut e=FolioEngine::new();apply(&mut e,"new",json!({"pages":1}));
            let id=apply(&mut e,"addAnnotation",json!({"page":0,"rect":[10,20,30,40],"contents":"Shape","subtype":subtype}))["annot_id"].as_u64().unwrap();
            let inspect=|engine:&FolioEngine|{
                let d=engine.doc.get_object((id as u32,0)).unwrap().as_dict().unwrap();
                assert_eq!(d.get(b"Subtype").unwrap().as_name().unwrap(),subtype.as_bytes());
                assert!(d.get(b"QuadPoints").is_err());assert!(d.get(b"AP").is_err());
                assert_eq!(d.get(b"BS").unwrap().as_dict().unwrap().get(b"W").unwrap().as_i64().unwrap(),1);
                assert!(d.get(b"IC").unwrap().as_array().unwrap().is_empty());
                assert_eq!(d.get(b"C").unwrap().as_array().unwrap(),&vec![Object::Integer(0)]);
            };inspect(&e);
            let saved=apply(&mut e,"save",json!({}));let mut reopened=FolioEngine::new();
            apply(&mut reopened,"open",json!({"bytes_b64":saved["bytes_b64"]}));inspect(&reopened);
            let snap=e.snapshot().unwrap();reopened.restore(&snap).unwrap();inspect(&reopened);
            assert!(e.undo().unwrap());assert!(annot_ids(&e.doc,e.page_id(0).unwrap()).unwrap().is_empty());assert!(e.redo().unwrap());inspect(&e);
            apply(&mut e,"removeAnnotation",json!({"page":0,"id":id}));assert!(annot_ids(&e.doc,e.page_id(0).unwrap()).unwrap().is_empty());assert!(e.undo().unwrap());inspect(&e);
            for rect in [[0.,0.,0.,1.],[1.,1.,1e-12,1.],[0.,0.,-1.,1.],[1e6,0.,1.,1.]]{
                let before=e.serialize_doc().unwrap();assert!(e.apply(Command::new("addAnnotation",json!({"page":0,"rect":rect,"contents":"bad","subtype":subtype}))).is_err());assert_eq!(e.serialize_doc().unwrap(),before);
            }
        }
    }

    #[test]
    fn shape_headers_raise_only_when_required_and_undo_preserves_original_version() {
        for version in ["1.2","1.3","1.4","1.7","2.0"] {
            let mut e=FolioEngine::new();apply(&mut e,"new",json!({"pages":1}));e.doc.version=version.into();
            // Catalog metadata is retained; effective version may already be higher.
            let root=e.doc.trailer.get(b"Root").unwrap().as_reference().unwrap();e.doc.get_object_mut(root).unwrap().as_dict_mut().unwrap().set("Version",Object::Name(b"1.7".to_vec()));
            let original=e.serialize_doc().unwrap();let mut imported=FolioEngine::new();apply(&mut imported,"open",json!({"bytes_b64":b64_encode(&original)}));
            apply(&mut imported,"addAnnotation",json!({"page":0,"rect":[1,2,3,4],"contents":"shape","subtype":"Square"}));
            assert_eq!(imported.doc.version,if version=="1.2"||version=="1.3" {"1.4"}else{version});
            assert_eq!(imported.doc.get_object(root).unwrap().as_dict().unwrap().get(b"Version").unwrap().as_name().unwrap(),b"1.7");
            let saved=imported.serialize_doc().unwrap();assert_eq!(Document::load_mem(&saved).unwrap().version,imported.doc.version);
            assert!(imported.undo().unwrap());assert_eq!(imported.doc.version,version);assert!(imported.redo().unwrap());assert_eq!(imported.doc.version,shape_version(version).unwrap());
        }
        assert!(shape_version("bad").is_err());assert!(shape_version("0.9").is_err());
    }

}
