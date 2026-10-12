//! Minimal real .docx export/import.
//!
//! A .docx is a ZIP package. We emit the three required parts:
//! `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`. Blocks map to
//! `<w:p>` paragraphs (with `<w:pStyle>` for non-para kinds) and inlines map to
//! `<w:r>` runs carrying `<w:b/>`, `<w:i/>`, `<w:u/>`, `<w:strike/>` and
//! `<w:color/>` run properties.

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

fn build_document_xml(blocks: &[Block]) -> String {
    let mut s = String::with_capacity(blocks.len() * 64 + 256);
    s.push_str(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
    );
    s.push_str(
        r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
    );
    for b in blocks {
        s.push_str("<w:p>");
        if let Some(st) = pstyle(b.kind) {
            s.push_str("<w:pPr><w:pStyle w:val=\"");
            s.push_str(st);
            s.push_str("\"/></w:pPr>");
        }
        for inl in &b.inlines {
            s.push_str("<w:r>");
            let mut pr = String::new();
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
    let document = build_document_xml(blocks);
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
    put("[Content_Types].xml", CONTENT_TYPES)?;
    put("_rels/.rels", RELS)?;
    put("word/document.xml", &document)?;
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

/// OOXML boolean attribute: absent/"true"/"1"/"on" → true; "0"/"false"/"off"/"none" → false.
fn attr_on(e: &BytesStart<'_>) -> bool {
    match attr_val(e, b"val") {
        Some(v) => !matches!(v.as_str(), "0" | "false" | "off" | "none"),
        None => true,
    }
}

/// Parse `word/document.xml` into blocks.
fn parse_document(xml: &str) -> Result<Vec<Block>, EngineError> {
    let mut r = Reader::from_str(xml);
    let mut blocks: Vec<Block> = Vec::new();

    let mut in_p = false;
    let mut in_r = false;
    let mut in_t = false;
    let mut kind = BlockKind::Para;
    let mut inlines: Vec<Inline> = Vec::new();
    let mut style = Style::default();
    let mut text = String::new();

    loop {
        match r.read_event() {
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
                    inlines.clear();
                }
                b"pStyle" if in_p => {
                    if let Some(v) = attr_val(&e, b"val") {
                        kind = pstyle_kind(&v);
                    }
                }
                b"r" if in_p && !in_r => {
                    in_r = true;
                    style = Style::default();
                    text.clear();
                }
                b"t" if in_r => {
                    in_t = true;
                }
                b"b" if in_r => style.bold = attr_on(&e),
                b"i" if in_r => style.italic = attr_on(&e),
                b"u" if in_r => {
                    style.underline = attr_val(&e, b"val")
                        .map(|v| v != "none")
                        .unwrap_or(true);
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
                        inlines: Vec::new(),
                    });
                }
                b"pStyle" if in_p => {
                    if let Some(v) = attr_val(&e, b"val") {
                        kind = pstyle_kind(&v);
                    }
                }
                b"b" if in_r => style.bold = attr_on(&e),
                b"i" if in_r => style.italic = attr_on(&e),
                b"u" if in_r => {
                    style.underline = attr_val(&e, b"val")
                        .map(|v| v != "none")
                        .unwrap_or(true);
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
            Ok(Event::End(e)) => match local_name(e.name().as_ref()) {
                b"t" => in_t = false,
                b"r" if in_r => {
                    in_r = false;
                    in_t = false;
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
                    blocks.push(Block {
                        kind,
                        inlines: normalize_inlines(std::mem::take(&mut inlines)),
                    });
                }
                _ => {}
            },
            _ => {}
        }
    }

    if blocks.is_empty() {
        blocks.push(Block {
            kind: BlockKind::Para,
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
        return Err(EngineError::serialization("document.xml exceeds size limit"));
    }
    let xml = String::from_utf8(buf)
        .map_err(|_| EngineError::serialization("document.xml is not valid UTF-8"))?;
    parse_document(&xml)
}
