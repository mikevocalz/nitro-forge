//! Direct OOXML numbering subset: real instances/levels, no glyph/font/template guesses.
use crate::{lists::*, Block, BlockKind};
use ignition_core::EngineError;
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use std::{collections::BTreeMap, sync::Arc};
fn bad(s: &str) -> EngineError {
    EngineError::validation(s)
}
fn name(v: &[u8]) -> &[u8] {
    v.rsplit(|b| *b == b':').next().unwrap_or(v)
}
fn attr(e: &BytesStart, key: &[u8]) -> Result<Option<String>, EngineError> {
    for a in e.attributes() {
        let a = a.map_err(|_| bad("invalid numbering attribute"))?;
        if name(a.key.as_ref()) == key {
            return Ok(Some(
                a.unescape_value()
                    .map_err(|_| bad("invalid numbering attribute value"))?
                    .into_owned(),
            ));
        }
    }
    Ok(None)
}
fn number(e: &BytesStart, key: &[u8]) -> Result<u32, EngineError> {
    attr(e, key)?
        .ok_or_else(|| bad("missing numbering integer"))?
        .parse()
        .map_err(|_| bad("invalid numbering integer"))
}
fn xml_esc(v: &str) -> String {
    v.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('"', "&quot;")
}
pub fn text(format: ListFormat, level: usize) -> String {
    if format == ListFormat::Bullet {
        ["•", "◦", "▪"][level % 3].into()
    } else {
        format!("%{}.", level + 1)
    }
}
pub struct Parsed {
    pub definition: Arc<ListDefinition>,
    pub defined: [bool; 9],
    pub legacy: bool,
}
pub struct Projection {
    pub paragraphs: Vec<Option<(u64, u8)>>,
    pub definitions: BTreeMap<u64, (ListDefinition, bool)>,
}
pub fn project(blocks: &[Block]) -> Result<Projection, EngineError> {
    validate(blocks)?;
    let mut defs = BTreeMap::new();
    for b in blocks {
        if let Some(l) = &b.list {
            defs.insert(l.definition.id, ((*l.definition).clone(), false));
        }
    }
    let mut next = defs.keys().next_back().copied().unwrap_or(0) + 1;
    let mut pars = vec![];
    let mut legacy = None;
    for b in blocks {
        if b.kind != BlockKind::List {
            pars.push(None);
            legacy = None;
        } else if let Some(l) = &b.list {
            pars.push(Some((l.definition.id, l.level)));
            legacy = None;
        } else {
            let id = match legacy {
                Some(id) => id,
                None => {
                    if next > 2_147_483_647 {
                        return Err(bad("numbering instance id space exhausted"));
                    }
                    let id = next;
                    next += 1;
                    defs.insert(id, (definition(id, ListKind::Bullet), true));
                    if defs.len() > 256 {
                        return Err(bad("numbering definition budget exceeded"));
                    }
                    legacy = Some(id);
                    id
                }
            };
            pars.push(Some((id, 0)));
        }
    }
    Ok(Projection {
        paragraphs: pars,
        definitions: defs,
    })
}
pub fn export(p: &Projection) -> String {
    let mut s=String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?><w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">");
    for (id, (def, legacy)) in &p.definitions {
        let label = if *legacy {
            "NitroForgeLegacyBullet".to_owned()
        } else {
            format!(
                "NitroForgeList:{}",
                match def.kind {
                    ListKind::Bullet => "bullet",
                    ListKind::Numbered => "numbered",
                    ListKind::Multilevel => "multilevel",
                }
            )
        };
        s.push_str(&format!("<w:abstractNum w:abstractNumId=\"{id}\"><w:multiLevelType w:val=\"hybridMultilevel\"/><w:name w:val=\"{label}\"/>"));
        for (i, l) in def.levels.iter().enumerate() {
            s.push_str(&format!("<w:lvl w:ilvl=\"{i}\"><w:start w:val=\"{}\"/><w:numFmt w:val=\"{}\"/><w:lvlText w:val=\"{}\"/><w:suff w:val=\"tab\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:tabs><w:tab w:val=\"num\" w:pos=\"{}\"/></w:tabs><w:ind w:left=\"{}\" w:hanging=\"{}\"/></w:pPr></w:lvl>",l.start,l.format.name(),xml_esc(&text(l.format,i)),l.indent_twips,l.indent_twips,l.hanging_twips));
        }
        s.push_str("</w:abstractNum>");
    }
    for id in p.definitions.keys() {
        s.push_str(&format!(
            "<w:num w:numId=\"{id}\"><w:abstractNumId w:val=\"{id}\"/></w:num>"
        ));
    }
    s.push_str("</w:numbering>");
    s
}
struct Abstract {
    levels: [Option<ListLevel>; 9],
    label: Option<String>,
    multilevel: bool,
}
struct LevelBuilder {
    level: usize,
    format: Option<ListFormat>,
    start: Option<u32>,
    text: Option<String>,
    indent: Option<u32>,
    hanging: Option<u32>,
    tab: Option<u32>,
}
impl LevelBuilder {
    fn finish(self) -> Result<(usize, ListLevel), EngineError> {
        let start = self
            .start
            .ok_or_else(|| bad("numbering level lacks explicit start"))?;
        let indent = self.indent.ok_or_else(|| {
            EngineError::unsupported("numbering level needs explicit left/hanging indentation")
        })?;
        let hanging = self.hanging.ok_or_else(|| {
            EngineError::unsupported("numbering level needs explicit left/hanging indentation")
        })?;
        if self.tab.is_some_and(|pos| pos != indent) {
            return Err(EngineError::unsupported(
                "custom numbering tab position unsupported",
            ));
        }
        let format = self
            .format
            .ok_or_else(|| bad("numbering level lacks numFmt"))?;
        if self.text.as_deref() != Some(&text(format, self.level)) {
            return Err(EngineError::unsupported(
                "unsupported numbering text template/glyph",
            ));
        }
        Ok((
            self.level,
            ListLevel {
                format,
                start,
                indent_twips: indent,
                hanging_twips: hanging,
            },
        ))
    }
}
pub fn parse(xml: &str) -> Result<BTreeMap<u64, Parsed>, EngineError> {
    if xml.len() > 4 * 1024 * 1024 {
        return Err(bad("numbering XML exceeds4MiB"));
    }
    let mut reader = Reader::from_str(xml);
    let mut buf = vec![];
    let mut abstract_id = None;
    let mut current: Option<Abstract> = None;
    let mut level: Option<LevelBuilder> = None;
    let mut abstracts = BTreeMap::new();
    let mut nums = BTreeMap::<u64, (u32, BTreeMap<usize, u32>)>::new();
    let mut num_id = None;
    let mut num_abstract = None;
    let mut overrides = BTreeMap::new();
    let mut override_level = None;
    let mut events = 0;
    let mut root_seen = false;
    let mut root_closed = false;
    loop {
        let ev = reader
            .read_event_into(&mut buf)
            .map_err(|_| bad("malformed numbering XML"))?;
        let empty = matches!(&ev, Event::Empty(_));
        events += 1;
        if events > 100000 {
            return Err(bad("numbering event budget exceeded"));
        }
        match ev {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) => {
                let qualified = e.name();
                if !qualified.as_ref().starts_with(b"w:") {
                    return Err(EngineError::unsupported(
                        "numbering requires admitted w namespace prefix",
                    ));
                }
                if name(qualified.as_ref()) == b"numbering"
                    && !e.attributes().any(|a| {
                        a.is_ok_and(|a| {
                            a.key.as_ref() == b"xmlns:w"
                            && a.value.as_ref()
                                == b"http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                        })
                    })
                {
                    return Err(EngineError::unsupported("unsupported numbering namespace"));
                }
                let tag = qualified;
                let tag = name(tag.as_ref());
                let allowed: &[&[u8]] = match tag {
                    b"abstractNum" => &[b"abstractNumId"],
                    b"lvl" => &[b"ilvl"],
                    b"num" => &[b"numId"],
                    b"lvlOverride" => &[b"ilvl"],
                    b"ind" => &[b"left", b"hanging"],
                    b"tab" => &[b"val", b"pos"],
                    b"numbering" => &[],
                    b"pPr" | b"rPr" | b"tabs" => &[],
                    _ => &[b"val"],
                };
                for a in e.attributes() {
                    let a = a.map_err(|_| bad("invalid/duplicate numbering attribute"))?;
                    if a.key.as_ref().starts_with(b"xmlns") {
                        if tag != b"numbering" {
                            return Err(EngineError::unsupported(
                                "nested numbering namespace declarations unsupported",
                            ));
                        }
                        continue;
                    }
                    if !a.key.as_ref().starts_with(b"w:") {
                        return Err(EngineError::unsupported(
                            "unsupported numbering attribute namespace",
                        ));
                    }
                    if !allowed.contains(&name(a.key.as_ref())) {
                        return Err(EngineError::unsupported("unsupported numbering attribute"));
                    }
                }
                if root_closed {
                    return Err(bad("trailing numbering element"));
                }
                match tag {
                    b"numbering" => {
                        if root_seen {
                            return Err(bad("duplicate numbering root"));
                        }
                        root_seen = true;
                        if empty {
                            root_closed = true;
                        }
                    }
                    b"abstractNum" => {
                        if current.is_some() || num_id.is_some() {
                            return Err(bad("nested numbering definition"));
                        }
                        abstract_id = Some(number(&e, b"abstractNumId")?);
                        current = Some(Abstract {
                            levels: std::array::from_fn(|_| None),
                            label: None,
                            multilevel: false,
                        });
                    }
                    b"lvl" => {
                        if current.is_none() || level.is_some() || override_level.is_some() {
                            return Err(EngineError::unsupported(
                                "nested/overridden numbering levels",
                            ));
                        }
                        let i = number(&e, b"ilvl")? as usize;
                        if i > 8 {
                            return Err(bad("numbering level outside0..8"));
                        }
                        level = Some(LevelBuilder {
                            level: i,
                            format: None,
                            start: None,
                            text: None,
                            indent: None,
                            hanging: None,
                            tab: None,
                        });
                    }
                    b"num" => {
                        if num_id.is_some() || current.is_some() {
                            return Err(bad("nested numbering instance"));
                        }
                        let id = u64::from(number(&e, b"numId")?);
                        if id == 0 || id > 2_147_483_647 {
                            return Err(bad("invalid numbering instance id"));
                        }
                        num_id = Some(id);
                        num_abstract = None;
                        overrides = BTreeMap::new();
                    }
                    b"abstractNumId" if num_id.is_some() => {
                        if num_abstract.replace(number(&e, b"val")?).is_some() {
                            return Err(bad("duplicate abstract numbering reference"));
                        }
                    }
                    b"lvlOverride" if num_id.is_some() => {
                        let i = number(&e, b"ilvl")? as usize;
                        if i > 8 || override_level.is_some() {
                            return Err(bad("invalid numbering override"));
                        }
                        override_level = Some(i);
                    }
                    b"startOverride" => {
                        let i =
                            override_level.ok_or_else(|| bad("start override outside level"))?;
                        if overrides.insert(i, number(&e, b"val")?).is_some() {
                            return Err(bad("duplicate start override"));
                        }
                    }
                    b"start" if level.is_some() => {
                        if level
                            .as_mut()
                            .unwrap()
                            .start
                            .replace(number(&e, b"val")?)
                            .is_some()
                        {
                            return Err(bad("duplicate numbering start"));
                        }
                    }
                    b"numFmt" if level.is_some() => {
                        let f = attr(&e, b"val")?.ok_or_else(|| bad("missing numbering format"))?;
                        if level
                            .as_mut()
                            .unwrap()
                            .format
                            .replace(serde_json::from_value(serde_json::json!(f)).map_err(
                                |_| EngineError::unsupported("unsupported numbering format"),
                            )?)
                            .is_some()
                        {
                            return Err(bad("duplicate numbering format"));
                        }
                    }
                    b"lvlText" if level.is_some() => {
                        let value = attr(&e, b"val")?.ok_or_else(|| bad("missing level text"))?;
                        if level.as_mut().unwrap().text.replace(value).is_some() {
                            return Err(bad("duplicate level text"));
                        }
                    }
                    b"ind" if level.is_some() => {
                        let l = level.as_mut().unwrap();
                        if attr(&e, b"firstLine")?.is_some()
                            || attr(&e, b"start")?.is_some()
                            || attr(&e, b"end")?.is_some()
                        {
                            return Err(EngineError::unsupported(
                                "unsupported numbering indentation model",
                            ));
                        }
                        if attr(&e, b"left")?.is_some() {
                            if l.indent.replace(number(&e, b"left")?).is_some() {
                                return Err(bad("duplicate numbering indentation"));
                            }
                        }
                        if attr(&e, b"hanging")?.is_some() {
                            if l.hanging.replace(number(&e, b"hanging")?).is_some() {
                                return Err(bad("duplicate numbering hanging"));
                            }
                        }
                    }
                    b"name" if current.is_some() => {
                        current.as_mut().unwrap().label = attr(&e, b"val")?
                    }
                    b"multiLevelType" if current.is_some() => {
                        let value = attr(&e, b"val")?.unwrap_or_default();
                        if !["singleLevel", "multilevel", "hybridMultilevel"]
                            .contains(&value.as_str())
                        {
                            return Err(EngineError::unsupported(
                                "unsupported numbering multilevel type",
                            ));
                        }
                        current.as_mut().unwrap().multilevel = value != "singleLevel";
                    }
                    b"suff" => {
                        if attr(&e, b"val")?.as_deref() != Some("tab") {
                            return Err(EngineError::unsupported("unsupported numbering suffix"));
                        }
                    }
                    b"lvlJc" => {
                        if attr(&e, b"val")?.as_deref() != Some("left") {
                            return Err(EngineError::unsupported(
                                "unsupported numbering alignment",
                            ));
                        }
                    }
                    b"pPr" | b"rPr" | b"tabs" | b"nsid" | b"tmpl" => {}
                    b"tab" => {
                        if attr(&e, b"val")?.as_deref() != Some("num") {
                            return Err(EngineError::unsupported("unsupported numbering tab"));
                        }
                        let l = level
                            .as_mut()
                            .ok_or_else(|| bad("numbering tab outside level"))?;
                        if l.tab.replace(number(&e, b"pos")?).is_some() {
                            return Err(bad("duplicate numbering tab"));
                        }
                    }
                    b"rFonts" => {
                        return Err(EngineError::unsupported(
                            "symbol-font numbering needs font-aware representation",
                        ))
                    }
                    _ => {
                        return Err(EngineError::unsupported(
                            "unsupported numbering definition property",
                        ))
                    }
                }
                if empty {
                    match tag {
                        b"abstractNum" | b"lvl" | b"num" => {
                            return Err(bad("incomplete numbering definition"))
                        }
                        b"lvlOverride" => return Err(bad("empty level override")),
                        _ => {}
                    }
                }
            }
            Event::End(e) => match name(e.name().as_ref()) {
                b"numbering" => root_closed = true,
                b"lvl" => {
                    let (i, l) = level
                        .take()
                        .ok_or_else(|| bad("unexpected numbering level end"))?
                        .finish()?;
                    if current.as_mut().unwrap().levels[i].replace(l).is_some() {
                        return Err(bad("duplicate numbering level"));
                    }
                }
                b"abstractNum" => {
                    let id = abstract_id
                        .take()
                        .ok_or_else(|| bad("unexpected abstract numbering end"))?;
                    if abstracts.insert(id, current.take().unwrap()).is_some()
                        || abstracts.len() > 256
                    {
                        return Err(bad("duplicate or excessive abstract numbering"));
                    }
                }
                b"lvlOverride" => {
                    let i = override_level
                        .take()
                        .ok_or_else(|| bad("unexpected override end"))?;
                    if !overrides.contains_key(&i) {
                        return Err(EngineError::unsupported(
                            "empty/full level override unsupported",
                        ));
                    }
                }
                b"num" => {
                    let id = num_id
                        .take()
                        .ok_or_else(|| bad("unexpected numbering instance end"))?;
                    let a = num_abstract
                        .take()
                        .ok_or_else(|| bad("instance lacks abstract reference"))?;
                    if nums
                        .insert(id, (a, std::mem::take(&mut overrides)))
                        .is_some()
                        || nums.len() > 256
                    {
                        return Err(bad("duplicate or excessive numbering instances"));
                    }
                }
                _ => {}
            },
            Event::Text(e) => {
                if !e
                    .unescape()
                    .map_err(|_| bad("invalid numbering text"))?
                    .trim()
                    .is_empty()
                {
                    return Err(bad("unexpected text in numbering definitions"));
                }
            }
            Event::DocType(_) => {
                return Err(EngineError::unsupported(
                    "DTD numbering definitions unsupported",
                ))
            }
            _ => {}
        }
        buf.clear();
    }
    if !root_seen || !root_closed || current.is_some() || num_id.is_some() || level.is_some() {
        return Err(bad("incomplete numbering XML"));
    }
    let mut result = BTreeMap::new();
    for (id, (a, overrides)) in nums {
        let a = abstracts
            .get(&a)
            .ok_or_else(|| bad("dangling abstract numbering reference"))?;
        let kind = match a.label.as_deref() {
            Some("NitroForgeLegacyBullet") | Some("NitroForgeList:bullet") => ListKind::Bullet,
            Some("NitroForgeList:numbered") => ListKind::Numbered,
            Some("NitroForgeList:multilevel") => ListKind::Multilevel,
            _ => {
                if a.multilevel {
                    ListKind::Multilevel
                } else if a.levels[0]
                    .as_ref()
                    .is_some_and(|l| l.format == ListFormat::Bullet)
                {
                    ListKind::Bullet
                } else {
                    ListKind::Numbered
                }
            }
        };
        let mut def = definition(id, kind);
        let mut defined = [false; 9];
        for (i, l) in a.levels.iter().enumerate() {
            if let Some(l) = l {
                def.levels[i] = l.clone();
                defined[i] = true;
            }
        }
        for (i, start) in overrides {
            if !defined[i] {
                return Err(bad("start override targets missing level"));
            }
            def.levels[i].start = start;
        }
        validate_definition(&def)?;
        let legacy = a.label.as_deref() == Some("NitroForgeLegacyBullet");
        if legacy && (!defined.iter().all(|v| *v) || def != definition(id, ListKind::Bullet)) {
            return Err(bad(
                "legacy list sentinel does not match full default template",
            ));
        }
        result.insert(
            id,
            Parsed {
                definition: Arc::new(def),
                defined,
                legacy,
            },
        );
    }
    Ok(result)
}
pub fn item(
    defs: &BTreeMap<u64, Parsed>,
    id: u64,
    level: usize,
) -> Result<Option<ListItem>, EngineError> {
    if level > 8 {
        return Err(bad("paragraph numbering level outside0..8"));
    }
    let d = defs
        .get(&id)
        .ok_or_else(|| bad("paragraph references missing numbering instance"))?;
    if !d.defined[level] {
        return Err(bad("paragraph references missing numbering level"));
    }
    if d.legacy {
        if level != 0 {
            return Err(bad("legacy bullet sentinel used at nonzero level"));
        }
        Ok(None)
    } else {
        Ok(Some(ListItem {
            level: level as u8,
            definition: d.definition.clone(),
        }))
    }
}
pub fn relationship(xml: &str) -> Result<Option<String>, EngineError> {
    part_relationship(xml, "numbering")
}
pub fn part_relationship(xml: &str, kind: &str) -> Result<Option<String>, EngineError> {
    if xml.len() > 1024 * 1024 {
        return Err(bad("document relationships exceed1MiB"));
    }
    let mut r = Reader::from_str(xml);
    let mut b = vec![];
    let mut target = None;
    loop {
        match r.read_event_into(&mut b).map_err(|_|bad("invalid document relationships"))?{Event::Eof=>break,Event::Empty(e)|Event::Start(e)if name(e.name().as_ref())==b"Relationship"=>{if attr(&e,b"Type")?.is_some_and(|v|v==format!("http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}")){if attr(&e,b"TargetMode")?.as_deref()==Some("External"){return Err(bad("external numbering relationship unsupported"));}let value=attr(&e,b"Target")?.ok_or_else(||bad("missing numbering target"))?;if value.is_empty()||value.len()>128||value.contains('/')||value.contains('\\')||value.contains("..")||target.replace(format!("word/{value}")).is_some(){return Err(bad("ambiguous or unsupported numbering target"));}}},_=>{}}
        b.clear();
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Projection {
        let mut b = Block {
            kind: BlockKind::List,
            list: Some(ListItem {
                level: 0,
                definition: Arc::new(definition(7, ListKind::Numbered)),
            }),
            style_id: None,
            table: None,
            toc: None,
            inlines: vec![],
        };
        let mut projection = project(std::slice::from_ref(&b)).unwrap();
        let second = projection.definitions[&7].0.clone();
        projection
            .definitions
            .insert(9, (ListDefinition { id: 9, ..second }, false));
        b.list.as_mut().unwrap().definition = Arc::new(definition(9, ListKind::Numbered));
        projection
    }
    #[test]
    fn actual_num_instances_start_overrides_and_strict_references() {
        let xml = export(&fixture());
        let changed=xml.replace("<w:num w:numId=\"9\"><w:abstractNumId w:val=\"9\"/></w:num>","<w:num w:numId=\"9\"><w:abstractNumId w:val=\"7\"/><w:lvlOverride w:ilvl=\"0\"><w:startOverride w:val=\"5\"/></w:lvlOverride></w:num>");
        let defs = parse(&changed).unwrap();
        assert_eq!(defs[&7].definition.levels[0].start, 1);
        assert_eq!(defs[&9].definition.levels[0].start, 5);
        assert_eq!(defs[&9].definition.id, 9);
        assert!(item(&defs, 99, 0).is_err());
        assert!(item(&defs, 7, 9).is_err());
    }
    #[test]
    fn unsupported_or_malformed_templates_reject_without_panics() {
        let xml = export(&fixture());
        for changed in [
            xml.replace("%1.", "%1.%2."),
            xml.replacen("w:val=\"decimal\"", "w:val=\"ordinal\"", 1),
            xml.replacen("w:val=\"1\"", "w:val=\"0\"", 1),
            xml.replacen("w:ilvl=\"0\"", "w:ilvl=\"9\"", 1),
            xml.replacen("w:hanging=\"360\"", "w:hanging=\"99999\"", 1),
            xml.replacen(
                "<w:numFmt w:val=\"decimal\"/>",
                "<w:numFmt w:val=\"decimal\" w:format=\"000\"/>",
                1,
            ),
            xml.replacen("w:pos=\"720\"", "w:pos=\"721\"", 1),
            xml.replacen(
                "<w:start w:val=\"1\"/>",
                "<w:start w:val=\"1\"/><w:start w:val=\"2\"/>",
                1,
            ),
            String::new(),
            "<w:numbering><w:lvl w:ilvl=\"0\"/></w:numbering>".into(),
            xml.replacen(
                "</w:abstractNum>",
                "<w:rPr><w:rFonts w:ascii=\"Symbol\"/></w:rPr></w:abstractNum>",
                1,
            ),
        ] {
            let result = std::panic::catch_unwind(|| parse(&changed));
            assert!(result.is_ok());
            assert!(result.unwrap().is_err());
        }
    }
    #[test]
    fn sentinel_name_does_not_erase_foreign_level_settings() {
        let mut p = fixture();
        p.definitions.get_mut(&7).unwrap().1 = true;
        let xml = export(&p);
        assert!(parse(&xml).is_err());
        let mut p = project(&[Block {
            kind: BlockKind::List,
            list: None,
            style_id: None,
            table: None,
            toc: None,
            inlines: vec![],
        }])
        .unwrap();
        let xml = export(&p);
        assert!(parse(&xml).unwrap().values().all(|d| d.legacy));
        p.definitions.values_mut().next().unwrap().0.levels[8].start = 2;
        assert!(parse(&export(&p)).is_err());
    }
}
