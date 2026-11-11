//! In-place comment text edits on page-owned Text/Highlight annotations.
use super::*;
const MAX_CONTENTS_BYTES: usize = 64 * 1024;

impl FolioEngine {
    pub(super) fn op_set_annotation_contents(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        reject_encrypted(&self.doc, "annotation text editing")?;
        let page = req_u64(p, "page")?;
        let page_id = self.page_id(page)?;
        let id = req_u64(p, "id")?;
        let contents = req_str(p, "contents")?;
        // Bound the encoded representation before allocating a PDF string.
        if contents.encode_utf16().count() > (MAX_CONTENTS_BYTES - 2) / 2 {
            return Err(EngineError::validation(
                "annotation text exceeds 64 KiB UTF-16 budget",
            ));
        }
        let object_id = annot_ids(&self.doc, page_id)?
            .into_iter()
            .find(|object| u64::from(object.0) == id)
            .ok_or_else(|| EngineError::not_found("annotation does not belong to this page"))?;
        let dictionary = self
            .doc
            .get_object(object_id)
            .and_then(Object::as_dict)
            .map_err(ser_err)?;
        let subtype = dictionary
            .get(b"Subtype")
            .and_then(Object::as_name)
            .map_err(ser_err)?;
        if subtype != b"Text" && subtype != b"Highlight" {
            return Err(EngineError::unsupported(
                "comment text editing supports Text/Highlight only",
            ));
        }
        let previous = dictionary
            .get(b"Contents")
            .ok()
            .and_then(|o| lopdf::decode_text_string(o).ok());
        if previous.as_deref() == Some(contents) {
            return Ok(ro(json!({"ok":true})));
        }
        let encoded = lopdf::text_string(contents);
        // Destination was fully resolved above. No fallible document lookup occurs after journaling.
        let mut next = self.doc.clone();
        next.get_object_mut(object_id)
            .and_then(Object::as_dict_mut)
            .map_err(ser_err)?
            .set("Contents", encoded);
        self.journal.record(self.doc.clone());
        self.doc = next;
        Ok(CommandResult::data(json!({"ok":true})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(e: &mut FolioEngine, op: &str, p: Value) -> Value {
        e.apply(Command::new(op, p)).unwrap().data
    }
    fn fixture() -> (FolioEngine, u64) {
        let mut e = FolioEngine::new();
        apply(&mut e, "new", json!({"pages":2}));
        let id = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[1,2,3,4],"contents":"Before","subtype":"Text"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        (e, id)
    }
    #[test]
    fn real_pdf_comment_edit_preserves_identity_geometry_unicode_and_history() {
        let (mut e, id) = fixture();
        let before = e.snapshot().unwrap();
        apply(
            &mut e,
            "setAnnotationContents",
            json!({"page":0,"id":id,"contents":"東京 😀 café"}),
        );
        let edited = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(
            edited["annots"][0],
            json!({"id":id,"subtype":"Text","rect":[1.0,2.0,3.0,4.0],"contents":"東京 😀 café"})
        );
        let changed = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        let noop = e
            .apply(Command::new(
                "setAnnotationContents",
                json!({"page":0,"id":id,"contents":"Before"}),
            ))
            .unwrap();
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), changed);
        let saved = apply(&mut e, "save", json!({}));
        let bytes = b64_decode(saved["bytes_b64"].as_str().unwrap()).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        let pdf = Document::load_mem(&bytes).unwrap();
        let dict = pdf.get_object((id as u32, 0)).unwrap().as_dict().unwrap();
        assert!(dict
            .get(b"Contents")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with(&[0xfe, 0xff]));
        let mut reopened = FolioEngine::new();
        apply(
            &mut reopened,
            "open",
            json!({"bytes_b64":saved["bytes_b64"]}),
        );
        assert_eq!(
            apply(&mut reopened, "listAnnotations", json!({"page":0})),
            edited
        );
        let mut restored = FolioEngine::new();
        restored.restore(&changed).unwrap();
        assert_eq!(
            apply(&mut restored, "listAnnotations", json!({"page":0})),
            edited
        );
    }
    #[test]
    fn wrong_page_missing_id_oversize_and_unsupported_type_preserve_history() {
        let (mut e, id) = fixture();
        apply(
            &mut e,
            "setAnnotationContents",
            json!({"page":0,"id":id,"contents":"After"}),
        );
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for p in [
            json!({"page":1,"id":id,"contents":"wrong page"}),
            json!({"page":0,"id":99999,"contents":"missing"}),
            json!({"page":0,"id":id,"contents":"x".repeat(32768)}),
            json!({"page":0,"id":id,"contents":false}),
        ] {
            assert!(e.apply(Command::new("setAnnotationContents", p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"][0]["contents"],
            "After"
        );
        e.doc
            .get_object_mut((id as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Subtype", Object::Name(b"Widget".to_vec()));
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "setAnnotationContents",
                json!({"page":0,"id":id,"contents":"no"})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn indirect_annotation_array_and_highlight_contents_are_supported() {
        let (mut e, id) = fixture();
        let page = e.page_id(0).unwrap();
        let references = annot_ids(&e.doc, page).unwrap();
        let array = e.doc.add_object(Object::Array(
            references.into_iter().map(Object::Reference).collect(),
        ));
        e.doc
            .get_object_mut(page)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Annots", Object::Reference(array));
        e.doc
            .get_object_mut((id as u32, 0))
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Subtype", Object::Name(b"Highlight".to_vec()));
        apply(
            &mut e,
            "setAnnotationContents",
            json!({"page":0,"id":id,"contents":""}),
        );
        assert_eq!(
            apply(&mut e, "listAnnotations", json!({"page":0}))["annots"][0]["contents"],
            ""
        );
        let id2 = apply(
            &mut e,
            "addAnnotation",
            json!({"page":0,"rect":[1,2,3,4],"contents":"新しい注釈","subtype":"Text"}),
        )["annot_id"]
            .as_u64()
            .unwrap();
        let list = apply(&mut e, "listAnnotations", json!({"page":0}));
        assert_eq!(list["annots"][1]["id"], id2);
        assert_eq!(list["annots"][1]["contents"], "新しい注釈");
    }
}
