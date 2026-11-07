//! Minimal real .docx export/import.
//!
//! A .docx is a ZIP package. We emit the three required parts:
//! `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`. Blocks map to
//! `<w:p>` paragraphs (with `<w:pStyle>` for non-para kinds) and inlines map to
//! `<w:r>` runs carrying `<w:b/>`, `<w:i/>`, `<w:u/>`, `<w:strike/>` and
//! `<w:color/>` run properties. Lists add a real numbering part, document relationship
//! and content-type override with direct paragraph numPr references.

use crate::{normalize_inlines, Block, BlockKind, Inline, Style};
use ignition_core::EngineError;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::io::{Cursor, Read, Write};

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;

const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

fn pstyle(kind: BlockKind) -> Option<&'static str> {
    match kind {
        BlockKind::Para => None,
        BlockKind::H1 => Some("Heading1"),
        BlockKind::H2 => Some("Heading2"),
        BlockKind::H3 => Some("Heading3"),
        BlockKind::List => Some("ListParagraph"),
        BlockKind::Quote => Some("Quote"),
        // `op_export_docx` rejects documents containing table blocks, so
        // this arm is unreachable; it exists only for exhaustiveness.
        BlockKind::Table => None,
    }
}

fn pstyle_kind(val: &str) -> BlockKind {
    match val {
        "Heading1" => BlockKind::H1,
        "Heading2" => BlockKind::H2,
        "Heading3" => BlockKind::H3,
        "ListParagraph" => BlockKind::List,
        "Quote" | "BlockQuote" | "BlockText" => BlockKind::Quote,
        _ => BlockKind::Para,
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
fn build_document_xml(blocks: &[Block]) -> String {
    build_document_with_numbering(blocks, None)
}
fn build_document_with_numbering(
    blocks: &[Block],
    numbering: Option<&crate::numbering::Projection>,
) -> String {
    let mut s = String::with_capacity(blocks.len() * 64 + 256);
    s.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
    s.push_str(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
    );
    for (index, b) in blocks.iter().enumerate() {
        s.push_str("<w:p>");
        let numbering = numbering.and_then(|n| n.paragraphs[index]);
        if pstyle(b.kind).is_some() || numbering.is_some() {
            s.push_str("<w:pPr>");
        }
        if let Some(st) = pstyle(b.kind) {
            s.push_str("<w:pStyle w:val=\"");
            s.push_str(st);
            s.push_str("\"/>");
        }
        if let Some((id, level)) = numbering {
            s.push_str(&format!(
                "<w:numPr><w:ilvl w:val=\"{level}\"/><w:numId w:val=\"{id}\"/></w:numPr>"
            ));
        }
        if pstyle(b.kind).is_some() || numbering.is_some() {
            s.push_str("</w:pPr>");
        }
        for inl in &b.inlines {
            s.push_str("<w:r>");
            let mut pr = String::new();
            if let Some(highlight) = &inl.style.highlight {
                pr.push_str(&format!(
                    "<w:shd w:val=\"clear\" w:fill=\"{}\"/>",
                    &highlight[1..]
                ));
            }
            if let Some(size) = inl.style.font_size {
                let half_points = (size * 2.0) as u32;
                pr.push_str(&format!(
                    "<w:sz w:val=\"{half_points}\"/><w:szCs w:val=\"{half_points}\"/>"
                ));
            }
            if let Some(family) = &inl.style.font_family {
                let value = esc(family);
                pr.push_str(&format!(
                    "<w:rFonts w:ascii=\"{value}\" w:hAnsi=\"{value}\"/>"
                ));
            }
            if inl.style.bold {
                pr.push_str("<w:b/>");
            }
            if inl.style.italic {
                pr.push_str("<w:i/>");
            }
            if inl.style.underline {
                pr.push_str(r#"<w:u w:val="single"/>"#);
            }
            if inl.style.strike {
                pr.push_str("<w:strike/>");
            }
            if let Some(c) = &inl.style.color {
                pr.push_str("<w:color w:val=\"");
                pr.push_str(c.trim_start_matches('#'));
                pr.push_str("\"/>");
            }
            if !pr.is_empty() {
                s.push_str("<w:rPr>");
                s.push_str(&pr);
                s.push_str("</w:rPr>");
            }
            s.push_str(r#"<w:t xml:space="preserve">"#);
            s.push_str(&esc(&inl.text));
            s.push_str("</w:t></w:r>");
        }
        s.push_str("</w:p>");
    }
    s.push_str("</w:body></w:document>");
    s
}

/// Serialize `blocks` to a minimal valid .docx (ZIP bytes).
pub fn export_docx(blocks: &[Block]) -> Result<Vec<u8>, EngineError> {
    for inline in blocks.iter().flat_map(|block| &block.inlines) {
        if let Some(value) = &inline.style.highlight {
            crate::validate_highlight(value)?;
        }
    }
    let numbering = crate::numbering::project(blocks)?;
    let document = build_document_with_numbering(blocks, Some(&numbering));
    let cursor = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut put = |name: &str, body: &str| -> Result<(), EngineError> {
        zip.start_file(name, opts)
            .map_err(|e| EngineError::internal(format!("docx zip error: {e}")))?;
        zip.write_all(body.as_bytes())
            .map_err(|e| EngineError::internal(format!("docx zip error: {e}")))?;
        Ok(())
    };
    let types = if numbering.definitions.is_empty() {
        CONTENT_TYPES.to_owned()
    } else {
        CONTENT_TYPES.replace("</Types>","<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/></Types>")
    };
    put("[Content_Types].xml", &types)?;
    put("_rels/.rels", RELS)?;
    put("word/document.xml", &document)?;
    if !numbering.definitions.is_empty() {
        put("word/numbering.xml", &crate::numbering::export(&numbering))?;
        put(
            "word/_rels/document.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#,
        )?;
    }
    let cursor = zip
        .finish()
        .map_err(|e| EngineError::internal(format!("docx zip error: {e}")))?;
    Ok(cursor.into_inner())
}

fn local_name(qname: &[u8]) -> &[u8] {
    match qname.iter().rposition(|b| *b == b':') {
        Some(i) => &qname[i + 1..],
        None => qname,
    }
}

fn attr_val(e: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    for a in e.attributes().flatten() {
        if local_name(a.key.as_ref()) == key {
            return Some(String::from_utf8_lossy(&a.value).into_owned());
        }
    }
    None
}

fn run_shading(e: &BytesStart<'_>) -> Result<Option<String>, EngineError> {
    let mut fill = None;
    for attribute in e.attributes() {
        let attribute =
            attribute.map_err(|_| EngineError::validation("invalid run shading attribute"))?;
        let value = attribute
            .unescape_value()
            .map_err(|_| EngineError::validation("invalid run shading value"))?;
        match local_name(attribute.key.as_ref()) {
            b"fill" => fill = Some(format!("#{value}")),
            b"val" if value != "clear" => {
                return Err(EngineError::validation(
                    "patterned run shading is not supported",
                ))
            }
            b"themeFill" | b"themeFillTint" | b"themeFillShade" => {
                return Err(EngineError::validation(
                    "theme run shading is not supported",
                ))
            }
            _ => {}
        }
    }
    let value =
        fill.ok_or_else(|| EngineError::validation("run shading requires an explicit RGB fill"))?;
    crate::validate_highlight(&value)?;
    Ok(Some(value))
}

fn run_named_highlight(e: &BytesStart<'_>) -> Result<(), EngineError> {
    if attr_val(e, b"val").as_deref() != Some("none") {
        return Err(EngineError::validation(
            "named DOCX highlights are not supported; use explicit RGB run shading",
        ));
    }
    Ok(())
}

fn run_font_size(e: &BytesStart<'_>) -> Result<f64, EngineError> {
    for attribute in e.attributes() {
        let attribute =
            attribute.map_err(|_| EngineError::validation("invalid run size attribute"))?;
        if local_name(attribute.key.as_ref()) == b"val" {
            let value = attribute
                .unescape_value()
                .map_err(|_| EngineError::validation("invalid run size value"))?;
            let half_points: u32 = value.parse().map_err(|_| {
                EngineError::validation("run font size must be integer half-points")
            })?;
            let points = f64::from(half_points) / 2.0;
            crate::validate_font_size(points)?;
            return Ok(points);
        }
    }
    Err(EngineError::validation("run font size is missing val"))
}

// Only direct Latin run fonts are represented; theme/eastAsia/cs fonts remain outside this model.
fn run_font(e: &BytesStart<'_>) -> Result<Option<String>, EngineError> {
    for key in [b"ascii".as_slice(), b"hAnsi".as_slice()] {
        for attribute in e.attributes() {
            let attribute =
                attribute.map_err(|_| EngineError::validation("invalid run font attribute"))?;
            if local_name(attribute.key.as_ref()) == key {
                let value = attribute
                    .unescape_value()
                    .map_err(|_| EngineError::validation("invalid run font value"))?
                    .into_owned();
                crate::validate_font_family(&value)?;
                return Ok(Some(value));
            }
        }
    }
    Ok(None)
}

/// OOXML boolean attribute: absent/"true"/"1"/"on" → true; "0"/"false"/"off"/"none" → false.
fn attr_on(e: &BytesStart<'_>) -> bool {
    match attr_val(e, b"val") {
        Some(v) => !matches!(v.as_str(), "0" | "false" | "off" | "none"),
        None => true,
    }
}

/// Parse `word/document.xml` into blocks.
#[cfg(test)]
fn parse_document(xml: &str) -> Result<Vec<Block>, EngineError> {
    parse_document_with_numbering(xml, &std::collections::BTreeMap::new())
}
fn parse_document_with_numbering(
    xml: &str,
    numbering: &std::collections::BTreeMap<u64, crate::numbering::Parsed>,
) -> Result<Vec<Block>, EngineError> {
    let mut r = Reader::from_str(xml);
    let mut blocks: Vec<Block> = Vec::new();

    let mut in_p = false;
    let mut in_r = false;
    let mut in_t = false;
    let mut kind = BlockKind::Para;
    let mut inlines: Vec<Inline> = Vec::new();
    let mut style = Style::default();
    let mut complex_size: Option<f64> = None;
    let mut legacy_seen = std::collections::BTreeMap::<u64, usize>::new();
    let mut num_id: Option<u64> = None;
    let mut num_level = 0usize;
    let mut in_num_pr = false;
    let mut num_seen = false;
    let mut level_seen = false;
    let mut paragraph_indent = false;
    let mut text = String::new();

    loop {
        let event = r.read_event();
        if let Ok(Event::Start(e) | Event::Empty(e)) = &event {
            if in_num_pr
                && ![b"numPr".as_slice(), b"numId", b"ilvl"]
                    .contains(&local_name(e.name().as_ref()))
            {
                return Err(EngineError::unsupported(
                    "unsupported paragraph numbering property",
                ));
            }
            let q = e.name();
            let local = local_name(q.as_ref());
            if [b"numPr".as_slice(), b"numId", b"ilvl"].contains(&local) {
                if !q.as_ref().starts_with(b"w:") {
                    return Err(EngineError::unsupported(
                        "paragraph numbering needs admitted w prefix",
                    ));
                }
                for a in e.attributes() {
                    let a = a.map_err(|_| {
                        EngineError::validation("invalid numbering property attribute")
                    })?;
                    if a.key.as_ref() != b"w:val" {
                        return Err(EngineError::unsupported(
                            "unsupported paragraph numbering attribute",
                        ));
                    }
                }
            }
            if !numbering.is_empty() {
                for a in e.attributes() {
                    let a = a.map_err(|_| EngineError::validation("invalid XML attribute"))?;
                    if a.key.as_ref() == b"xmlns:w"
                        && a.value.as_ref()
                            != b"http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                    {
                        return Err(EngineError::unsupported(
                            "unsupported document numbering namespace",
                        ));
                    }
                }
            }
        }
        match event {
            Err(e) => {
                return Err(EngineError::serialization(format!(
                    "malformed document.xml: {e}"
                )))
            }
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => match local_name(e.name().as_ref()) {
                b"p" if !in_p => {
                    in_p = true;
                    kind = BlockKind::Para;
                    num_id = None;
                    num_level = 0;
                    in_num_pr = false;
                    num_seen = false;
                    level_seen = false;
                    paragraph_indent = false;
                    inlines.clear();
                }
                b"numPr" if in_p && !in_r => {
                    if num_seen {
                        return Err(EngineError::validation(
                            "duplicate paragraph numbering properties",
                        ));
                    }
                    num_seen = true;
                    in_num_pr = true;
                }
                b"numId" if in_num_pr => {
                    let value = attr_val(&e, b"val")
                        .ok_or_else(|| EngineError::validation("missing numId"))?;
                    if num_id
                        .replace(
                            value
                                .parse()
                                .map_err(|_| EngineError::validation("invalid numId"))?,
                        )
                        .is_some()
                    {
                        return Err(EngineError::validation("duplicate paragraph numId"));
                    }
                }
                b"ilvl" if in_num_pr => {
                    if level_seen {
                        return Err(EngineError::validation("duplicate paragraph ilvl"));
                    }
                    level_seen = true;
                    num_level = attr_val(&e, b"val")
                        .ok_or_else(|| EngineError::validation("missing ilvl"))?
                        .parse()
                        .map_err(|_| EngineError::validation("invalid ilvl"))?;
                    if num_level > 8 {
                        return Err(EngineError::validation("paragraph ilvl outside0..8"));
                    }
                }
                b"ind" if in_p && !in_r && !in_num_pr => paragraph_indent = true,
                b"pStyle" if in_p => {
                    if let Some(v) = attr_val(&e, b"val") {
                        kind = pstyle_kind(&v);
                    }
                }
                b"r" if in_p && !in_r => {
                    in_r = true;
                    style = Style::default();
                    complex_size = None;
                    text.clear();
                }
                b"t" if in_r => {
                    in_t = true;
                }
                b"shd" if in_r => style.highlight = run_shading(&e)?,
                b"highlight" if in_r => run_named_highlight(&e)?,
                b"sz" if in_r => style.font_size = Some(run_font_size(&e)?),
                b"szCs" if in_r => complex_size = Some(run_font_size(&e)?),
                b"rFonts" if in_r => style.font_family = run_font(&e)?,
                b"b" if in_r => style.bold = attr_on(&e),
                b"i" if in_r => style.italic = attr_on(&e),
                b"u" if in_r => {
                    style.underline = attr_val(&e, b"val").map(|v| v != "none").unwrap_or(true);
                }
                b"strike" if in_r => style.strike = attr_on(&e),
                b"color" if in_r => {
                    if let Some(v) = attr_val(&e, b"val") {
                        if v != "auto" {
                            style.color = Some(format!("#{}", v.trim_start_matches('#')));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match local_name(e.name().as_ref()) {
                b"p" => {
                    // self-contained empty paragraph
                    blocks.push(Block {
                        kind: BlockKind::Para,
                        list: None,
                        style_id: None,
                        table: None,
                        format: None,
                        inlines: Vec::new(),
                    });
                }
                b"numPr" if in_p && !in_r => {
                    return Err(EngineError::unsupported(
                        "empty/inherited paragraph numbering unsupported",
                    ))
                }
                b"numId" if in_num_pr => {
                    let value = attr_val(&e, b"val")
                        .ok_or_else(|| EngineError::validation("missing numId"))?;
                    if num_id
                        .replace(
                            value
                                .parse()
                                .map_err(|_| EngineError::validation("invalid numId"))?,
                        )
                        .is_some()
                    {
                        return Err(EngineError::validation("duplicate paragraph numId"));
                    }
                }
                b"ilvl" if in_num_pr => {
                    if level_seen {
                        return Err(EngineError::validation("duplicate paragraph ilvl"));
                    }
                    level_seen = true;
                    num_level = attr_val(&e, b"val")
                        .ok_or_else(|| EngineError::validation("missing ilvl"))?
                        .parse()
                        .map_err(|_| EngineError::validation("invalid ilvl"))?;
                    if num_level > 8 {
                        return Err(EngineError::validation("paragraph ilvl outside0..8"));
                    }
                }
                b"ind" if in_p && !in_r && !in_num_pr => paragraph_indent = true,
                b"pStyle" if in_p => {
                    if let Some(v) = attr_val(&e, b"val") {
                        kind = pstyle_kind(&v);
                    }
                }
                b"shd" if in_r => style.highlight = run_shading(&e)?,
                b"highlight" if in_r => run_named_highlight(&e)?,
                b"sz" if in_r => style.font_size = Some(run_font_size(&e)?),
                b"szCs" if in_r => complex_size = Some(run_font_size(&e)?),
                b"rFonts" if in_r => style.font_family = run_font(&e)?,
                b"b" if in_r => style.bold = attr_on(&e),
                b"i" if in_r => style.italic = attr_on(&e),
                b"u" if in_r => {
                    style.underline = attr_val(&e, b"val").map(|v| v != "none").unwrap_or(true);
                }
                b"strike" if in_r => style.strike = attr_on(&e),
                b"color" if in_r => {
                    if let Some(v) = attr_val(&e, b"val") {
                        if v != "auto" {
                            style.color = Some(format!("#{}", v.trim_start_matches('#')));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Text(e)) if in_t => {
                if let Ok(cow) = e.unescape() {
                    text.push_str(&cow);
                }
            }
            Ok(Event::End(e)) => {
                match local_name(e.name().as_ref()) {
                    b"numPr" => in_num_pr = false,
                    b"t" => in_t = false,
                    b"r" if in_r => {
                        in_r = false;
                        in_t = false;
                        if let (Some(latin), Some(complex)) = (style.font_size, complex_size) {
                            if latin != complex {
                                return Err(EngineError::validation("separate Latin and complex-script font sizes are not supported"));
                            }
                        }
                        if style.font_size.is_none() {
                            style.font_size = complex_size;
                        }
                        if !text.is_empty() {
                            inlines.push(Inline {
                                text: std::mem::take(&mut text),
                                style: style.clone(),
                            });
                        }
                    }
                    b"p" if in_p => {
                        in_p = false;
                        in_r = false;
                        in_t = false;
                        if num_seen && num_id.is_none() {
                            return Err(EngineError::unsupported(
                                "inherited paragraph numbering requires a style model",
                            ));
                        }
                        if !num_seen && kind == BlockKind::List {
                            kind = BlockKind::Para;
                        }
                        let list = if let Some(id) = num_id {
                            if id == 0 {
                                if kind == BlockKind::List {
                                    kind = BlockKind::Para;
                                }
                                None
                            } else {
                                if kind != BlockKind::Para && kind != BlockKind::List {
                                    return Err(EngineError::unsupported(
                                        "numbered headings/quotes need a combined block model",
                                    ));
                                }
                                if paragraph_indent {
                                    return Err(EngineError::unsupported("paragraph overrides of list indentation need a paragraph model"));
                                }
                                kind = BlockKind::List;
                                if numbering.get(&id).is_some_and(|d| d.legacy) {
                                    if legacy_seen
                                        .insert(id, blocks.len())
                                        .is_some_and(|last| last + 1 != blocks.len())
                                    {
                                        return Err(EngineError::unsupported("legacy bullet sentinel must be one contiguous level0 run"));
                                    }
                                }
                                crate::numbering::item(numbering, id, num_level)?
                            }
                        } else {
                            None
                        };
                        blocks.push(Block {
                            kind,
                            list,
                            style_id: None,
                            table: None,
                            format: None,
                            inlines: normalize_inlines(std::mem::take(&mut inlines)),
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    if blocks.is_empty() {
        blocks.push(Block {
            kind: BlockKind::Para,
            list: None,
            style_id: None,
            table: None,
            format: None,
            inlines: Vec::new(),
        });
    }
    Ok(blocks)
}

/// Decode a .docx (ZIP) into blocks. Malformed input → `Serialization`.
pub fn import_docx(bytes: &[u8]) -> Result<Vec<Block>, EngineError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| EngineError::serialization(format!("invalid docx zip: {e}")))?;
    // Bound the decompression: a crafted docx (zip bomb) must not inflate to
    // uncontrolled memory.
    const MAX_DOCX_XML: u64 = 256 * 1024 * 1024;
    let mut buf = Vec::new();
    let read = archive
        .by_name("word/document.xml")
        .map_err(|_| EngineError::serialization("docx missing word/document.xml"))?
        .take(MAX_DOCX_XML + 1)
        .read_to_end(&mut buf)
        .map_err(|e| EngineError::serialization(format!("document.xml unreadable: {e}")))?;
    if read as u64 > MAX_DOCX_XML {
        return Err(EngineError::serialization(
            "document.xml exceeds size limit",
        ));
    }
    let xml = String::from_utf8(buf)
        .map_err(|_| EngineError::serialization("document.xml is not valid UTF-8"))?;
    let rels = match archive.by_name("word/_rels/document.xml.rels") {
        Ok(mut f) => {
            let mut value = String::new();
            f.by_ref()
                .take(1024 * 1024 + 1)
                .read_to_string(&mut value)
                .map_err(|_| EngineError::serialization("unreadable document relationships"))?;
            Some(value)
        }
        Err(zip::result::ZipError::FileNotFound) => None,
        Err(e) => {
            return Err(EngineError::serialization(format!(
                "invalid document relationships: {e}"
            )))
        }
    };
    let target = rels
        .as_deref()
        .map(crate::numbering::relationship)
        .transpose()?
        .flatten();
    if let Some(styles) = rels
        .as_deref()
        .map(|r| crate::numbering::part_relationship(r, "styles"))
        .transpose()?
        .flatten()
    {
        let mut xml = String::new();
        archive
            .by_name(&styles)
            .map_err(|_| EngineError::serialization("styles relationship target missing"))?
            .take(4 * 1024 * 1024 + 1)
            .read_to_string(&mut xml)
            .map_err(|_| EngineError::serialization("unreadable styles part"))?;
        if xml.len() > 4 * 1024 * 1024 {
            return Err(EngineError::validation("styles inspection exceeds4MiB"));
        }
        let mut styles = Reader::from_str(&xml);
        loop {
            match styles
                .read_event()
                .map_err(|_| EngineError::serialization("malformed styles XML"))?
            {
                Event::Eof => break,
                Event::Start(e) | Event::Empty(e) if local_name(e.name().as_ref()) == b"numPr" => {
                    return Err(EngineError::unsupported(
                        "style-inherited numbering needs a style evaluator",
                    ))
                }
                _ => {}
            }
        }
    }
    let numbering = if let Some(target) = target {
        let mut part = String::new();
        archive
            .by_name(&target)
            .map_err(|_| EngineError::serialization("numbering relationship target missing"))?
            .take(4 * 1024 * 1024 + 1)
            .read_to_string(&mut part)
            .map_err(|_| EngineError::serialization("unreadable numbering part"))?;
        crate::numbering::parse(&part)?
    } else {
        std::collections::BTreeMap::new()
    };
    let blocks = parse_document_with_numbering(&xml, &numbering)?;
    crate::lists::validate(&blocks)?;
    Ok(blocks)
}

#[cfg(test)]
mod font_size_tests {
    use super::*;

    #[test]
    fn exact_half_point_elements_and_complex_size_fallback() {
        for properties in [
            "<w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/>",
            "<w:szCs w:val=\"21\"></w:szCs><w:sz w:val=\"21\"></w:sz>",
            "<w:szCs w:val=\"21\"/>",
        ] {
            let xml = format!("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:rPr>{properties}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>");
            let blocks = parse_document(&xml).unwrap();
            assert_eq!(blocks[0].inlines[0].style.font_size, Some(10.5));
            let exported = build_document_xml(&blocks);
            assert!(exported.contains("<w:sz w:val=\"21\"/><w:szCs w:val=\"21\"/>"));
        }
    }

    #[test]
    fn malformed_or_unrepresentable_docx_sizes_reject() {
        for properties in [
            "<w:sz w:val=\"21.5\"/>",
            "<w:sz w:val=\"0\"/>",
            "<w:sz w:val=\"3277\"/>",
            "<w:sz/>",
            "<w:sz w:val=\"20\"/><w:szCs w:val=\"21\"/>",
        ] {
            let xml = format!("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:rPr>{properties}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>");
            assert!(parse_document(&xml).is_err());
        }
    }
}

#[cfg(test)]
mod highlight_tests {
    use super::*;

    #[test]
    fn rgb_shading_preserves_color_without_named_palette_quantization() {
        for element in [
            "<w:shd w:val=\"clear\" w:fill=\"12aBcF\"/>",
            "<w:shd w:fill=\"12aBcF\"></w:shd>",
        ] {
            let xml = format!("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:rPr>{element}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>");
            let blocks = parse_document(&xml).unwrap();
            assert_eq!(
                blocks[0].inlines[0].style.highlight.as_deref(),
                Some("#12aBcF")
            );
            assert!(build_document_xml(&blocks).contains("w:fill=\"12aBcF\""));
        }
    }

    #[test]
    fn unsupported_highlight_and_shading_are_not_silently_lost() {
        for element in [
            "<w:highlight w:val=\"yellow\"/>",
            "<w:shd w:fill=\"auto\"/>",
            "<w:shd w:fill=\"FFFF00\" w:val=\"pct50\"/>",
            "<w:shd w:themeFill=\"accent1\" w:fill=\"FFFF00\"/>",
            "<w:shd/>",
        ] {
            let xml = format!("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:rPr>{element}</w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>");
            assert!(parse_document(&xml).is_err());
        }
        let blocks = parse_document("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:rPr><w:highlight w:val=\"none\"/></w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>").unwrap();
        assert_eq!(blocks[0].inlines[0].style.highlight, None);
    }
}

#[cfg(test)]
mod numbering_package_tests {
    use super::*;
    use ignition_core::Engine;
    fn numbered() -> Vec<Block> {
        let mut engine = crate::QuillEngine::new();
        engine
            .apply(ignition_core::Command::new(
                "insertText",
                serde_json::json!({"at":{"block":0,"offset":0},"text":"First\nSecond"}),
            ))
            .unwrap();
        engine
            .apply(ignition_core::Command::new(
                "setListKind",
                serde_json::json!({"first":0,"last":1,"kind":"numbered"}),
            ))
            .unwrap();
        engine.blocks
    }
    fn rewrite(bytes: &[u8], name: &str, replacement: Option<String>) -> Vec<u8> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let mut found = false;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let path = file.name().to_string();
            let mut data = vec![];
            file.read_to_end(&mut data).unwrap();
            if path == name {
                found = true;
                if let Some(text) = &replacement {
                    data = text.as_bytes().to_vec();
                } else {
                    continue;
                }
            }
            writer
                .start_file(path, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&data).unwrap();
        }
        if !found {
            if let Some(text) = replacement {
                writer
                    .start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                writer.write_all(text.as_bytes()).unwrap();
            }
        }
        writer.finish().unwrap().into_inner()
    }
    fn part(bytes: &[u8], name: &str) -> String {
        let mut a = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut s = String::new();
        a.by_name(name).unwrap().read_to_string(&mut s).unwrap();
        s
    }
    #[test]
    fn real_package_rel_type_numpr_and_invalid_import_preserve_live_document_and_redo() {
        let blocks = numbered();
        let bytes = export_docx(&blocks).unwrap();
        assert!(part(&bytes, "[Content_Types].xml").contains("numbering+xml"));
        assert!(part(&bytes, "word/_rels/document.xml.rels").contains("relationships/numbering"));
        let document = part(&bytes, "word/document.xml");
        let mut e = crate::QuillEngine::new();
        e.blocks = blocks.clone();
        e.apply(ignition_core::Command::new(
            "setListFormat",
            serde_json::json!({"first":0,"last":1,"level":0,"format":"upperRoman"}),
        ))
        .unwrap();
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for bad in [
            rewrite(&bytes, "word/numbering.xml", None),
            rewrite(&bytes, "word/_rels/document.xml.rels", None),
            rewrite(
                &bytes,
                "word/document.xml",
                Some(document.replace("<w:ilvl w:val=\"0\"/>", "<w:ilvl w:val=\"9\"/>")),
            ),
            rewrite(
                &bytes,
                "word/document.xml",
                Some(document.replace("<w:numId w:val=\"1\"/>", "<w:numId w:val=\"999\"/>")),
            ),
            rewrite(
                &bytes,
                "word/numbering.xml",
                Some(part(&bytes, "word/numbering.xml").replace("%1.", "%1.%2.")),
            ),
        ] {
            assert!(e
                .apply(ignition_core::Command::new(
                    "importDocx",
                    serde_json::json!({"bytes_b64":crate::base64_encode(&bad)})
                ))
                .is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        let indentation = document.replace("<w:pPr>", "<w:pPr><w:ind w:left=\"1440\"/>");
        assert!(import_docx(&rewrite(&bytes, "word/document.xml", Some(indentation))).is_err());
        let rels=part(&bytes,"word/_rels/document.xml.rels").replace("</Relationships>",r#"<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#);
        let inherited=rewrite(&rewrite(&bytes,"word/_rels/document.xml.rels",Some(rels)),"word/styles.xml",Some(r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="List"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>"#.into()));
        assert!(import_docx(&inherited).is_err());
        assert!(e.redo().unwrap());
    }
    #[test]
    fn style_only_listparagraph_is_not_invented_numbering_and_duplicate_numpr_rejects() {
        let xml="<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:pPr><w:pStyle w:val=\"ListParagraph\"/></w:pPr><w:r><w:t>No retained numbering</w:t></w:r></w:p></w:body></w:document>";
        assert_eq!(parse_document(xml).unwrap()[0].kind, BlockKind::Para);
        let blocks = numbered();
        let bytes = export_docx(&blocks).unwrap();
        let body = part(&bytes, "word/document.xml");
        let duplicate = body.replace(
            "<w:numId w:val=\"1\"/>",
            "<w:numId w:val=\"1\"/><w:numId w:val=\"1\"/>",
        );
        assert!(import_docx(&rewrite(&bytes, "word/document.xml", Some(duplicate))).is_err());
    }
}
