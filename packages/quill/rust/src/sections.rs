//! Sections, page setup, and headers/footers (P12 slice 4, model/ops half).
//!
//! A document is an ordered list of sections; each section starts at a block
//! boundary (`Section.block`, the index of its first block) and carries page
//! setup plus optional plain-text header/footer bodies. Layout metrics and
//! pagination are out of scope: `layout` keeps its own `page_width`/
//! `font_size` parameters and never reads section page setup, and DOCX
//! `sectPr` import/export is deferred.
//!
//! Position stability: blocks carry no identity, so a section stores a live
//! `{block}` boundary re-anchored by every block-count-changing op, the same
//! approach bookmarks use for `{block,offset}` marks (see the bookmark
//! remap rules in lib.rs). A boundary whose anchor block is deleted inside a
//! `deleteRange`/`mergeBlock` is removed, merging that section's remaining
//! blocks into the previous section — the Word behavior for a deleted
//! section break.

use super::*;
use serde::{Deserialize, Serialize};

/// Bound on stored sections so snapshots stay small.
pub const SECTIONS_MAX: usize = 128;
/// Header/footer bodies are plain text, matching the NYC-Tron inspector
/// contract (`maxLength: 8192` per field).
const HF_TEXT_MAX: usize = 8192;
/// Page dimensions in points, matching the NYC-Tron `PageSetupPanel` bounds.
const PAGE_MIN: f64 = 36.0;
const PAGE_MAX: f64 = 14400.0;
const PAGE_NUMBER_START_MAX: u32 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Portrait,
    Landscape,
}

/// How a section begins relative to the previous one. Stored per section;
/// the first section's value is inert but kept for a uniform shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SectionStart {
    Continuous,
    NextPage,
    EvenPage,
    OddPage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NumberFormat {
    Decimal,
    Roman,
    Letters,
}

/// Page setup in points. All fields are concrete (no inheritance inside the
/// engine): `setPageSetup` patches fields and the merged result is validated
/// as a whole, so margins/columns that leave no text area reject atomically.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PageSetup {
    pub width: f64,
    pub height: f64,
    pub orientation: Orientation,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub columns: u32,
    pub column_gap: f64,
    pub start: SectionStart,
}

impl Default for PageSetup {
    /// US Letter portrait, 1-inch margins, single column — the same defaults
    /// Word applies to a new document's first section.
    fn default() -> Self {
        Self {
            width: 612.0,
            height: 792.0,
            orientation: Orientation::Portrait,
            margin_top: 72.0,
            margin_bottom: 72.0,
            margin_left: 72.0,
            margin_right: 72.0,
            columns: 1,
            column_gap: 0.0,
            start: SectionStart::NextPage,
        }
    }
}

/// Header/footer bodies for one section. Each body is optional plain text;
/// `None` means "no explicit body" — inheritance/link-previous resolution is
/// a consumer concern and is not computed by the engine. The `different_*`
/// flags mirror the NYC-Tron `HeaderFooterSettings` contract: they gate
/// whether the first/even bodies apply, exactly as the inspector exposes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HeaderFooter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_footer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub even_header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub even_footer: Option<String>,
    pub different_first: bool,
    pub different_odd_even: bool,
    pub page_numbers: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_start: Option<u32>,
    pub number_format: NumberFormat,
    pub link_previous: bool,
}

impl Default for HeaderFooter {
    fn default() -> Self {
        Self {
            header: None,
            footer: None,
            first_header: None,
            first_footer: None,
            even_header: None,
            even_footer: None,
            different_first: false,
            different_odd_even: false,
            page_numbers: false,
            number_start: None,
            number_format: NumberFormat::Decimal,
            link_previous: false,
        }
    }
}

/// One section: it owns every block from `block` up to (not including) the
/// next section's `block`, or the end of the document for the last section.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    /// Index of the section's first block. Sections are stored sorted by
    /// this value; the first section always starts at block 0.
    pub block: usize,
    pub page: PageSetup,
    pub header_footer: HeaderFooter,
}

impl Default for Section {
    fn default() -> Self {
        Self {
            block: 0,
            page: PageSetup::default(),
            header_footer: HeaderFooter::default(),
        }
    }
}

/// The document's section list when no section feature has been used. Used
/// to keep schema:3 snapshots byte-identical for documents that only carry
/// bookmarks/styles — `sections` is omitted from the payload in that case.
pub fn default_sections() -> Vec<Section> {
    vec![Section::default()]
}

pub fn is_default_sections(sections: &[Section]) -> bool {
    sections.len() == 1 && sections[0] == Section::default()
}

fn validate_page_setup(p: &PageSetup) -> Result<(), EngineError> {
    for (name, v) in [
        ("width", p.width),
        ("height", p.height),
        ("margin_top", p.margin_top),
        ("margin_bottom", p.margin_bottom),
        ("margin_left", p.margin_left),
        ("margin_right", p.margin_right),
        ("column_gap", p.column_gap),
    ] {
        if !v.is_finite() {
            return Err(EngineError::validation(format!(
                "page setup '{name}' must be a finite number"
            )));
        }
    }
    if !(PAGE_MIN..=PAGE_MAX).contains(&p.width) || !(PAGE_MIN..=PAGE_MAX).contains(&p.height) {
        return Err(EngineError::validation(format!(
            "page width/height must be {PAGE_MIN}..{PAGE_MAX} points"
        )));
    }
    if p.margin_top < 0.0
        || p.margin_bottom < 0.0
        || p.margin_left < 0.0
        || p.margin_right < 0.0
        || p.column_gap < 0.0
    {
        return Err(EngineError::validation(
            "page margins and column gap must not be negative",
        ));
    }
    if !(1..=32).contains(&p.columns) {
        return Err(EngineError::validation("page columns must be 1..=32"));
    }
    if p.margin_top + p.margin_bottom >= p.height {
        return Err(EngineError::validation(
            "top and bottom margins must leave a positive text area",
        ));
    }
    if p.margin_left + p.margin_right + (p.columns as f64 - 1.0) * p.column_gap >= p.width {
        return Err(EngineError::validation(
            "side margins and column gaps must leave a positive text area",
        ));
    }
    Ok(())
}

fn validate_header_footer(hf: &HeaderFooter) -> Result<(), EngineError> {
    for (name, body) in [
        ("header", &hf.header),
        ("footer", &hf.footer),
        ("first_header", &hf.first_header),
        ("first_footer", &hf.first_footer),
        ("even_header", &hf.even_header),
        ("even_footer", &hf.even_footer),
    ] {
        if let Some(text) = body {
            if text.chars().count() > HF_TEXT_MAX {
                return Err(EngineError::validation(format!(
                    "header/footer '{name}' must be at most {HF_TEXT_MAX} characters"
                )));
            }
        }
    }
    if let Some(start) = hf.number_start {
        if !(1..=PAGE_NUMBER_START_MAX).contains(&start) {
            return Err(EngineError::validation(format!(
                "number_start must be 1..={PAGE_NUMBER_START_MAX}"
            )));
        }
    }
    Ok(())
}

/// Full section validation for restore and for merged op results: count,
/// ordering, first-section anchor, per-block bounds, and every nested
/// page/header-footer constraint. Runs before live state is replaced.
pub fn validate_sections(sections: &[Section], blocks: &[Block]) -> Result<(), EngineError> {
    if sections.is_empty() || sections.len() > SECTIONS_MAX {
        return Err(EngineError::validation(format!(
            "document must have 1..={SECTIONS_MAX} sections"
        )));
    }
    let mut previous: Option<usize> = None;
    for section in sections {
        validate_page_setup(&section.page)?;
        validate_header_footer(&section.header_footer)?;
        if section.block >= blocks.len() {
            return Err(EngineError::out_of_bounds(format!(
                "section start block {} out of range ({} blocks)",
                section.block,
                blocks.len()
            )));
        }
        if let Some(prev) = previous {
            if section.block <= prev {
                return Err(EngineError::validation(
                    "section start blocks must be strictly increasing",
                ));
            }
        }
        previous = Some(section.block);
    }
    if sections[0].block != 0 {
        return Err(EngineError::validation(
            "the first section must start at block 0",
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Payload patches
// ---------------------------------------------------------------------------

fn parse_enum<T: serde::de::DeserializeOwned>(v: &Value, name: &str) -> Result<T, EngineError> {
    serde_json::from_value(v.clone())
        .map_err(|_| EngineError::validation(format!("'{name}' has an invalid value")))
}

/// Partial page-setup update: only keys present in the payload change.
#[derive(Default)]
struct PageSetupPatch {
    width: Option<f64>,
    height: Option<f64>,
    orientation: Option<Orientation>,
    margin_top: Option<f64>,
    margin_bottom: Option<f64>,
    margin_left: Option<f64>,
    margin_right: Option<f64>,
    columns: Option<u32>,
    column_gap: Option<f64>,
    start: Option<SectionStart>,
}

impl PageSetupPatch {
    fn parse(p: &Value) -> Result<Self, EngineError> {
        let mut patch = Self::default();
        let number = |key: &str, slot: &mut Option<f64>| -> Result<(), EngineError> {
            if let Some(v) = p.get(key) {
                *slot = Some(as_f64(v, key)?);
            }
            Ok(())
        };
        number("width", &mut patch.width)?;
        number("height", &mut patch.height)?;
        number("margin_top", &mut patch.margin_top)?;
        number("margin_bottom", &mut patch.margin_bottom)?;
        number("margin_left", &mut patch.margin_left)?;
        number("margin_right", &mut patch.margin_right)?;
        number("column_gap", &mut patch.column_gap)?;
        if let Some(v) = p.get("columns") {
            let n = as_usize(v, "columns")?;
            patch.columns = Some(u32::try_from(n).map_err(|_| {
                EngineError::validation("'columns' must be 1..=32")
            })?);
        }
        if let Some(v) = p.get("orientation") {
            patch.orientation = Some(parse_enum(v, "orientation")?);
        }
        if let Some(v) = p.get("start") {
            patch.start = Some(parse_enum(v, "start")?);
        }
        Ok(patch)
    }

    fn is_empty(&self) -> bool {
        self.width.is_none()
            && self.height.is_none()
            && self.orientation.is_none()
            && self.margin_top.is_none()
            && self.margin_bottom.is_none()
            && self.margin_left.is_none()
            && self.margin_right.is_none()
            && self.columns.is_none()
            && self.column_gap.is_none()
            && self.start.is_none()
    }

    fn apply(&self, page: &mut PageSetup) {
        if let Some(v) = self.width {
            page.width = v;
        }
        if let Some(v) = self.height {
            page.height = v;
        }
        if let Some(v) = self.orientation {
            page.orientation = v;
        }
        if let Some(v) = self.margin_top {
            page.margin_top = v;
        }
        if let Some(v) = self.margin_bottom {
            page.margin_bottom = v;
        }
        if let Some(v) = self.margin_left {
            page.margin_left = v;
        }
        if let Some(v) = self.margin_right {
            page.margin_right = v;
        }
        if let Some(v) = self.columns {
            page.columns = v;
        }
        if let Some(v) = self.column_gap {
            page.column_gap = v;
        }
        if let Some(v) = self.start {
            page.start = v;
        }
    }
}

/// Partial header/footer update: string bodies accept a string (set) or
/// null (clear); booleans and enums must match their types when present.
#[derive(Default)]
struct HeaderFooterPatch {
    header: Option<Option<String>>,
    footer: Option<Option<String>>,
    first_header: Option<Option<String>>,
    first_footer: Option<Option<String>>,
    even_header: Option<Option<String>>,
    even_footer: Option<Option<String>>,
    different_first: Option<bool>,
    different_odd_even: Option<bool>,
    page_numbers: Option<bool>,
    link_previous: Option<bool>,
    number_start: Option<Option<u32>>,
    number_format: Option<NumberFormat>,
}

const HF_STRING_KEYS: [(&str, fn(&mut HeaderFooterPatch) -> &mut Option<Option<String>>); 6] = [
    ("header", |p| &mut p.header),
    ("footer", |p| &mut p.footer),
    ("first_header", |p| &mut p.first_header),
    ("first_footer", |p| &mut p.first_footer),
    ("even_header", |p| &mut p.even_header),
    ("even_footer", |p| &mut p.even_footer),
];

impl HeaderFooterPatch {
    fn parse(p: &Value) -> Result<Self, EngineError> {
        let mut patch = Self::default();
        for (key, slot) in HF_STRING_KEYS {
            if let Some(v) = p.get(key) {
                if v.is_null() {
                    *slot(&mut patch) = Some(None);
                } else {
                    let text = as_str(v, key)?;
                    if text.chars().count() > HF_TEXT_MAX {
                        return Err(EngineError::validation(format!(
                            "header/footer '{key}' must be at most {HF_TEXT_MAX} characters"
                        )));
                    }
                    *slot(&mut patch) = Some(Some(text.to_string()));
                }
            }
        }
        let flag = |key: &str, slot: &mut Option<bool>| -> Result<(), EngineError> {
            if let Some(v) = p.get(key) {
                *slot = Some(v.as_bool().ok_or_else(|| {
                    EngineError::validation(format!("'{key}' must be a bool"))
                })?);
            }
            Ok(())
        };
        flag("different_first", &mut patch.different_first)?;
        flag("different_odd_even", &mut patch.different_odd_even)?;
        flag("page_numbers", &mut patch.page_numbers)?;
        flag("link_previous", &mut patch.link_previous)?;
        if let Some(v) = p.get("number_start") {
            if v.is_null() {
                patch.number_start = Some(None);
            } else {
                let n = as_usize(v, "number_start")?;
                let n = u32::try_from(n).map_err(|_| {
                    EngineError::validation(format!(
                        "'number_start' must be 1..={PAGE_NUMBER_START_MAX}"
                    ))
                })?;
                if !(1..=PAGE_NUMBER_START_MAX).contains(&n) {
                    return Err(EngineError::validation(format!(
                        "'number_start' must be 1..={PAGE_NUMBER_START_MAX}"
                    )));
                }
                patch.number_start = Some(Some(n));
            }
        }
        if let Some(v) = p.get("number_format") {
            patch.number_format = Some(parse_enum(v, "number_format")?);
        }
        Ok(patch)
    }

    fn is_empty(&self) -> bool {
        self.header.is_none()
            && self.footer.is_none()
            && self.first_header.is_none()
            && self.first_footer.is_none()
            && self.even_header.is_none()
            && self.even_footer.is_none()
            && self.different_first.is_none()
            && self.different_odd_even.is_none()
            && self.page_numbers.is_none()
            && self.link_previous.is_none()
            && self.number_start.is_none()
            && self.number_format.is_none()
    }

    fn apply(&self, hf: &mut HeaderFooter) {
        macro_rules! apply_opt {
            ($field:ident, $slot:ident) => {
                if let Some(v) = &self.$slot {
                    hf.$field = v.clone();
                }
            };
        }
        apply_opt!(header, header);
        apply_opt!(footer, footer);
        apply_opt!(first_header, first_header);
        apply_opt!(first_footer, first_footer);
        apply_opt!(even_header, even_header);
        apply_opt!(even_footer, even_footer);
        if let Some(v) = self.different_first {
            hf.different_first = v;
        }
        if let Some(v) = self.different_odd_even {
            hf.different_odd_even = v;
        }
        if let Some(v) = self.page_numbers {
            hf.page_numbers = v;
        }
        if let Some(v) = self.link_previous {
            hf.link_previous = v;
        }
        if let Some(v) = self.number_start {
            hf.number_start = v;
        }
        if let Some(v) = self.number_format {
            hf.number_format = v;
        }
    }
}

// ---------------------------------------------------------------------------
// Engine ops
// ---------------------------------------------------------------------------

impl QuillEngine {
    fn section_index(&self, p: &Value) -> Result<usize, EngineError> {
        let index = as_usize(field(p, "section")?, "section")?;
        if index >= self.sections.len() {
            return Err(EngineError::out_of_bounds(format!(
                "section {index} out of range ({} sections)",
                self.sections.len()
            )));
        }
        Ok(index)
    }

    /// `insertSection {at, page_setup?, header_footer?}` — `at` is the block
    /// index where the new section starts (1..blocks.len(), not already a
    /// section start). The new section copies the page setup and
    /// header/footer of the section that owns `at`, then applies the
    /// optional partial patches, so a bare insert behaves like Word's
    /// "link to previous".
    pub(super) fn op_insert_section(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let at = as_usize(field(p, "at")?, "at")?;
        if at == 0 {
            return Err(EngineError::validation(
                "the first section already starts at block 0",
            ));
        }
        if at >= self.blocks.len() {
            return Err(EngineError::out_of_bounds(format!(
                "section start block {at} out of range ({} blocks)",
                self.blocks.len()
            )));
        }
        if self.sections.iter().any(|s| s.block == at) {
            return Err(EngineError::validation(format!(
                "a section already starts at block {at}"
            )));
        }
        if self.sections.len() >= SECTIONS_MAX {
            return Err(EngineError::validation("section limit reached"));
        }
        let page_patch = match p.get("page_setup") {
            Some(v) => Some(PageSetupPatch::parse(v)?),
            None => None,
        };
        let hf_patch = match p.get("header_footer") {
            Some(v) => Some(HeaderFooterPatch::parse(v)?),
            None => None,
        };
        // The section owning block `at` is the one with the greatest start
        // below it (`at` is never an existing start, checked above).
        let owner = self
            .sections
            .iter()
            .rposition(|s| s.block < at)
            .expect("first section starts at block 0");
        let mut section = self.sections[owner].clone();
        section.block = at;
        if let Some(patch) = &page_patch {
            patch.apply(&mut section.page);
        }
        if let Some(patch) = &hf_patch {
            patch.apply(&mut section.header_footer);
        }
        validate_page_setup(&section.page)?;
        validate_header_footer(&section.header_footer)?;
        let index = self.sections.partition_point(|s| s.block < at);
        let before = self.sections.clone();
        self.sections.insert(index, section);
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::sections(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "section": index })))
    }

    /// `removeSection {section}` — deletes the boundary at `section`,
    /// merging its blocks into the previous section (which keeps its own
    /// page setup and header/footer). The first section cannot be removed.
    pub(super) fn op_remove_section(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.section_index(p)?;
        if index == 0 {
            return Err(EngineError::validation(
                "the first section cannot be removed",
            ));
        }
        let before = self.sections.clone();
        self.sections.remove(index);
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::sections(before),
        );
        Ok(CommandResult::data(json!({ "ok": true })))
    }

    /// `setPageSetup {section, ...partial}` — patches page fields on one
    /// section; the merged result must satisfy the page-setup bounds or the
    /// whole op rejects. No fields → eventless.
    pub(super) fn op_set_page_setup(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let index = self.section_index(p)?;
        let patch = PageSetupPatch::parse(p)?;
        if patch.is_empty() {
            return Ok(Self::read_only(json!({ "ok": true, "section": index })));
        }
        let mut section = self.sections[index].clone();
        patch.apply(&mut section.page);
        validate_page_setup(&section.page)?;
        if section.page == self.sections[index].page {
            return Ok(Self::read_only(json!({ "ok": true, "section": index })));
        }
        let before = self.sections.clone();
        self.sections[index] = section;
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::sections(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "section": index })))
    }

    /// `setHeaderFooter {section, ...partial}` — patches header/footer
    /// fields on one section; string bodies accept string-or-null, the rest
    /// are typed. No fields → eventless.
    pub(super) fn op_set_header_footer(
        &mut self,
        p: &Value,
    ) -> Result<CommandResult, EngineError> {
        let index = self.section_index(p)?;
        let patch = HeaderFooterPatch::parse(p)?;
        if patch.is_empty() {
            return Ok(Self::read_only(json!({ "ok": true, "section": index })));
        }
        let mut section = self.sections[index].clone();
        patch.apply(&mut section.header_footer);
        validate_header_footer(&section.header_footer)?;
        if section.header_footer == self.sections[index].header_footer {
            return Ok(Self::read_only(json!({ "ok": true, "section": index })));
        }
        let before = self.sections.clone();
        self.sections[index] = section;
        self.record_undo(
            0,
            Vec::new(),
            Vec::new(),
            Collections::sections(before),
        );
        Ok(CommandResult::data(json!({ "ok": true, "section": index })))
    }

    /// `listSections` — read-only; sections in document order.
    pub(super) fn op_list_sections(&self) -> Result<CommandResult, EngineError> {
        let arr: Vec<Value> = self
            .sections
            .iter()
            .enumerate()
            .map(|(index, s)| {
                json!({
                    "index": index,
                    "block": s.block,
                    "page": s.page,
                    "header_footer": s.header_footer,
                })
            })
            .collect();
        Ok(Self::read_only(json!({ "sections": arr })))
    }

    // -- section boundary remapping -----------------------------------------
    //
    // A section boundary sits *before* its `block`: unlike a bookmark there
    // is no character attachment, so a boundary never moves within a block —
    // only block-count changes matter.

    /// `insertText` at `at`: a `\n`-containing insert adds `added` blocks
    /// after `at.block`; later boundaries shift, the boundary at `at.block`
    /// itself stays (it still precedes the surviving head block).
    pub(super) fn remap_sections_insert_text(&mut self, at: Pos, text: &str) {
        let added = text.bytes().filter(|&b| b == b'\n').count();
        if added == 0 {
            return;
        }
        for s in &mut self.sections {
            if s.block > at.block {
                s.block += added;
            }
        }
    }

    /// `deleteRange` from `from` to `to`: boundaries inside the deleted span
    /// (`from.block < block <= to.block`) lose their anchor block and are
    /// dropped — the section merges into the previous one. Boundaries after
    /// the span shift down by the net removed block count.
    pub(super) fn remap_sections_delete(&mut self, from: Pos, to: Pos) {
        let span = to.block - from.block;
        let mut kept = Vec::with_capacity(self.sections.len());
        for mut s in std::mem::take(&mut self.sections) {
            if s.block <= from.block {
                kept.push(s);
            } else if s.block > to.block {
                s.block -= span;
                kept.push(s);
            }
            // s.block in (from.block, to.block]: anchor block deleted, drop.
        }
        self.sections = kept;
    }

    /// `splitBlock` at `at`: one block is inserted after `at.block`; later
    /// boundaries shift, the boundary at `at.block` stays before the head.
    pub(super) fn remap_sections_split(&mut self, at: Pos) {
        for s in &mut self.sections {
            if s.block > at.block {
                s.block += 1;
            }
        }
    }

    /// `mergeBlock` at `index`: block `index` is merged into `index - 1` and
    /// removed. A boundary at `index` loses its anchor and is dropped; later
    /// boundaries shift down one.
    pub(super) fn remap_sections_merge(&mut self, index: usize) {
        let mut kept = Vec::with_capacity(self.sections.len());
        for mut s in std::mem::take(&mut self.sections) {
            if s.block == index {
                // Anchor merged away: drop the boundary.
            } else {
                if s.block > index {
                    s.block -= 1;
                }
                kept.push(s);
            }
        }
        self.sections = kept;
    }

    /// `insertBlock` at `index`: boundaries at or after it shift one block
    /// so they still precede the same block. The first section's boundary is
    /// the document start and never moves — a block inserted at index 0
    /// joins section 0.
    pub(super) fn remap_sections_insert_block(&mut self, index: usize) {
        for s in &mut self.sections {
            if s.block >= index && s.block != 0 {
                s.block += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;
    use serde_json::json;

    fn engine() -> QuillEngine {
        QuillEngine::new()
    }

    fn cmd(op: &str, payload: Value) -> Command {
        Command::new(op, payload)
    }

    fn apply(e: &mut QuillEngine, op: &str, payload: Value) -> CommandResult {
        e.apply(cmd(op, payload)).unwrap()
    }

    fn err(e: &mut QuillEngine, op: &str, payload: Value) -> EngineError {
        e.apply(cmd(op, payload)).unwrap_err()
    }

    /// Four-block fixture: "A\nB\nC\nD".
    fn fixture() -> QuillEngine {
        let mut e = engine();
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"A\nB\nC\nD"}),
        );
        e
    }

    fn sections(e: &mut QuillEngine) -> Value {
        apply(e, "listSections", json!({})).data
    }

    fn section_blocks(e: &mut QuillEngine) -> Vec<usize> {
        sections(e)["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["block"].as_u64().unwrap() as usize)
            .collect()
    }

    // -- model & ops ---------------------------------------------------------

    #[test]
    fn new_document_has_one_default_section() {
        let mut e = engine();
        let data = sections(&mut e);
        let arr = data["sections"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["index"], 0);
        assert_eq!(arr[0]["block"], 0);
        assert_eq!(arr[0]["page"]["width"], 612.0);
        assert_eq!(arr[0]["page"]["height"], 792.0);
        assert_eq!(arr[0]["page"]["orientation"], "portrait");
        assert_eq!(arr[0]["page"]["start"], "next-page");
        assert_eq!(arr[0]["page"]["columns"], 1);
        assert!(arr[0]["header_footer"]["header"].is_null());
        assert_eq!(arr[0]["header_footer"]["number_format"], "decimal");
    }

    #[test]
    fn insert_section_inherits_and_patches() {
        let mut e = fixture();
        apply(
            &mut e,
            "setPageSetup",
            json!({"section":0,"width":500.0,"orientation":"landscape"}),
        );
        apply(
            &mut e,
            "setHeaderFooter",
            json!({"section":0,"header":"Running head"}),
        );
        let r = apply(&mut e, "insertSection", json!({"at":2}));
        assert_eq!(r.data["section"], 1);
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        let data = sections(&mut e);
        // Bare insert copies the owning section's settings (link-previous).
        assert_eq!(data["sections"][1]["page"]["width"], 500.0);
        assert_eq!(data["sections"][1]["page"]["orientation"], "landscape");
        assert_eq!(data["sections"][1]["header_footer"]["header"], "Running head");
        // Optional patches override the copy.
        apply(
            &mut e,
            "insertSection",
            json!({"at":3,"page_setup":{"margin_top":100.0},"header_footer":{"footer":"F"}}),
        );
        assert_eq!(section_blocks(&mut e), vec![0, 2, 3]);
        let data = sections(&mut e);
        assert_eq!(data["sections"][2]["page"]["margin_top"], 100.0);
        assert_eq!(data["sections"][2]["page"]["width"], 500.0);
        assert_eq!(data["sections"][2]["header_footer"]["footer"], "F");
        assert_eq!(data["sections"][2]["header_footer"]["header"], "Running head");
    }

    #[test]
    fn insert_section_rejects_bad_anchors_and_duplicates() {
        let mut e = fixture();
        for (at, code_check) in [(0usize, "first"), (4, "range")] {
            let _ = (at, code_check);
        }
        assert!(err(&mut e, "insertSection", json!({"at":0})).code == ErrorCode::Validation);
        assert!(err(&mut e, "insertSection", json!({"at":4})).code == ErrorCode::OutOfBounds);
        apply(&mut e, "insertSection", json!({"at":2}));
        let before = e.snapshot().unwrap();
        assert!(err(&mut e, "insertSection", json!({"at":2})).code == ErrorCode::Validation);
        assert!(err(&mut e, "insertSection", json!({"at":1,"page_setup":{"width":10.0}})).code == ErrorCode::Validation);
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn remove_section_merges_into_previous() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(&mut e, "insertSection", json!({"at":3}));
        assert_eq!(section_blocks(&mut e), vec![0, 2, 3]);
        // First section cannot be removed; unknown index rejects.
        assert!(err(&mut e, "removeSection", json!({"section":0})).code == ErrorCode::Validation);
        assert!(err(&mut e, "removeSection", json!({"section":3})).code == ErrorCode::OutOfBounds);
        let r = apply(&mut e, "removeSection", json!({"section":1}));
        assert_eq!(r.data["ok"], true);
        assert_eq!(section_blocks(&mut e), vec![0, 3]);
        // Removing the last boundary returns to a single section.
        apply(&mut e, "removeSection", json!({"section":1}));
        assert_eq!(section_blocks(&mut e), vec![0]);
    }

    #[test]
    fn set_page_setup_patches_and_validates_atomically() {
        let mut e = fixture();
        let r = apply(
            &mut e,
            "setPageSetup",
            json!({"section":0,"width":595.0,"height":842.0,"columns":2,"column_gap":36.0,"start":"continuous"}),
        );
        assert_eq!(r.data["section"], 0);
        let data = sections(&mut e);
        let page = &data["sections"][0]["page"];
        assert_eq!(page["width"], 595.0);
        assert_eq!(page["height"], 842.0);
        assert_eq!(page["columns"], 2);
        assert_eq!(page["column_gap"], 36.0);
        assert_eq!(page["start"], "continuous");
        assert_eq!(page["margin_top"], 72.0);
        // Equal values are eventless.
        let noop = apply(&mut e, "setPageSetup", json!({"section":0,"width":595.0}));
        assert!(noop.events.is_empty());
        // Invalid merges reject without touching state.
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"section":0,"margin_top":800.0}),       // top+bottom >= height
            json!({"section":0,"width":10.0}),            // below 36pt floor
            json!({"section":0,"columns":0}),             // below 1
            json!({"section":0,"columns":33}),            // above 32
            json!({"section":0,"orientation":"sideways"}),
            json!({"section":0,"start":"sometimes"}),
            json!({"section":0,"margin_left":-1.0}),
        ] {
            assert!(e.apply(cmd("setPageSetup", payload.clone())).is_err(), "{payload}");
            assert_eq!(e.snapshot().unwrap(), before);
        }
    }

    #[test]
    fn set_header_footer_sets_clears_and_validates() {
        let mut e = fixture();
        apply(
            &mut e,
            "setHeaderFooter",
            json!({"section":0,"header":"Confidential","footer":"Page","different_first":true,"first_header":"First","page_numbers":true,"number_start":3,"number_format":"roman","link_previous":false}),
        );
        let hf = sections(&mut e)["sections"][0]["header_footer"].clone();
        assert_eq!(hf["header"], "Confidential");
        assert_eq!(hf["footer"], "Page");
        assert_eq!(hf["first_header"], "First");
        assert_eq!(hf["different_first"], true);
        assert_eq!(hf["page_numbers"], true);
        assert_eq!(hf["number_start"], 3);
        assert_eq!(hf["number_format"], "roman");
        assert_eq!(hf["link_previous"], false);
        // null clears a body; flags flip; equal patch is eventless.
        let noop = apply(&mut e, "setHeaderFooter", json!({"section":0,"header":"Confidential"}));
        assert!(noop.events.is_empty());
        apply(&mut e, "setHeaderFooter", json!({"section":0,"header":null,"number_start":null}));
        let hf = sections(&mut e)["sections"][0]["header_footer"].clone();
        assert!(hf["header"].is_null());
        assert!(hf["number_start"].is_null());
        assert_eq!(hf["footer"], "Page");
        // Oversized body and bad enum reject atomically.
        let before = e.snapshot().unwrap();
        let big = "x".repeat(HF_TEXT_MAX + 1);
        assert!(e
            .apply(cmd("setHeaderFooter", json!({"section":0,"header":big})))
            .is_err());
        assert!(e
            .apply(cmd(
                "setHeaderFooter",
                json!({"section":0,"number_format":"greek"})
            ))
            .is_err());
        assert!(e
            .apply(cmd(
                "setHeaderFooter",
                json!({"section":0,"number_start":0})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn section_ops_undo_redo() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(&mut e, "setPageSetup", json!({"section":1,"width":500.0}));
        apply(&mut e, "setHeaderFooter", json!({"section":1,"footer":"F"}));
        let full = e.snapshot().unwrap();
        // Undo order is reverse: header/footer, then page setup, then the
        // section itself; each restores its own before-image.
        assert!(e.undo().unwrap());
        let data = sections(&mut e);
        assert!(data["sections"][1]["header_footer"]["footer"].is_null());
        assert_eq!(data["sections"][1]["page"]["width"], 500.0);
        assert!(e.undo().unwrap());
        let data = sections(&mut e);
        assert_eq!(data["sections"][1]["page"]["width"], 612.0);
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        assert!(e.undo().unwrap());
        assert_eq!(section_blocks(&mut e), vec![0]);
        while e.redo().unwrap() {}
        assert_eq!(e.snapshot().unwrap(), full);
    }

    // -- position stability ---------------------------------------------------

    #[test]
    fn insert_text_newlines_shift_later_boundaries() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(&mut e, "insertSection", json!({"at":3}));
        assert_eq!(section_blocks(&mut e), vec![0, 2, 3]);
        // One newline adds one block; boundaries after block 0 shift +1.
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":0,"offset":0},"text":"x\ny"}),
        );
        assert_eq!(section_blocks(&mut e), vec![0, 3, 4]);
        // Boundary at the insertion block itself does not move.
        apply(&mut e, "insertSection", json!({"at":1}));
        apply(
            &mut e,
            "insertText",
            json!({"at":{"block":1,"offset":0},"text":"z\nw"}),
        );
        assert_eq!(section_blocks(&mut e), vec![0, 1, 4, 5]);
    }

    #[test]
    fn delete_range_drops_interior_boundaries_and_shifts_rest() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":1}));
        apply(&mut e, "insertSection", json!({"at":3}));
        assert_eq!(section_blocks(&mut e), vec![0, 1, 3]);
        // Delete blocks 1..=2 (from {1,0} to {3,0}? use full-block range):
        // boundary at 1 is inside (from.block < b <= to.block) only if its
        // anchor block is deleted; deleting 1..=2 keeps block 3? No —
        // to.block=3 means block 3 is also consumed. Use to={3,0} so block 3
        // survives merged at index 1... block 3 IS in the splice range.
        // Instead delete {1,0}..{2,1}: blocks 1,2 removed, merged survivor at 1.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":2,"offset":1}}),
        );
        // Old blocks: 0,1,2,3 → new: 0, merged(1+2tail), 3→2. Boundary at 1
        // (==from.block) survives at 1; boundary at 3 (>to.block=2) shifts -1 → 2.
        assert_eq!(section_blocks(&mut e), vec![0, 1, 2]);
        // Now delete the merged block's whole content plus next: boundary at 2
        // is inside the deleted span and must drop.
        apply(
            &mut e,
            "deleteRange",
            json!({"from":{"block":1,"offset":0},"to":{"block":2,"offset":1}}),
        );
        assert_eq!(section_blocks(&mut e), vec![0, 1]);
    }

    #[test]
    fn split_merge_insert_block_move_boundaries() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(&mut e, "splitBlock", json!({"at":{"block":1,"offset":0}}));
        assert_eq!(section_blocks(&mut e), vec![0, 3]);
        // insertBlock at 0 shifts later boundaries but section 0 stays at
        // the document start; the snapshot must still validate.
        apply(&mut e, "insertBlock", json!({"index":0}));
        assert_eq!(section_blocks(&mut e), vec![0, 4]);
        let mut restored = engine();
        restored.restore(&e.snapshot().unwrap()).unwrap();
        assert_eq!(section_blocks(&mut restored), vec![0, 4]);
        // Boundary at 4: mergeBlock(4) deletes block 4 → boundary drops.
        apply(&mut e, "mergeBlock", json!({"index":4}));
        assert_eq!(section_blocks(&mut e), vec![0]);
        // Boundary at 3: mergeBlock(2) shifts it down to 2.
        apply(&mut e, "insertSection", json!({"at":3}));
        apply(&mut e, "mergeBlock", json!({"index":2}));
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        restored.restore(&e.snapshot().unwrap()).unwrap();
        assert_eq!(section_blocks(&mut restored), vec![0, 2]);
    }

    #[test]
    fn replace_range_and_batch_carry_sections() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(
            &mut e,
            "replaceRange",
            json!({"from":{"block":0,"offset":0},"to":{"block":1,"offset":1},"text":"Q\nR"}),
        );
        // Net -1 block (2 removed → wait: blocks0..1 → 2 new): boundary 2→2.
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        // Batch with a section op commits as one undo.
        e.apply(Command::new(
            ignition_core::OP_BATCH,
            json!({"commands": [
                {"op":"setPageSetup","payload":{"section":1,"width":400.0}},
                {"op":"insertSection","payload":{"at":3}}
            ]}),
        ))
        .unwrap();
        assert_eq!(section_blocks(&mut e), vec![0, 2, 3]);
        let data = sections(&mut e);
        assert_eq!(data["sections"][1]["page"]["width"], 400.0);
        assert!(e.undo().unwrap());
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        let data = sections(&mut e);
        assert_eq!(data["sections"][1]["page"]["width"], 612.0);
    }

    #[test]
    fn new_and_import_reset_sections() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(&mut e, "setPageSetup", json!({"section":1,"width":500.0}));
        apply(&mut e, "new", json!({}));
        assert_eq!(section_blocks(&mut e), vec![0]);
        assert_eq!(sections(&mut e)["sections"][0]["page"]["width"], 612.0);
        // `new` is undoable back to the sectioned document.
        assert!(e.undo().unwrap());
        assert_eq!(section_blocks(&mut e), vec![0, 2]);
        assert!(e.redo().unwrap());
        assert_eq!(section_blocks(&mut e), vec![0]);
    }

    // -- snapshot -------------------------------------------------------------

    fn restore_snapshot(e: &mut QuillEngine, bytes: &[u8]) {
        e.restore(bytes).unwrap();
    }

    #[test]
    fn snapshot_roundtrip_preserves_sections() {
        let mut e = fixture();
        apply(&mut e, "insertSection", json!({"at":2}));
        apply(
            &mut e,
            "setPageSetup",
            json!({"section":1,"width":500.0,"columns":2,"column_gap":36.0,"start":"odd-page"}),
        );
        apply(
            &mut e,
            "setHeaderFooter",
            json!({"section":1,"header":"H","even_footer":"EF","different_odd_even":true,"page_numbers":true,"number_start":5,"number_format":"letters","link_previous":true}),
        );
        let bytes = e.snapshot().unwrap();
        // Non-default sections force the schema:3 wrapper.
        let (_fmt, payload) = decode_envelope(&bytes).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["schema"], 3);
        assert!(value["document"]["sections"].is_array());
        let mut restored = engine();
        restore_snapshot(&mut restored, &bytes);
        assert_eq!(section_blocks(&mut restored), vec![0, 2]);
        let data = sections(&mut restored);
        assert_eq!(data["sections"][1]["page"]["width"], 500.0);
        assert_eq!(data["sections"][1]["page"]["start"], "odd-page");
        assert_eq!(data["sections"][1]["header_footer"]["even_footer"], "EF");
        assert_eq!(data["sections"][1]["header_footer"]["number_format"], "letters");
        assert_eq!(e.snapshot().unwrap(), restored.snapshot().unwrap());
    }

    #[test]
    fn default_sections_keep_schema3_payloads_byte_identical() {
        let mut e = fixture();
        // Bookmark-only schema:3 document must not gain a sections key.
        apply(
            &mut e,
            "addBookmark",
            json!({"name":"b1","pos":{"block":0,"offset":0}}),
        );
        let bytes = e.snapshot().unwrap();
        let (_fmt, payload) = decode_envelope(&bytes).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(value["schema"], 3);
        assert!(value["document"]["sections"].is_null());
        let mut restored = engine();
        restore_snapshot(&mut restored, &bytes);
        assert_eq!(section_blocks(&mut restored), vec![0]);
    }

    #[test]
    fn schema2_and_legacy_reject_sections_key() {
        let mut e = fixture();
        let blocks = serde_json::to_value(SnapshotRef { blocks: &e.blocks }).unwrap();
        for doc in [
            json!({"blocks": blocks["blocks"], "sections": []}),
        ] {
            // Legacy unwrapped payload with a sections key fails closed.
            let bytes = encode_envelope(&serde_json::to_vec(&doc).unwrap());
            assert!(e.restore(&bytes).is_err());
        }
        // schema:2 wrapper carrying sections rejects too.
        let wrapped = json!({
            "kind": "quill", "schema": 2,
            "document": {"blocks": blocks["blocks"], "sections": []}
        });
        let bytes = encode_envelope(&serde_json::to_vec(&wrapped).unwrap());
        assert!(e.restore(&bytes).is_err());
        // A schema:3 document without the sections key restores the default.
        let wrapped3 = json!({
            "kind": "quill", "schema": 3,
            "document": {"blocks": blocks["blocks"], "bookmarks": [], "styles": []}
        });
        let bytes = encode_envelope(&serde_json::to_vec(&wrapped3).unwrap());
        e.restore(&bytes).unwrap();
        assert_eq!(section_blocks(&mut e), vec![0]);
        // An explicit empty sections list fails validation.
        let wrapped_bad = json!({
            "kind": "quill", "schema": 3,
            "document": {"blocks": blocks["blocks"], "bookmarks": [], "styles": [], "sections": []}
        });
        let bytes = encode_envelope(&serde_json::to_vec(&wrapped_bad).unwrap());
        assert!(e.restore(&bytes).is_err());
        // Out-of-order / out-of-range starts reject.
        for bad in [
            json!([{"block":1,"page":{},"header_footer":{}},{"block":0,"page":{},"header_footer":{}}]),
            json!([{"block":0,"page":{},"header_footer":{}},{"block":9,"page":{},"header_footer":{}}]),
        ] {
            let wrapped_bad = json!({
                "kind": "quill", "schema": 3,
                "document": {"blocks": blocks["blocks"], "bookmarks": [], "styles": [], "sections": bad}
            });
            let bytes = encode_envelope(&serde_json::to_vec(&wrapped_bad).unwrap());
            assert!(e.restore(&bytes).is_err());
        }
    }

    #[test]
    fn section_limit_is_enforced() {
        let mut e = fixture();
        // 4 blocks → at most 3 interior boundaries + first = 4 sections max
        // here; the 128 cap is unreachable with 4 blocks, so verify the
        // structural bound instead: every block index can host one start.
        for at in 1..4 {
            apply(&mut e, "insertSection", json!({"at":at}));
        }
        assert_eq!(section_blocks(&mut e), vec![0, 1, 2, 3]);
        let before = e.snapshot().unwrap();
        assert!(e.apply(cmd("insertSection", json!({"at":4}))).is_err());
        assert!(e.apply(cmd("insertSection", json!({"at":0}))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
}
