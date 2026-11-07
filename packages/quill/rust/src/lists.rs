//! Durable list definitions shared by paragraph membership, independent of body runs.
use super::*;
use std::{collections::BTreeMap, sync::Arc};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListFormat {
    Bullet,
    Decimal,
    LowerLetter,
    UpperLetter,
    LowerRoman,
    UpperRoman,
}
impl ListFormat {
    pub fn name(self) -> &'static str {
        match self {
            Self::Bullet => "bullet",
            Self::Decimal => "decimal",
            Self::LowerLetter => "lowerLetter",
            Self::UpperLetter => "upperLetter",
            Self::LowerRoman => "lowerRoman",
            Self::UpperRoman => "upperRoman",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListKind {
    Bullet,
    Numbered,
    Multilevel,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListLevel {
    pub format: ListFormat,
    pub start: u32,
    pub indent_twips: u32,
    pub hanging_twips: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListDefinition {
    pub id: u64,
    pub kind: ListKind,
    pub levels: [ListLevel; 9],
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListItem {
    pub level: u8,
    pub definition: Arc<ListDefinition>,
}
pub fn definition(id: u64, kind: ListKind) -> ListDefinition {
    ListDefinition {
        id,
        kind,
        levels: std::array::from_fn(|i| ListLevel {
            format: match kind {
                ListKind::Bullet => ListFormat::Bullet,
                ListKind::Numbered => ListFormat::Decimal,
                ListKind::Multilevel => [
                    ListFormat::Decimal,
                    ListFormat::LowerLetter,
                    ListFormat::LowerRoman,
                ][i % 3],
            },
            start: 1,
            indent_twips: (i as u32 + 1) * 720,
            hanging_twips: 360,
        }),
    }
}
pub fn validate_definition(d: &ListDefinition) -> Result<(), EngineError> {
    if d.id == 0
        || d.id > 2_147_483_647
        || d.levels.iter().any(|l| {
            !(1..=9999).contains(&l.start)
                || l.indent_twips > 31680
                || l.hanging_twips > l.indent_twips
        })
    {
        return Err(EngineError::validation(
            "invalid list definition id/start/indent/hanging",
        ));
    }
    Ok(())
}
pub fn validate(blocks: &[Block]) -> Result<(), EngineError> {
    let mut defs = BTreeMap::new();
    let mut count = 0;
    for b in blocks {
        if b.kind == BlockKind::List {
            count += 1;
        }
        if let Some(list) = &b.list {
            if b.kind != BlockKind::List || list.level > 8 {
                return Err(EngineError::validation(
                    "list membership requires list kind and level0..8",
                ));
            }
            validate_definition(&list.definition)?;
            if let Some(previous) = defs.insert(list.definition.id, &list.definition) {
                if previous != &list.definition {
                    return Err(EngineError::validation(
                        "inconsistent shared list definition",
                    ));
                }
            }
        }
    }
    if count > 10000 || defs.len() > 256 {
        return Err(EngineError::validation("list metadata budget exceeded"));
    }
    Ok(())
}
fn next_id(blocks: &[Block]) -> Result<u64, EngineError> {
    blocks
        .iter()
        .filter_map(|b| b.list.as_ref().map(|l| l.definition.id))
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .filter(|id| *id <= 2_147_483_647)
        .ok_or_else(|| EngineError::validation("list id space exhausted"))
}
pub fn legacy_range(blocks: &[Block], at: usize) -> (usize, usize) {
    let mut a = at;
    let mut b = at;
    while a > 0 && blocks[a - 1].kind == BlockKind::List && blocks[a - 1].list.is_none() {
        a -= 1;
    }
    while b + 1 < blocks.len()
        && blocks[b + 1].kind == BlockKind::List
        && blocks[b + 1].list.is_none()
    {
        b += 1;
    }
    (a, b)
}
impl QuillEngine {
    pub(super) fn op_lists(&mut self, op: &str, p: &Value) -> Result<CommandResult, EngineError> {
        let first = as_usize(field(p, "first")?, "first")?;
        let last = as_usize(field(p, "last")?, "last")?;
        if first > last || last >= self.blocks.len() {
            return Err(EngineError::validation("invalid list block range"));
        }
        let mut next = self.blocks.clone();
        match op {
            "setListKind" => {
                let kind = field(p, "kind")?
                    .as_str()
                    .ok_or_else(|| EngineError::validation("list kind must be string"))?;
                if kind == "none" {
                    for b in &mut next[first..=last] {
                        if b.kind == BlockKind::List {
                            b.kind = BlockKind::Para;
                        }
                        b.list = None;
                    }
                } else {
                    let kind: ListKind = serde_json::from_value(json!(kind))?;
                    let unchanged = next[first..=last].iter().all(|b| {
                        b.kind == BlockKind::List
                            && b.list
                                .as_ref()
                                .map_or(kind == ListKind::Bullet, |l| l.definition.kind == kind)
                    });
                    if !unchanged {
                        let def = Arc::new(definition(next_id(&next)?, kind));
                        for b in &mut next[first..=last] {
                            let level = b.list.as_ref().map_or(0, |l| l.level);
                            b.kind = BlockKind::List;
                            b.list = Some(ListItem {
                                level,
                                definition: def.clone(),
                            });
                        }
                    }
                }
            }
            "setListFormat" => {
                let level = as_usize(field(p, "level")?, "level")?;
                if level > 8 {
                    return Err(EngineError::validation("list level must be0..8"));
                }
                let format: ListFormat = serde_json::from_value(field(p, "format")?.clone())?;
                if next[first..=last].iter().any(|b| b.kind != BlockKind::List) {
                    return Err(EngineError::validation(
                        "select list paragraphs to change format",
                    ));
                }
                if next[first..=last].iter().all(|b| {
                    let base = b
                        .list
                        .as_ref()
                        .map(|l| l.definition.levels[level].clone())
                        .unwrap_or_else(|| definition(1, ListKind::Bullet).levels[level].clone());
                    base.format == format
                        && [
                            ("start", base.start),
                            ("indent_twips", base.indent_twips),
                            ("hanging_twips", base.hanging_twips),
                        ]
                        .iter()
                        .all(|(key, value)| {
                            p.get(*key)
                                .is_none_or(|v| v.as_u64() == Some(u64::from(*value)))
                        })
                }) {
                    return Ok(Self::read_only(json!({"ok":true})));
                }

                for at in first..=last {
                    if next[at].list.is_none() {
                        let (a, b) = legacy_range(&next, at);
                        let def = Arc::new(definition(next_id(&next)?, ListKind::Bullet));
                        for block in &mut next[a..=b] {
                            block.list = Some(ListItem {
                                level: 0,
                                definition: def.clone(),
                            });
                        }
                    }
                }
                let ids: std::collections::BTreeSet<_> = next[first..=last]
                    .iter()
                    .map(|b| b.list.as_ref().unwrap().definition.id)
                    .collect();
                for id in ids {
                    let source = next
                        .iter()
                        .find_map(|b| b.list.as_ref().filter(|l| l.definition.id == id))
                        .unwrap();
                    let mut def = (*source.definition).clone();
                    let l = &mut def.levels[level];
                    l.format = format;
                    for (key, target) in [
                        ("start", &mut l.start),
                        ("indent_twips", &mut l.indent_twips),
                        ("hanging_twips", &mut l.hanging_twips),
                    ] {
                        if let Some(v) = p.get(key) {
                            *target = u32::try_from(v.as_u64().ok_or_else(|| {
                                EngineError::validation("list level values must be integers")
                            })?)
                            .map_err(|_| EngineError::validation("list level value too large"))?;
                        }
                    }
                    validate_definition(&def)?;
                    let def = Arc::new(def);
                    for block in &mut next {
                        if let Some(list) = &mut block.list {
                            if list.definition.id == id {
                                list.definition = def.clone();
                            }
                        }
                    }
                }
            }
            "shiftListLevel" => {
                let dir = field(p, "direction")?
                    .as_i64()
                    .filter(|d| *d == 1 || *d == -1)
                    .ok_or_else(|| EngineError::validation("direction must be +1 or -1"))?;
                if next[first..=last].iter().any(|b| b.kind != BlockKind::List) {
                    return Err(EngineError::validation(
                        "select list paragraphs to shift levels",
                    ));
                }
                for at in first..=last {
                    if next[at].list.is_none() {
                        let (a, b) = legacy_range(&next, at);
                        let def = Arc::new(definition(next_id(&next)?, ListKind::Bullet));
                        for block in &mut next[a..=b] {
                            block.list = Some(ListItem {
                                level: 0,
                                definition: def.clone(),
                            });
                        }
                    }
                }
                let def = next[first].list.as_ref().unwrap().definition.id;
                if next[first..=last]
                    .iter()
                    .any(|b| b.list.as_ref().unwrap().definition.id != def)
                {
                    return Err(EngineError::validation(
                        "shift requires one list definition",
                    ));
                }
                let prev = first
                    .checked_sub(1)
                    .and_then(|i| next[i].list.as_ref())
                    .filter(|l| l.definition.id == def);
                if dir > 0
                    && (prev.is_none()
                        || i64::from(next[first].list.as_ref().unwrap().level) + 1
                            > i64::from(prev.unwrap().level) + 1)
                {
                    return Err(EngineError::validation(
                        "first item stays level0; indent at most one below prior item",
                    ));
                }
                for b in &mut next[first..=last] {
                    let l = b.list.as_mut().unwrap();
                    let level = i64::from(l.level) + dir;
                    if !(0..=8).contains(&level) {
                        return Err(EngineError::validation("list levels must remain0..8"));
                    }
                    l.level = level as u8;
                }
            }
            _ => return Err(EngineError::unsupported("unknown list operation")),
        }
        validate(&next)?;
        // List ops rewrite `kind`/`list` over a block range; a table block
        // inside it would lose its kind/payload invariant, so the merged
        // candidate must still satisfy table validation.
        crate::tables::validate_tables(&next)?;
        if next == self.blocks {
            return Ok(Self::read_only(json!({"ok":true})));
        }
        let removed = self.blocks.clone();
        self.record_undo(0, removed, next.clone(), Collections::default());
        self.blocks = next;
        Ok(CommandResult::data(json!({"ok":true})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(e: &mut QuillEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn fixture() -> QuillEngine {
        let mut e = QuillEngine::new();
        call(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"One\nTwo\nThree"}),
        );
        e
    }
    fn kind(e: &mut QuillEngine, a: usize, b: usize, k: &str) {
        call(e, "setListKind", json!({"first":a,"last":b,"kind":k}));
    }
    #[test]
    fn real_numbering_part_preserves_formats_starts_levels_styles_and_identity() {
        let mut e = fixture();
        call(
            &mut e,
            "applyStyle",
            json!({"from":{"block":0,"offset":0},"to":{"block":2,"offset":5},"style":{"bold":true,"font_family":"Aptos","font_size":12.5,"highlight":"#12aBcF"}}),
        );
        kind(&mut e, 0, 2, "multilevel");
        call(
            &mut e,
            "shiftListLevel",
            json!({"first":1,"last":2,"direction":1}),
        );
        let id = e.blocks[0].list.as_ref().unwrap().definition.id;
        call(
            &mut e,
            "setListFormat",
            json!({"first":1,"last":2,"level":1,"format":"upperRoman","start":3,"indent_twips":1600,"hanging_twips":400}),
        );
        let before = e.snapshot().unwrap();
        let bytes = docx::export_docx(&e.blocks).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("word/numbering.xml").unwrap(), &mut xml)
            .unwrap();
        assert!(
            xml.contains("upperRoman")
                && xml.contains("w:val=\"3\"")
                && xml.contains("w:left=\"1600\"")
        );
        let mut body = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("word/document.xml").unwrap(), &mut body)
            .unwrap();
        assert!(
            body.contains(&format!("<w:numId w:val=\"{id}\"/>"))
                && body.contains("<w:ilvl w:val=\"1\"/>")
                && !body.contains("III.")
        );
        assert_eq!(docx::import_docx(&bytes).unwrap(), e.blocks);
        assert_eq!(block_text(&e.blocks[0]), "One");
        let mut restored = QuillEngine::new();
        restored.restore(&before).unwrap();
        assert_eq!(restored.blocks, e.blocks);
        for format in [
            "bullet",
            "decimal",
            "lowerLetter",
            "upperLetter",
            "lowerRoman",
            "upperRoman",
        ] {
            call(
                &mut e,
                "setListFormat",
                json!({"first":0,"last":2,"level":0,"format":format}),
            );
            assert_eq!(
                docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap(),
                e.blocks
            );
            assert_eq!(e.blocks[0].list.as_ref().unwrap().definition.id, id);
        }
    }
    #[test]
    fn independent_instances_restart_while_continuation_uses_one_real_num_id() {
        let mut e = fixture();
        kind(&mut e, 0, 1, "numbered");
        kind(&mut e, 2, 2, "numbered");
        let a = e.blocks[0].list.as_ref().unwrap().definition.id;
        assert_eq!(e.blocks[1].list.as_ref().unwrap().definition.id, a);
        assert_ne!(e.blocks[2].list.as_ref().unwrap().definition.id, a);
        assert_eq!(
            docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap(),
            e.blocks
        );
    }
    #[test]
    fn run_and_structure_edits_retain_membership_and_kindswitch_clears_it() {
        let mut e = fixture();
        kind(&mut e, 0, 2, "numbered");
        call(
            &mut e,
            "applyStyle",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"style":{"bold":true}}),
        );
        let list = e.blocks[0].list.clone();
        let before = e.snapshot().unwrap();
        call(&mut e, "splitBlock", json!({"at":{"block":0,"offset":1}}));
        assert_eq!(e.blocks[0].list, list);
        assert_eq!(e.blocks[1].list, list);
        call(&mut e, "mergeBlock", json!({"index":1}));
        assert_eq!(e.blocks[0].list, list);
        assert!(e.blocks[0].inlines[0].style.bold);
        call(
            &mut e,
            "changeCase",
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":3},"mode":"upper"}),
        );
        assert_eq!(e.blocks[0].list, list);
        call(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":1,"offset":1},"text":"X\nY"}),
        );
        assert_eq!(e.blocks[0].list, list);
        assert_eq!(e.blocks[1].list, list);
        assert!(e.undo().unwrap());
        call(&mut e, "setBlockKind", json!({"block":0,"kind":"h1"}));
        assert!(e.blocks[0].list.is_none());
        assert!(e.undo().unwrap());
        assert_eq!(e.blocks[0].list, list);
        while e.undo().unwrap() {}
        assert!(!before.is_empty());
    }
    #[test]
    fn noops_errors_and_corrupt_snapshot_preserve_redo() {
        let mut e = fixture();
        kind(&mut e, 0, 2, "bullet");
        let before = e.snapshot().unwrap();
        call(
            &mut e,
            "setListFormat",
            json!({"first":0,"last":2,"level":0,"format":"decimal"}),
        );
        e.undo().unwrap();
        assert!(call(
            &mut e,
            "setListKind",
            json!({"first":0,"last":2,"kind":"bullet"})
        )
        .events
        .is_empty());
        assert!(call(
            &mut e,
            "setListFormat",
            json!({"first":0,"last":2,"level":0,"format":"bullet"})
        )
        .events
        .is_empty());
        for (op, p) in [
            ("shiftListLevel", json!({"first":0,"last":0,"direction":1})),
            ("shiftListLevel", json!({"first":1,"last":2,"direction":-1})),
            (
                "setListFormat",
                json!({"first":0,"last":2,"level":9,"format":"decimal"}),
            ),
            (
                "setListFormat",
                json!({"first":0,"last":2,"level":0,"format":"decimal","start":0}),
            ),
            (
                "setListFormat",
                json!({"first":0,"last":2,"level":0,"format":"decimal","indent_twips":10,"hanging_twips":20}),
            ),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        let mut invalid = serde_json::to_value(SnapshotRef { blocks: &e.blocks }).unwrap();
        invalid["blocks"][0]["list"]["level"] = json!(9);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
        for mutation in ["zero-id", "inconsistent", "kind", "missing-level"] {
            let mut invalid = serde_json::to_value(SnapshotRef { blocks: &e.blocks }).unwrap();
            match mutation {
                "zero-id" => invalid["blocks"][0]["list"]["definition"]["id"] = json!(0),
                "inconsistent" => {
                    invalid["blocks"][0]["list"]["definition"]["levels"][0]["start"] = json!(2)
                }
                "kind" => invalid["blocks"][0]["kind"] = json!("h1"),
                _ => {
                    invalid["blocks"][0]["list"]["definition"]["levels"]
                        .as_array_mut()
                        .unwrap()
                        .pop();
                }
            }
            assert!(e
                .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
    }
    #[test]
    fn legacy_defaults_export_actual_bullets_without_literal_text_or_fake_retained_numbers() {
        let mut e = fixture();
        for i in 0..3 {
            call(&mut e, "setBlockKind", json!({"block":i,"kind":"list"}));
        }
        let before = e.snapshot().unwrap();
        assert!(call(
            &mut e,
            "setListFormat",
            json!({"first":0,"last":2,"level":0,"format":"bullet"})
        )
        .events
        .is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
        assert_eq!(
            docx::import_docx(&docx::export_docx(&e.blocks).unwrap()).unwrap(),
            e.blocks
        );
        call(
            &mut e,
            "shiftListLevel",
            json!({"first":1,"last":2,"direction":1}),
        );
        assert_eq!(e.blocks[1].list.as_ref().unwrap().level, 1);
        assert!(e.blocks[0].list.is_some());
    }
    #[test]
    fn list_budget_failures_during_newline_and_replace_are_atomic_and_keep_redo() {
        let mut e = fixture();
        kind(&mut e, 0, 0, "numbered");
        e.blocks = vec![e.blocks[0].clone(); 10000];
        call(
            &mut e,
            "setListFormat",
            json!({"first":0,"last":0,"level":0,"format":"lowerLetter"}),
        );
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for (op, p) in [
            ("splitBlock", json!({"at":{"block":0,"offset":0}})),
            (
                "insertText",
                json!({"at":{"block":0,"offset":0},"text":"\n"}),
            ),
            (
                "replaceRange",
                json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":1},"text":"\n"}),
            ),
        ] {
            assert!(e.apply(Command::new(op, p)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
    }
}

#[cfg(test)]
mod snapshot_version_tests {
    use super::*;
    // This is the root shape used by pre-list Quill readers. Extra Block fields
    // were tolerated, so merely appending list metadata would silently lose it.
    #[derive(Deserialize)]
    struct LegacyDocument {
        blocks: Vec<LegacyBlock>,
    }
    #[derive(Deserialize)]
    struct LegacyBlock {
        kind: BlockKind,
        #[serde(default)]
        inlines: Vec<Inline>,
    }
    #[test]
    fn actual_list_snapshot_reopens_and_old_reader_rejects_root_shape() {
        let mut engine = QuillEngine::new();
        engine
            .apply(Command::new(
                "insertText",
                json!({"at":{"block":0,"offset":0},"text":"First\nSecond"}),
            ))
            .unwrap();
        engine
            .apply(Command::new(
                "setListKind",
                json!({"first":0,"last":1,"kind":"numbered"}),
            ))
            .unwrap();
        let bytes = engine.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["kind"], "quill");
        assert_eq!(value["schema"], 2);
        assert!(value.get("blocks").is_none());
        assert!(value["document"]["blocks"][0]["list"].is_object());
        assert!(serde_json::from_slice::<LegacyDocument>(payload).is_err());
        let unprotected = serde_json::to_vec(&SnapshotRef {
            blocks: &engine.blocks,
        })
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<LegacyDocument>(&unprotected)
                .unwrap()
                .blocks
                .len(),
            2
        );
        let mut reopened = QuillEngine::new();
        reopened.restore(&bytes).unwrap();
        assert_eq!(reopened.blocks, engine.blocks);
        assert_eq!(reopened.snapshot().unwrap(), bytes);
    }
    #[test]
    fn legacy_snapshot_bytes_and_old_reader_remain_exact_without_explicit_metadata() {
        let mut engine = QuillEngine::new();
        engine
            .apply(Command::new(
                "insertText",
                json!({"at":{"block":0,"offset":0},"text":"Legacy"}),
            ))
            .unwrap();
        engine
            .apply(Command::new(
                "setBlockKind",
                json!({"block":0,"kind":"list"}),
            ))
            .unwrap();
        let bytes = engine.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let expected = serde_json::to_vec(&SnapshotRef {
            blocks: &engine.blocks,
        })
        .unwrap();
        assert_eq!(payload, expected);
        let legacy: LegacyDocument = serde_json::from_slice(payload).unwrap();
        assert_eq!(legacy.blocks[0].kind, BlockKind::List);
        assert_eq!(legacy.blocks[0].inlines[0].text, "Legacy");
        let mut reopened = QuillEngine::new();
        reopened.restore(&bytes).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), bytes);
    }
    #[test]
    fn malformed_foreign_or_future_wrappers_reject_before_state_and_redo_change() {
        let mut engine = QuillEngine::new();
        engine
            .apply(Command::new(
                "setListKind",
                json!({"first":0,"last":0,"kind":"numbered"}),
            ))
            .unwrap();
        let listed = engine.snapshot().unwrap();
        engine.undo().unwrap();
        let before = engine.snapshot().unwrap();
        let (_, payload) = decode_envelope(&listed).unwrap();
        let original: Value = serde_json::from_slice(payload).unwrap();
        for (field, value) in [
            ("kind", json!("photo")),
            ("schema", json!(1)),
            ("schema", json!(3)),
            ("schema", Value::Null),
            ("document", Value::Null),
            ("blocks", json!([])),
        ] {
            let mut invalid = original.clone();
            invalid[field] = value;
            assert!(engine
                .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
                .is_err());
            assert_eq!(engine.snapshot().unwrap(), before);
        }
        let mut invalid = original.clone();
        invalid["document"]["blocks"][0]["list"]["level"] = json!(9);
        assert!(engine
            .restore(&encode_envelope(&serde_json::to_vec(&invalid).unwrap()))
            .is_err());
        assert_eq!(engine.snapshot().unwrap(), before);
        assert!(engine.redo().unwrap());
        assert_eq!(engine.snapshot().unwrap(), listed);
    }
}
