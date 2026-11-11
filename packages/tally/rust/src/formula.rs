//! The Tally formula language: tokenizer, recursive-descent parser producing an
//! AST, and a tree-walking evaluator.
//!
//! Grammar (loosest → tightest binding):
//!
//! ```text
//! expr     := concat (('='|'<>'|'<'|'<='|'>'|'>=') concat)*   // left-assoc
//! concat   := addsub ('&' addsub)*
//! addsub   := muldiv (('+'|'-') muldiv)*
//! muldiv   := power  (('*'|'/') power)*
//! power    := unary  ('^' unary)*          // left-assoc, Excel-style
//! unary    := ('-'|'+') unary | postfix    // binds tighter than '^' (Excel)
//! postfix  := primary '%'*
//! primary  := NUMBER | STRING | '(' expr ')' | ref [':' ref]
//!           | sheetqual '!' ref [':' ref] | name | (name|ref) '(' args ')'
//! ```
//!
//! Cross-sheet references (slice 14): `Sheet!A1`, `'My Sheet'!B2:C3`. The
//! qualifier is one word token (`[A-Za-z_$][A-Za-z0-9_$]*`, which may be
//! ref-shaped like `Sheet1`) or a single-quoted name with `''` escaping;
//! anything else (spaces, `-`, `.`, digits-first, non-ASCII) must be
//! quoted. Resolution is by the sheet's *current* name, case-insensitive;
//! `renameSheet` rewrites stored qualifiers so references follow renames,
//! and a qualifier that matches no sheet evaluates to `#REF!` (the
//! sheet-removal equivalent). 3D ranges (`Sheet1:Sheet3!A1`) are not
//! supported and fail to parse (`#NAME?`).
//!
//! Deliberate semantics (documented for reviewers):
//! * `^` is left-associative and unary `+`/`-` bind tighter than `^`, matching
//!   Excel: `=2^3^2` → 64, `=-2^2` → 4, `=2^-3` → 0.125.
//! * Formulas that fail to tokenize or parse evaluate to `#NAME?` — a malformed
//!   formula is something the engine cannot name. Cells keep their raw text.
//! * Bare `TRUE`/`FALSE` (any case) are boolean literals; any other bare
//!   identifier is an undefined name → `#NAME?`.
//! * Function names are case-insensitive. Wrong arity → `#VALUE!`.
//! * A range used as a scalar (arithmetic, comparisons, a top-level formula
//!   result) → `#VALUE!`. Aggregates accept ranges as value lists.
//! * Values inside a range referenced by an aggregate are "lenient" (text and
//!   empties are ignored, like Excel); literal scalar arguments are "strict"
//!   (`=SUM("a")` → `#VALUE!`, `=SUM(A1)` with A1 text → 0).
//! * Comparisons never coerce across types (`=1="1"` → FALSE). Cross-type
//!   ordering is number < text < boolean; strings compare case-insensitively;
//!   empty cells compare as 0 / "" / FALSE against a typed operand.
//! * `0^0`, non-finite `^` results, and non-finite arithmetic → `#NUM!`.
//! * Cycle detection uses an evaluation-time visited set keyed by
//!   `(sheet, address)`; computed cells are memoized per `Evaluator`
//!   (i.e. per request), so cross-sheet dependency chains share the same
//!   `MAX_EVAL_DEPTH` cap and report `#CYCLE!` on loops spanning sheets.
//!   An evaluation-depth cap guards against pathological dependency
//!   chains and reports `#CYCLE!`.
//! * Error literals (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`,
//!   `#CYCLE!`) may be written in formulas and evaluate to themselves.

mod conditional;

pub(crate) use conditional::CriteriaMatcher;

use serde_json::{json, Value as JsonValue};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub const ERR_DIV0: &str = "#DIV/0!";
pub const ERR_VALUE: &str = "#VALUE!";
pub const ERR_REF: &str = "#REF!";
pub const ERR_NAME: &str = "#NAME?";
pub const ERR_NUM: &str = "#NUM!";
pub const ERR_CYCLE: &str = "#CYCLE!";

/// Maximum nesting depth accepted by the parser (parens, calls, unary chains).
/// Deeper formulas evaluate to `#NAME?` instead of overflowing the stack.
const MAX_PARSE_DEPTH: usize = 100;
/// Maximum cell-evaluation recursion depth; beyond it we report `#CYCLE!`
/// (the only error value that fits an unbounded dependency chain).
const MAX_EVAL_DEPTH: usize = 500;

// ---------------------------------------------------------------------------
// Cell addresses
// ---------------------------------------------------------------------------

/// Parse `$?[A-Za-z]+$?[0-9]+` into 0-based `(column, row)`. Absolute markers
/// and case are accepted; `A` is column 0 and row `1` is row 0.
pub fn parse_addr(s: &str) -> Option<(u32, u32)> {
    let b = s.as_bytes();
    let mut i = 0usize;
    if b.get(i) == Some(&b'$') {
        i += 1;
    }
    let cs = i;
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    if i == cs {
        return None;
    }
    let col_s = &s[cs..i];
    if b.get(i) == Some(&b'$') {
        i += 1;
    }
    let rs = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == rs || i != b.len() {
        return None;
    }
    let mut col: u64 = 0;
    for ch in col_s.bytes() {
        let d = u64::from(ch.to_ascii_uppercase() - b'A') + 1;
        col = col.checked_mul(26)?.checked_add(d)?;
        if col > u64::from(u32::MAX) + 1 {
            return None;
        }
    }
    let row: u64 = s[rs..].parse().ok()?;
    if row == 0 || row > u64::from(u32::MAX) {
        return None;
    }
    Some(((col - 1) as u32, (row - 1) as u32))
}

/// Format 0-based `(column, row)` as a normalized `A1` address.
pub fn fmt_addr(col: u32, row: u32) -> String {
    let mut n = u64::from(col) + 1;
    let mut letters = Vec::new();
    while n > 0 {
        n -= 1;
        letters.push(b'A' + (n % 26) as u8);
        n /= 26;
    }
    letters.reverse();
    // SAFETY-free: bytes are all ASCII A-Z by construction.
    let col_s: String = letters.into_iter().map(char::from).collect();
    format!("{}{}", col_s, u64::from(row) + 1)
}

/// Format a number the way a spreadsheet would show it (`1`, not `1.0`).
pub fn fmt_num(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/// A computed value. `List` is internal-only: it is what a range produces and
/// only aggregate functions consume it.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Empty,
    Num(f64),
    Str(String),
    Bool(bool),
    Err(&'static str),
    List(Vec<Value>),
}

impl Value {
    fn is_error(&self) -> bool {
        matches!(self, Value::Err(_))
    }

    /// JSON form exposed through op payloads: numbers, strings, booleans and
    /// `null` for empty cells; error values surface as their literal text
    /// (`"#DIV/0!"` etc.). Non-finite numbers report as `#NUM!` rather than
    /// emitting a non-JSON float.
    pub fn to_json(&self) -> JsonValue {
        match self {
            Value::Empty => JsonValue::Null,
            Value::Num(n) if n.is_finite() => json!(n),
            Value::Num(_) => json!(ERR_NUM),
            Value::Str(s) => json!(s),
            Value::Bool(b) => json!(b),
            Value::Err(e) => json!(e),
            Value::List(items) => {
                JsonValue::Array(items.iter().map(Value::to_json).collect())
            }
        }
    }
}

fn scalarize(v: Value) -> Value {
    match v {
        Value::List(_) => Value::Err(ERR_VALUE),
        other => other,
    }
}

/// Coerce to number for arithmetic: Empty→0, Bool→1/0, Str parses or
/// `#VALUE!`, errors propagate.
fn num_of(v: &Value) -> Result<f64, Value> {
    match v {
        Value::Num(n) => Ok(*n),
        Value::Empty => Ok(0.0),
        Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        Value::Str(s) => match s.trim().parse::<f64>() {
            Ok(n) if n.is_finite() => Ok(n),
            _ => Err(Value::Err(ERR_VALUE)),
        },
        Value::Err(e) => Err(Value::Err(e)),
        Value::List(_) => Err(Value::Err(ERR_VALUE)),
    }
}

/// Coerce to text for `&`/`CONCAT`.
fn text_of(v: &Value) -> Result<String, Value> {
    match v {
        Value::Str(s) => Ok(s.clone()),
        Value::Num(n) => Ok(fmt_num(*n)),
        Value::Bool(b) => Ok(if *b { "TRUE" } else { "FALSE" }.to_string()),
        Value::Empty => Ok(String::new()),
        Value::Err(e) => Err(Value::Err(e)),
        Value::List(_) => Err(Value::Err(ERR_VALUE)),
    }
}

/// Coerce to boolean for `IF` conditions.
fn truthy(v: &Value) -> Result<bool, Value> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::Num(n) => Ok(*n != 0.0),
        Value::Empty => Ok(false),
        Value::Str(s) => match s.trim().to_ascii_uppercase().as_str() {
            "TRUE" => Ok(true),
            "FALSE" => Ok(false),
            _ => Err(Value::Err(ERR_VALUE)),
        },
        Value::Err(e) => Err(Value::Err(e)),
        Value::List(_) => Err(Value::Err(ERR_VALUE)),
    }
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Num(_) => 0,
        Value::Str(_) => 1,
        Value::Bool(_) => 2,
        _ => 3,
    }
}

fn empty_like(other: &Value) -> Value {
    match other {
        Value::Str(_) => Value::Str(String::new()),
        Value::Bool(_) => Value::Bool(false),
        _ => Value::Num(0.0),
    }
}

/// Total order used by `= <> < <= > >=`: numbers < strings < booleans, no
/// cross-type coercion, strings case-insensitive, empties take the compared
/// operand's type (0 / "" / FALSE).
fn value_order(l: &Value, r: &Value) -> Ordering {
    let lv = if matches!(l, Value::Empty) {
        empty_like(r)
    } else {
        l.clone()
    };
    let rv = if matches!(r, Value::Empty) {
        empty_like(&lv)
    } else {
        r.clone()
    };
    let (rl, rr) = (rank(&lv), rank(&rv));
    if rl != rr {
        return rl.cmp(&rr);
    }
    match (&lv, &rv) {
        (Value::Num(a), Value::Num(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
        (Value::Str(a), Value::Str(b)) => a.to_lowercase().cmp(&b.to_lowercase()),
        (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
        _ => Ordering::Equal,
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ref(String),
    Name(String),
    ErrLit(&'static str),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Percent,
    Amp,
    LParen,
    RParen,
    Comma,
    Colon,
    Bang,
    /// Single-quoted sheet qualifier (`'My Sheet'`); `''` is an escaped quote.
    QName(String),
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

/// Does a scanned word match the cell-ref shape `$?[A-Za-z]+$?[0-9]+`?
/// Bounds-independent: `A0` or `ZZZZZZZZ1` still lex as `Ref` (→ `#REF!`),
/// so name validation reuses this shape rather than `parse_addr`.
pub(crate) fn is_ref_word(w: &str) -> bool {
    let b = w.as_bytes();
    let mut i = 0usize;
    if b.get(i) == Some(&b'$') {
        i += 1;
    }
    let s = i;
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    if i == s {
        return false;
    }
    if b.get(i) == Some(&b'$') {
        i += 1;
    }
    let d = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    i > d && i == b.len()
}

fn tokenize(src: &str) -> Result<Vec<Tok>, ()> {
    Ok(lex(src)?.0)
}

/// One cell-reference token site in the source text, with the decoded
/// sheet qualifier when the ref is `Sheet!…`-qualified.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RefSite {
    pub start: usize,
    pub end: usize,
    /// Decoded sheet name for `Sheet!A1`-style refs; `None` for bare refs.
    pub sheet: Option<String>,
    /// Byte offset where the `Sheet!`/`'Sheet'!` qualifier begins, so a
    /// reference that dies can collapse the whole qualified form to
    /// `#REF!` (leaving `Sheet!#REF!` behind would parse as `#NAME?`).
    pub qstart: Option<usize>,
}

/// Tokenize with byte spans kept parallel to the token stream (used by the
/// reference rewriters, which patch source text rather than the AST).
fn lex(src: &str) -> Result<(Vec<Tok>, Vec<(usize, usize)>), ()> {
    let b = src.as_bytes();
    let mut i = 0usize;
    let mut out = Vec::new();
    let mut spans = Vec::new();
    while i < b.len() {
        let c = b[i];
        let tstart = i;
        match c {
            b' ' | b'\t' | b'\r' | b'\n' => {
                i += 1;
                continue;
            }
            b'"' => {
                i += 1;
                let mut bytes = Vec::new();
                loop {
                    match b.get(i) {
                        None => return Err(()),
                        Some(&b'"') => {
                            if b.get(i + 1) == Some(&b'"') {
                                bytes.push(b'"');
                                i += 2;
                            } else {
                                i += 1;
                                break;
                            }
                        }
                        Some(&ch) => {
                            bytes.push(ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::Str(String::from_utf8(bytes).map_err(|_| ())?));
            }
            b'0'..=b'9' | b'.' => {
                if c == b'.'
                    && !b.get(i + 1).map(|d| d.is_ascii_digit()).unwrap_or(false)
                {
                    return Err(());
                }
                let start = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if b.get(i) == Some(&b'.') {
                    i += 1;
                    while i < b.len() && b[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                if matches!(b.get(i), Some(&b'e') | Some(&b'E')) {
                    let mut j = i + 1;
                    if matches!(b.get(j), Some(&b'+') | Some(&b'-')) {
                        j += 1;
                    }
                    if b.get(j).map(|d| d.is_ascii_digit()).unwrap_or(false) {
                        i = j;
                        while i < b.len() && b[i].is_ascii_digit() {
                            i += 1;
                        }
                    }
                }
                let n: f64 = src[start..i].parse().map_err(|_| ())?;
                out.push(Tok::Num(n));
            }
            b'+' => {
                out.push(Tok::Plus);
                i += 1;
            }
            b'-' => {
                out.push(Tok::Minus);
                i += 1;
            }
            b'*' => {
                out.push(Tok::Star);
                i += 1;
            }
            b'/' => {
                out.push(Tok::Slash);
                i += 1;
            }
            b'^' => {
                out.push(Tok::Caret);
                i += 1;
            }
            b'%' => {
                out.push(Tok::Percent);
                i += 1;
            }
            b'&' => {
                out.push(Tok::Amp);
                i += 1;
            }
            b'(' => {
                out.push(Tok::LParen);
                i += 1;
            }
            b')' => {
                out.push(Tok::RParen);
                i += 1;
            }
            b',' => {
                out.push(Tok::Comma);
                i += 1;
            }
            b':' => {
                out.push(Tok::Colon);
                i += 1;
            }
            b'!' => {
                out.push(Tok::Bang);
                i += 1;
            }
            b'\'' => {
                // Single-quoted sheet qualifier: `'My Sheet'!A1`. `''`
                // inside is a literal quote, like Excel.
                i += 1;
                let mut bytes = Vec::new();
                loop {
                    match b.get(i) {
                        None => return Err(()),
                        Some(&b'\'') => {
                            if b.get(i + 1) == Some(&b'\'') {
                                bytes.push(b'\'');
                                i += 2;
                            } else {
                                i += 1;
                                break;
                            }
                        }
                        Some(&ch) => {
                            bytes.push(ch);
                            i += 1;
                        }
                    }
                }
                out.push(Tok::QName(String::from_utf8(bytes).map_err(|_| ())?));
            }
            b'=' => {
                out.push(Tok::Eq);
                i += 1;
            }
            b'<' => {
                match b.get(i + 1) {
                    Some(&b'=') => {
                        out.push(Tok::Le);
                        i += 2;
                    }
                    Some(&b'>') => {
                        out.push(Tok::Ne);
                        i += 2;
                    }
                    _ => {
                        out.push(Tok::Lt);
                        i += 1;
                    }
                }
            }
            b'>' => {
                match b.get(i + 1) {
                    Some(&b'=') => {
                        out.push(Tok::Ge);
                        i += 2;
                    }
                    _ => {
                        out.push(Tok::Gt);
                        i += 1;
                    }
                }
            }
            b'#' => {
                let start = i;
                i += 1;
                while i < b.len()
                    && (b[i].is_ascii_alphanumeric()
                        || matches!(b[i], b'/' | b'!' | b'?'))
                {
                    i += 1;
                }
                let lit = match src[start..i].to_ascii_uppercase().as_str() {
                    "#DIV/0!" => ERR_DIV0,
                    "#VALUE!" => ERR_VALUE,
                    "#REF!" => ERR_REF,
                    "#NAME?" => ERR_NAME,
                    "#NUM!" => ERR_NUM,
                    "#CYCLE!" => ERR_CYCLE,
                    _ => return Err(()),
                };
                out.push(Tok::ErrLit(lit));
            }
            _ if c.is_ascii_alphabetic() || c == b'_' || c == b'$' => {
                let start = i;
                while i < b.len() && is_word_char(b[i]) {
                    i += 1;
                }
                let w = &src[start..i];
                if is_ref_word(w) {
                    out.push(Tok::Ref(w.to_string()));
                } else {
                    out.push(Tok::Name(w.to_string()));
                }
            }
            _ => return Err(()),
        }
        spans.push((tstart, i));
    }
    Ok((out, spans))
}

/// Decode a token that can head a `…!` sheet qualifier: a bare word
/// (`Name`/`Ref`, used verbatim — sheet names compare case-insensitively)
/// or a single-quoted name with `''` already unescaped by the tokenizer.
fn qualifier_name(t: &Tok) -> Option<String> {
    match t {
        Tok::Name(n) | Tok::Ref(n) | Tok::QName(n) => Some(n.clone()),
        _ => None,
    }
}

/// Collect the cell-reference token sites of a tokenized formula. A `Ref`
/// token is skipped when it heads a function call (`LOG10(`) or a sheet
/// qualifier (`Sheet1!`); a ref immediately preceded by `!` records the
/// decoded qualifier so structural rewriters can tell same-sheet from
/// foreign-sheet references.
fn collect_ref_sites(toks: &[Tok], spans: &[(usize, usize)]) -> Vec<RefSite> {
    let mut sites = Vec::new();
    for (k, t) in toks.iter().enumerate() {
        if !matches!(t, Tok::Ref(_)) {
            continue;
        }
        if matches!(toks.get(k + 1), Some(Tok::LParen) | Some(Tok::Bang)) {
            continue;
        }
        let (sheet, qstart) = match (
            toks.get(k.wrapping_sub(1)),
            k.checked_sub(2).and_then(|j| toks.get(j)),
        ) {
            (Some(Tok::Bang), Some(q)) => (qualifier_name(q), Some(spans[k - 2].0)),
            _ => (None, None),
        };
        let (start, end) = spans[k];
        sites.push(RefSite {
            start,
            end,
            sheet,
            qstart,
        });
    }
    sites
}

fn tokenize_refs(src: &str, mut refs: Option<&mut Vec<RefSite>>) -> Result<Vec<Tok>, ()> {
    let (toks, spans) = lex(src)?;
    if let Some(refs) = refs.as_mut() {
        **refs = collect_ref_sites(&toks, &spans);
    }
    Ok(toks)
}

/// Sheet size range edits and reference shifting stay inside (XFD1048576).
pub const SHEET_MAX_COLUMNS: u32 = 16_384;
/// Sheet size range edits and reference shifting stay inside (XFD1048576).
pub const SHEET_MAX_ROWS: u32 = 1_048_576;

/// Whether a parsed address lies inside the sheet (A1:XFD1048576).
pub fn on_sheet(col: u32, row: u32) -> bool {
    col < SHEET_MAX_COLUMNS && row < SHEET_MAX_ROWS
}

/// Shift one reference token, keeping its `$` locks. `None` when the result
/// would leave the sheet.
fn shift_reference(word: &str, dc: i64, dr: i64) -> Option<String> {
    let fixed_col = word.starts_with('$');
    let fixed_row = word.trim_start_matches('$').contains('$');
    let (c, r) = parse_addr(word)?;
    let c = i64::from(c) + if fixed_col { 0 } else { dc };
    let r = i64::from(r) + if fixed_row { 0 } else { dr };
    if !(0..i64::from(SHEET_MAX_COLUMNS)).contains(&c) || !(0..i64::from(SHEET_MAX_ROWS)).contains(&r) {
        return None;
    }
    let address = fmt_addr(c as u32, r as u32);
    let split = address.find(|ch: char| ch.is_ascii_digit())?;
    let mut out = String::with_capacity(address.len() + 2);
    if fixed_col {
        out.push('$');
    }
    out.push_str(&address[..split]);
    if fixed_row {
        out.push('$');
    }
    out.push_str(&address[split..]);
    Some(out)
}

/// Shift only lexed reference tokens, preserving literals, whitespace, names,
/// scientific notation and function identifiers. A reference that would leave
/// the sheet becomes `#REF!`; a range with either endpoint off the sheet
/// becomes one `#REF!`, so the result still parses. Malformed lexical input is
/// rejected by the caller before any workbook mutation.
pub fn shift_references(raw: &str, dc: i64, dr: i64) -> Result<String, ()> {
    if !raw.starts_with('=') {
        return Ok(raw.to_string());
    }
    let mut refs = Vec::new();
    tokenize_refs(raw, Some(&mut refs))?;
    let mut result = String::with_capacity(raw.len());
    let mut previous = 0;
    let mut k = 0;
    while k < refs.len() {
        let site = &refs[k];
        let (start, end) = (site.start, site.end);
        // `A1 : B2` is one range when only a colon and whitespace separate two
        // reference tokens; the parser reads it the same way. A sheet
        // qualifier on either endpoint applies to the whole range, and fill
        // shifts relative refs on every sheet alike (`Sheet2!A1` → `Sheet2!B1`).
        let pair = refs.get(k + 1).filter(|next| raw[end..next.start].trim() == ":");
        let span_end = pair.map_or(end, |n| n.end);
        let shifted = match pair {
            Some(next) => match (
                shift_reference(&raw[start..end], dc, dr),
                shift_reference(&raw[next.start..next.end], dc, dr),
            ) {
                (Some(a), Some(b)) => Some(format!("{a}{}{b}", &raw[end..next.start])),
                _ => None,
            },
            None => shift_reference(&raw[start..end], dc, dr),
        };
        match shifted {
            Some(text) => {
                result.push_str(&raw[previous..start]);
                result.push_str(&text);
            }
            None => {
                // A dead reference collapses the whole `Sheet!ref` form —
                // leaving `Sheet!#REF!` would not parse as a reference.
                let from = site.qstart.unwrap_or(start);
                result.push_str(&raw[previous..from]);
                result.push_str(ERR_REF);
            }
        }
        previous = span_end;
        k += 1 + usize::from(pair.is_some());
    }
    result.push_str(&raw[previous..]);
    Ok(result)
}

// ---------------------------------------------------------------------------
// Structural row/column edits (insert/delete)
// ---------------------------------------------------------------------------

/// Axis a structural edit moves references along.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefAxis {
    /// Whole-row insert/delete: row coordinates move, columns are fixed.
    Row,
    /// Whole-column insert/delete: column coordinates move, rows are fixed.
    Col,
}

/// Which end of a range an axis coordinate sits on. Deleting rows/columns
/// clamps a partially covered range endpoint to the surviving edge instead
/// of producing `#REF!`; a range entirely inside the deleted band dies.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BandEdge {
    /// Lowest coordinate of the range: clamps to the band's start.
    Low,
    /// Highest coordinate: clamps to just below the band's start.
    High,
    /// A standalone reference: inside the band means `#REF!`.
    Single,
}

/// Map one 0-based coordinate on the edited axis through a structural band
/// edit. `start`/`count` are 0-based; `deleting` selects delete semantics
/// (band `[start, start+count)` removed, later positions shifted back)
/// versus insert semantics (positions at/after `start` shifted forward).
/// `max` is the sheet bound on that axis. `edge` selects the range-endpoint
/// clamp; `None` means deleted or pushed past the sheet edge.
pub(crate) fn band_map(
    x: u32,
    start: u32,
    count: u32,
    deleting: bool,
    max: u32,
    edge: BandEdge,
) -> Option<u32> {
    let (x, s, c) = (u64::from(x), u64::from(start), u64::from(count));
    let v = if !deleting {
        if x < s {
            x
        } else {
            x + c
        }
    } else if x < s {
        x
    } else if x < s + c {
        match edge {
            BandEdge::Single => return None,
            BandEdge::Low => s,
            // `s == 0` with a surviving high endpoint is unreachable (the
            // whole range would sit inside the band and die first), so the
            // checked sub is defensive only.
            BandEdge::High => s.checked_sub(1)?,
        }
    } else {
        x - c
    };
    u32::try_from(v).ok().filter(|&v| v < max)
}

/// Whether a stored rectangle `[lo, hi]` on the edited axis lies entirely
/// inside the deleted band — the only case where the whole range dies.
pub(crate) fn band_covers(lo: u32, hi: u32, start: u32, count: u32) -> bool {
    u64::from(lo) >= u64::from(start) && u64::from(hi) < u64::from(start) + u64::from(count)
}

/// `$` lock flags of a reference word (`$` before the column letters fixes
/// the column, `$` before the digits fixes the row).
fn ref_locks(word: &str) -> (bool, bool) {
    let b = word.as_bytes();
    let mut i = 0usize;
    let fixed_col = b.first() == Some(&b'$');
    if fixed_col {
        i = 1;
    }
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    let fixed_row = b.get(i) == Some(&b'$');
    (fixed_col, fixed_row)
}

/// Rebuild a reference word from coordinates, preserving its `$` markers.
fn fmt_locked_ref(col: u32, row: u32, fixed_col: bool, fixed_row: bool) -> String {
    let addr = fmt_addr(col, row);
    let split = addr.find(|ch: char| ch.is_ascii_digit()).unwrap_or(addr.len());
    let mut out = String::with_capacity(addr.len() + 2);
    if fixed_col {
        out.push('$');
    }
    out.push_str(&addr[..split]);
    if fixed_row {
        out.push('$');
    }
    out.push_str(&addr[split..]);
    out
}

/// Remap one reference token through a structural band edit. `$` locks are
/// preserved in the output but do **not** pin the coordinate — like Excel,
/// inserting/deleting rows or columns moves absolute references too.
/// `None` when the reference is deleted or lands off the sheet.
fn remap_ref_word(
    word: &str,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
) -> Option<String> {
    let (mut c, mut r) = parse_addr(word)?;
    let (coord, max) = match axis {
        RefAxis::Row => (r, SHEET_MAX_ROWS),
        RefAxis::Col => (c, SHEET_MAX_COLUMNS),
    };
    let mapped = band_map(coord, start, count, deleting, max, BandEdge::Single)?;
    match axis {
        RefAxis::Row => r = mapped,
        RefAxis::Col => c = mapped,
    }
    if !on_sheet(c, r) {
        return None;
    }
    let (fixed_col, fixed_row) = ref_locks(word);
    Some(fmt_locked_ref(c, r, fixed_col, fixed_row))
}

/// Remap one endpoint of a reference pair: the edited-axis coordinate maps
/// with `Low`/`High` edge semantics (chosen by which end of the range the
/// coordinate sits on), the other axis is untouched. `None` when the
/// endpoint lands off the sheet.
fn remap_pair_endpoint(
    word: &str,
    (c, r): (u32, u32),
    is_low: bool,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
) -> Option<String> {
    let (coord, max) = match axis {
        RefAxis::Row => (r, SHEET_MAX_ROWS),
        RefAxis::Col => (c, SHEET_MAX_COLUMNS),
    };
    let edge = if is_low { BandEdge::Low } else { BandEdge::High };
    let mapped = band_map(coord, start, count, deleting, max, edge)?;
    let (nc, nr) = match axis {
        RefAxis::Row => (c, mapped),
        RefAxis::Col => (mapped, r),
    };
    if !on_sheet(nc, nr) {
        return None;
    }
    let (fixed_col, fixed_row) = ref_locks(word);
    Some(fmt_locked_ref(nc, nr, fixed_col, fixed_row))
}

/// Remap both endpoints of a `A1:B2`-style pair, preserving the original
/// separator text. Range endpoints clamp to the surviving edge when the
/// band covers part of the range; a range entirely inside the deleted band
/// or with an endpoint off the sheet yields `None`, which the caller
/// renders as a single `#REF!` (same convention as `shift_references`).
fn remap_ref_pair(
    a: &str,
    b: &str,
    sep: &str,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
) -> Option<String> {
    let (ca, ra) = parse_addr(a)?;
    let (cb, rb) = parse_addr(b)?;
    let (aa, ab) = match axis {
        RefAxis::Row => (ra, rb),
        RefAxis::Col => (ca, cb),
    };
    if deleting && band_covers(aa.min(ab), aa.max(ab), start, count) {
        return None;
    }
    // The lower axis coordinate gets the Low edge, the higher the High
    // edge; equal coordinates only occur outside a covering band, where
    // both edges agree.
    let a_is_low = aa <= ab;
    let wa = remap_pair_endpoint(a, (ca, ra), a_is_low, axis, start, count, deleting)?;
    let wb = remap_pair_endpoint(b, (cb, rb), !a_is_low, axis, start, count, deleting)?;
    Some(format!("{wa}{sep}{wb}"))
}

/// The sheet qualifier a reference site (or `A1:B2` pair) carries, decoded
/// from a preceding `Name!`/`'Name'!` prefix. For a range the first
/// endpoint's qualifier wins; the second endpoint's applies only when the
/// first is bare (`S!A1:B2` qualifies the whole range).
fn site_qualifier<'s>(first: &'s RefSite, second: Option<&'s RefSite>) -> Option<&'s str> {
    first
        .sheet
        .as_deref()
        .or_else(|| second.and_then(|s| s.sheet.as_deref()))
}

/// Shared body of `remap_references`/`remap_qualified_references`. `keep`
/// decides per reference (or range pair) whether the band edit applies,
/// given its decoded sheet qualifier (`None` = unqualified). Rejected
/// sites are copied verbatim — qualifiers included — so foreign-sheet
/// references survive structural edits on other sheets untouched.
fn remap_refs(
    raw: &str,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
    keep: impl Fn(Option<&str>) -> bool,
) -> Result<String, ()> {
    if !raw.starts_with('=') {
        return Ok(raw.to_string());
    }
    let mut refs = Vec::new();
    tokenize_refs(raw, Some(&mut refs))?;
    let mut result = String::with_capacity(raw.len());
    let mut previous = 0;
    let mut k = 0;
    while k < refs.len() {
        let site = &refs[k];
        let (start_b, end_b) = (site.start, site.end);
        // `A1 : B2` is one range when only a colon and whitespace separate
        // two reference tokens; the parser reads it the same way.
        let pair = refs.get(k + 1).filter(|next| raw[end_b..next.start].trim() == ":");
        let span_end = pair.map_or(end_b, |n| n.end);
        if !keep(site_qualifier(site, pair)) {
            // Foreign-sheet reference: copy the ref span verbatim; the
            // `Sheet!` prefix was already emitted with the gap text.
            result.push_str(&raw[previous..start_b]);
            result.push_str(&raw[start_b..span_end]);
            previous = span_end;
            k += 1 + usize::from(pair.is_some());
            continue;
        }
        let remapped = match pair {
            Some(next) => remap_ref_pair(
                &raw[start_b..end_b],
                &raw[next.start..next.end],
                &raw[end_b..next.start],
                axis,
                start,
                count,
                deleting,
            ),
            None => remap_ref_word(&raw[start_b..end_b], axis, start, count, deleting),
        };
        match remapped {
            Some(text) => {
                result.push_str(&raw[previous..start_b]);
                result.push_str(&text);
            }
            None => {
                // A dead reference collapses the whole `Sheet!ref` form —
                // leaving `Sheet!#REF!` would not parse as a reference.
                let from = site.qstart.unwrap_or(start_b);
                result.push_str(&raw[previous..from]);
                result.push_str(ERR_REF);
            }
        }
        previous = span_end;
        k += 1 + usize::from(pair.is_some());
    }
    result.push_str(&raw[previous..]);
    Ok(result)
}

/// Remap reference tokens in a stored raw cell string through a structural
/// row/column band edit — the `shift_references` counterpart for
/// `insertRows`/`deleteRows`/`insertCols`/`deleteCols`. Same lexical
/// guarantees: literals, names, whitespace and function identifiers are
/// preserved; a reference deleted by the band or pushed off the sheet
/// becomes `#REF!`; a range partially covered by a delete shrinks to its
/// surviving cells and a fully covered range becomes one `#REF!`.
/// `$` markers are preserved but do not pin coordinates (Excel semantics).
/// Non-formula raws return unchanged; malformed lexical input is `Err` so
/// the caller can keep the raw verbatim.
///
/// Cross-sheet qualifiers: unqualified refs and refs qualified with
/// `self_sheet` (the edited sheet's current name, case-insensitive) remap;
/// refs qualified with any other sheet name are copied verbatim — a
/// structural edit on sheet S never moves `Other!A1` references.
pub fn remap_references(
    raw: &str,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
    self_sheet: &str,
) -> Result<String, ()> {
    remap_refs(raw, axis, start, count, deleting, |q| {
        q.map_or(true, |n| n.eq_ignore_ascii_case(self_sheet))
    })
}

/// The mirror image of `remap_references` for formulas on *other* sheets:
/// only refs explicitly qualified with `sheet_name` (the edited sheet's
/// current name) remap; unqualified refs belong to the formula's own sheet
/// and stay put. Used by structural edits so `Edited!A1` references across
/// the workbook follow the band edit (Excel behavior).
pub fn remap_qualified_references(
    raw: &str,
    axis: RefAxis,
    start: u32,
    count: u32,
    deleting: bool,
    sheet_name: &str,
) -> Result<String, ()> {
    remap_refs(raw, axis, start, count, deleting, |q| {
        q.is_some_and(|n| n.eq_ignore_ascii_case(sheet_name))
    })
}

/// Render a sheet name as a formula qualifier: bare word when it is
/// `[A-Za-z_$][A-Za-z0-9_$]*` (the tokenizer's word shape), single-quoted
/// with `''` escaping otherwise. Used by `rename_sheet_refs`.
fn render_qualifier(name: &str) -> String {
    let safe = name
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_' || b == b'$')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$');
    if safe {
        return name.to_string();
    }
    let mut out = String::with_capacity(name.len() + 2);
    out.push('\'');
    for ch in name.chars() {
        if ch == '\'' {
            out.push_str("''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// Rewrite `Old!…` sheet qualifiers in a stored formula after `renameSheet`.
/// Sheet references resolve by current name, so without this pass a rename
/// would strand every cross-sheet reference at `#REF!` (Excel rewrites the
/// formula text instead — this is the same semantics). Qualifiers compare
/// case-insensitively and are re-rendered canonically for the new name
/// (quoted when the new name is not a bare word). Non-formula raws and
/// formulas without a matching qualifier return unchanged; lexically
/// invalid input is `Err` so the caller keeps the raw verbatim (the stale
/// qualifier then evaluates to `#REF!`, never a panic).
pub fn rename_sheet_refs(raw: &str, old: &str, new: &str) -> Result<String, ()> {
    if !raw.starts_with('=') {
        return Ok(raw.to_string());
    }
    let (toks, spans) = lex(raw)?;
    let mut edits: Vec<(usize, usize)> = Vec::new();
    for k in 0..toks.len() {
        // A qualifier is a word/quoted token followed by `! Ref`.
        let Some(name) = qualifier_name(&toks[k]) else {
            continue;
        };
        if !matches!(toks.get(k + 1), Some(Tok::Bang))
            || !matches!(toks.get(k + 2), Some(Tok::Ref(_)))
        {
            continue;
        }
        if name.eq_ignore_ascii_case(old) {
            edits.push((spans[k].0, spans[k].1));
        }
    }
    if edits.is_empty() {
        return Ok(raw.to_string());
    }
    let rendered = render_qualifier(new);
    let mut out = String::with_capacity(raw.len());
    let mut previous = 0;
    for (s, e) in edits {
        out.push_str(&raw[previous..s]);
        out.push_str(&rendered);
        previous = e;
    }
    out.push_str(&raw[previous..]);
    Ok(out)
}

// ---------------------------------------------------------------------------
// AST + parser
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Concat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Str(String),
    Bool(bool),
    /// An omitted function argument (`IF(1,,2)`).
    Empty,
    ErrLit(&'static str),
    /// Normalized "A1" address.
    Cell(String),
    /// `Sheet!A1` — normalized address on the sheet named `sheet`
    /// (resolved case-insensitively at evaluation time).
    XCell { sheet: String, addr: String },
    /// `Sheet!A1:B2` — inclusive 0-based bounds on the named sheet.
    XRange {
        sheet: String,
        c0: u32,
        r0: u32,
        c1: u32,
        r1: u32,
    },
    /// A ref-shaped token that is out of range (row 0, overflow) → `#REF!`.
    BadRef,
    /// Bare identifier → `#NAME?`.
    Name(String),
    /// Inclusive 0-based bounds, normalized so `from <= to` on both axes.
    Range { c0: u32, r0: u32, c1: u32, r1: u32 },
    Neg(Box<Expr>),
    Pos(Box<Expr>),
    Percent(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn bump(&mut self) {
        self.pos += 1;
    }

    fn at(&self, t: &Tok) -> bool {
        self.peek() == Some(t)
    }

    fn enter(&mut self) -> Result<(), ()> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            self.depth -= 1;
            return Err(());
        }
        Ok(())
    }

    fn expr(&mut self) -> Result<Expr, ()> {
        let mut l = self.concat()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Eq) => BinOp::Eq,
                Some(Tok::Ne) => BinOp::Ne,
                Some(Tok::Lt) => BinOp::Lt,
                Some(Tok::Le) => BinOp::Le,
                Some(Tok::Gt) => BinOp::Gt,
                Some(Tok::Ge) => BinOp::Ge,
                _ => break,
            };
            self.bump();
            let r = self.concat()?;
            l = Expr::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }

    fn concat(&mut self) -> Result<Expr, ()> {
        let mut l = self.addsub()?;
        while self.at(&Tok::Amp) {
            self.bump();
            let r = self.addsub()?;
            l = Expr::Bin(BinOp::Concat, Box::new(l), Box::new(r));
        }
        Ok(l)
    }

    fn addsub(&mut self) -> Result<Expr, ()> {
        let mut l = self.muldiv()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Plus) => BinOp::Add,
                Some(Tok::Minus) => BinOp::Sub,
                _ => break,
            };
            self.bump();
            let r = self.muldiv()?;
            l = Expr::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }

    fn muldiv(&mut self) -> Result<Expr, ()> {
        let mut l = self.power()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Star) => BinOp::Mul,
                Some(Tok::Slash) => BinOp::Div,
                _ => break,
            };
            self.bump();
            let r = self.power()?;
            l = Expr::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }

    /// `^` is left-associative (Excel): `2^3^2` → `(2^3)^2` = 64.
    fn power(&mut self) -> Result<Expr, ()> {
        let mut l = self.unary()?;
        while self.at(&Tok::Caret) {
            self.bump();
            let r = self.unary()?;
            l = Expr::Bin(BinOp::Pow, Box::new(l), Box::new(r));
        }
        Ok(l)
    }

    /// Unary `+`/`-` bind tighter than `^` (Excel): `-2^2` → `(-2)^2` = 4.
    fn unary(&mut self) -> Result<Expr, ()> {
        match self.peek() {
            Some(Tok::Minus) => {
                self.bump();
                self.enter()?;
                let e = self.unary();
                self.depth -= 1;
                Ok(Expr::Neg(Box::new(e?)))
            }
            Some(Tok::Plus) => {
                self.bump();
                self.enter()?;
                let e = self.unary();
                self.depth -= 1;
                Ok(Expr::Pos(Box::new(e?)))
            }
            _ => self.postfix(),
        }
    }

    fn postfix(&mut self) -> Result<Expr, ()> {
        let mut e = self.primary()?;
        while self.at(&Tok::Percent) {
            self.bump();
            e = Expr::Percent(Box::new(e));
        }
        Ok(e)
    }

    fn primary(&mut self) -> Result<Expr, ()> {
        self.enter()?;
        let r = self.primary_inner();
        self.depth -= 1;
        r
    }

    fn primary_inner(&mut self) -> Result<Expr, ()> {
        match self.peek().cloned() {
            Some(Tok::Num(n)) => {
                self.bump();
                Ok(Expr::Num(n))
            }
            Some(Tok::Str(s)) => {
                self.bump();
                Ok(Expr::Str(s))
            }
            Some(Tok::ErrLit(e)) => {
                self.bump();
                Ok(Expr::ErrLit(e))
            }
            Some(Tok::LParen) => {
                self.bump();
                let e = self.expr()?;
                if self.at(&Tok::RParen) {
                    self.bump();
                    Ok(e)
                } else {
                    Err(())
                }
            }
            Some(Tok::QName(q)) => {
                self.bump();
                // A quoted word is only meaningful as a sheet qualifier.
                if self.at(&Tok::Bang) {
                    return self.qualified(q);
                }
                Err(())
            }
            Some(Tok::Ref(text)) => {
                self.bump();
                if self.at(&Tok::Bang) {
                    // Ref-shaped sheet name, e.g. `Sheet1!A1`.
                    return self.qualified(text);
                }
                if self.at(&Tok::LParen) {
                    // Ref-shaped function name, e.g. LOG10(...
                    return self.call(text);
                }
                if self.at(&Tok::Colon) {
                    self.bump();
                    return match self.peek().cloned() {
                        Some(Tok::Ref(t2)) => {
                            self.bump();
                            Ok(range_expr(&text, &t2))
                        }
                        _ => Err(()),
                    };
                }
                Ok(cell_expr(&text))
            }
            Some(Tok::Name(name)) => {
                self.bump();
                if self.at(&Tok::Bang) {
                    return self.qualified(name);
                }
                if self.at(&Tok::LParen) {
                    return self.call(name);
                }
                match name.to_ascii_uppercase().as_str() {
                    "TRUE" => Ok(Expr::Bool(true)),
                    "FALSE" => Ok(Expr::Bool(false)),
                    _ => Ok(Expr::Name(name)),
                }
            }
            _ => Err(()),
        }
    }

    /// `!` is current; parse `! Ref [: Ref]` — the cell/range on the sheet
    /// named `sheet`. A second qualifier (`S!A1:T!B2`) or a non-ref
    /// endpoint fails the parse (`#NAME?`), matching the documented
    /// single-qualifier subset.
    fn qualified(&mut self, sheet: String) -> Result<Expr, ()> {
        self.bump(); // consume '!'
        let first = match self.peek() {
            Some(Tok::Ref(t)) => t.clone(),
            _ => return Err(()),
        };
        self.bump();
        if self.at(&Tok::Colon) {
            self.bump();
            return match self.peek().cloned() {
                Some(Tok::Ref(t2)) => {
                    self.bump();
                    Ok(xrange_expr(&sheet, &first, &t2))
                }
                _ => Err(()),
            };
        }
        Ok(xcell_expr(&sheet, &first))
    }

    /// `(` is current; parse the argument list up to `)`. Empty slots (`f(a,,b)`)
    /// become `Expr::Empty`.
    fn call(&mut self, name: String) -> Result<Expr, ()> {
        self.bump(); // consume '('
        let mut args = Vec::new();
        if !self.at(&Tok::RParen) {
            loop {
                if self.at(&Tok::Comma) {
                    args.push(Expr::Empty);
                } else {
                    args.push(self.expr()?);
                }
                match self.peek() {
                    Some(Tok::Comma) => {
                        self.bump();
                        continue;
                    }
                    Some(Tok::RParen) => break,
                    _ => return Err(()),
                }
            }
        }
        if self.at(&Tok::RParen) {
            self.bump();
            Ok(Expr::Call(name, args))
        } else {
            Err(())
        }
    }
}

fn cell_expr(text: &str) -> Expr {
    match parse_addr(text) {
        Some((c, r)) if on_sheet(c, r) => Expr::Cell(fmt_addr(c, r)),
        _ => Expr::BadRef,
    }
}

fn range_expr(a: &str, b: &str) -> Expr {
    match (parse_addr(a), parse_addr(b)) {
        (Some((ca, ra)), Some((cb, rb))) if on_sheet(ca, ra) && on_sheet(cb, rb) => Expr::Range {
            c0: ca.min(cb),
            r0: ra.min(rb),
            c1: ca.max(cb),
            r1: ra.max(rb),
        },
        _ => Expr::BadRef,
    }
}

fn xcell_expr(sheet: &str, text: &str) -> Expr {
    match parse_addr(text) {
        Some((c, r)) if on_sheet(c, r) => Expr::XCell {
            sheet: sheet.to_string(),
            addr: fmt_addr(c, r),
        },
        _ => Expr::BadRef,
    }
}

fn xrange_expr(sheet: &str, a: &str, b: &str) -> Expr {
    match (parse_addr(a), parse_addr(b)) {
        (Some((ca, ra)), Some((cb, rb))) if on_sheet(ca, ra) && on_sheet(cb, rb) => Expr::XRange {
            sheet: sheet.to_string(),
            c0: ca.min(cb),
            r0: ra.min(rb),
            c1: ca.max(cb),
            r1: ra.max(rb),
        },
        _ => Expr::BadRef,
    }
}

/// Tokenize + parse formula text (without the leading `=`).
fn parse_formula(src: &str) -> Result<Expr, ()> {
    let toks = tokenize(src)?;
    if toks.is_empty() {
        return Err(());
    }
    let mut p = Parser {
        toks,
        pos: 0,
        depth: 0,
    };
    let e = p.expr()?;
    if p.pos != p.toks.len() {
        return Err(());
    }
    Ok(e)
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/// Resolved named-range target: inclusive 0-based coordinates bound to one
/// sheet id. Built by the engine from its durable `names` table; the
/// evaluator only resolves a name when `sheet` matches the sheet it was
/// created for (cross-sheet name references stay `#NAME?`, like cross-sheet
/// cell references).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NameTarget {
    pub sheet: u64,
    pub c0: u32,
    pub r0: u32,
    pub c1: u32,
    pub r1: u32,
}

/// Static description of one supported function for the `functionCatalog`
/// read op. `max_args: None` marks a variadic function.
#[derive(Clone, Copy, Debug)]
pub struct FnSpec {
    pub name: &'static str,
    pub min_args: u32,
    pub max_args: Option<u32>,
    pub signature: &'static str,
}

/// The bounded function set `eval_call` implements, in catalog order.
/// `TRUE`/`FALSE` are also bare literals; listed here because they are
/// callable with zero arguments (`TRUE()`).
pub const FUNCTION_CATALOG: &[FnSpec] = &[
    FnSpec { name: "SUM", min_args: 0, max_args: None, signature: "SUM(value...)" },
    FnSpec { name: "AVERAGE", min_args: 0, max_args: None, signature: "AVERAGE(value...)" },
    FnSpec { name: "MIN", min_args: 0, max_args: None, signature: "MIN(value...)" },
    FnSpec { name: "MAX", min_args: 0, max_args: None, signature: "MAX(value...)" },
    FnSpec { name: "COUNT", min_args: 0, max_args: None, signature: "COUNT(value...)" },
    FnSpec { name: "COUNTA", min_args: 0, max_args: None, signature: "COUNTA(value...)" },
    FnSpec { name: "COUNTIF", min_args: 2, max_args: Some(2), signature: "COUNTIF(range,criteria)" },
    FnSpec { name: "SUMIF", min_args: 2, max_args: Some(3), signature: "SUMIF(range,criteria[,sum_range])" },
    FnSpec { name: "IF", min_args: 2, max_args: Some(3), signature: "IF(condition,then[,else])" },
    FnSpec { name: "ROUND", min_args: 2, max_args: Some(2), signature: "ROUND(number,digits)" },
    FnSpec { name: "ABS", min_args: 1, max_args: Some(1), signature: "ABS(number)" },
    FnSpec { name: "CONCAT", min_args: 0, max_args: None, signature: "CONCAT(value...)" },
    FnSpec { name: "TRUE", min_args: 0, max_args: Some(0), signature: "TRUE()" },
    FnSpec { name: "FALSE", min_args: 0, max_args: Some(0), signature: "FALSE()" },
];

/// Read access to one sheet's raw cell contents. Ranges iterate only stored
/// cells, so a `A1:ZZ1000000` range costs O(#stored cells), not O(rect area).
pub trait CellLookup {
    /// Raw text stored at a normalized address, or `None` if the cell is empty.
    fn cell_raw(&self, addr: &str) -> Option<&str>;
    /// Stored cell addresses inside the inclusive 0-based rect.
    fn addrs_in(&self, c0: u32, r0: u32, c1: u32, r1: u32) -> Vec<String>;
}

/// Evaluates formulas and cell contents against a workbook's sheets.
///
/// One `Evaluator` = one evaluation request: it memoizes every computed
/// cell (`memo`) and detects cycles with an evaluation-time visited set
/// (`visiting`), both keyed by `(sheet index, address)` so dependency
/// chains may cross sheets. `book` lists every sheet as
/// `(name, id, cells)`; `book[home]` is the sheet the request targets.
/// Bare references, defined names and the public `eval_cell` entry point
/// resolve against `current` — the sheet whose formula is being evaluated
/// (`home` for ad-hoc `eval_formula_text`), so a formula reached through
/// `Sheet2!A1` still sees Sheet2's own bare refs and names. The test-only
/// `new` constructor builds a nameless single-entry book, so `Sheet!`
/// qualifiers can never resolve there (→ `#REF!`).
pub struct Evaluator<'a, S: CellLookup + ?Sized> {
    book: Vec<(Option<&'a str>, u64, &'a S)>,
    home: usize,
    /// Book index of the sheet whose formula is currently evaluating.
    current: usize,
    visiting: HashSet<(usize, String)>,
    memo: HashMap<(usize, String), Value>,
    depth: usize,
    conditional_work: usize,
    /// Workbook `names` table (uppercase name → target) when the engine
    /// supplies it; `None` keeps bare identifiers at `#NAME?`. Targets
    /// resolve only against the sheet currently being evaluated.
    names: Option<HashMap<String, NameTarget>>,
}

impl<'a, S: CellLookup + ?Sized> Evaluator<'a, S> {
    /// Single-sheet evaluator for unit tests: a nameless one-entry book,
    /// so `Sheet!` qualifiers can never resolve (→ `#REF!`). Production
    /// callers use `with_book`.
    #[cfg(test)]
    pub fn new(sheet: &'a S) -> Self {
        Self {
            book: vec![(None, 0, sheet)],
            home: 0,
            current: 0,
            visiting: HashSet::new(),
            memo: HashMap::new(),
            depth: 0,
            conditional_work: 0,
            names: None,
        }
    }

    /// Whole-workbook evaluator: `book` is every sheet as
    /// `(display name, durable id, cells)` in workbook order and `home`
    /// indexes the sheet the request targets. Sheet names compare
    /// case-insensitively, matching `name_taken`; `None` names are
    /// invisible to `Sheet!` qualifiers. `names` is the workbook
    /// name → target table (`None`/empty leaves bare identifiers at
    /// `#NAME?`); a name resolves only inside formulas on its bound
    /// sheet, exactly like before — now including formulas reached
    /// through cross-sheet references.
    pub fn with_book(
        book: Vec<(Option<&'a str>, u64, &'a S)>,
        home: usize,
        names: Option<HashMap<String, NameTarget>>,
    ) -> Self {
        Self {
            book,
            home,
            current: home,
            visiting: HashSet::new(),
            memo: HashMap::new(),
            depth: 0,
            conditional_work: 0,
            names,
        }
    }

    /// Book index of the sheet named `name` (case-insensitive), for
    /// `Sheet!` qualifiers. `None` when no sheet carries the name —
    /// removed or never-existent sheets both evaluate to `#REF!`.
    fn sheet_index(&self, name: &str) -> Option<usize> {
        self.book
            .iter()
            .position(|(n, _, _)| n.is_some_and(|n| n.eq_ignore_ascii_case(name)))
    }

    /// Evaluated value of a normalized cell address ("A1") on the home
    /// sheet. Empty cells → `Value::Empty`; non-formula raws → number or
    /// string; formulas → evaluated AST.
    pub fn eval_cell(&mut self, addr: &str) -> Value {
        self.eval_at(self.home, addr)
    }

    /// `eval_cell` on an arbitrary book sheet (cross-sheet references).
    fn eval_at(&mut self, sheet: usize, addr: &str) -> Value {
        let key = (sheet, addr.to_string());
        if let Some(v) = self.memo.get(&key) {
            return v.clone();
        }
        // `&'a S` copies out of the book vec, so `self` stays free for the
        // recursive `eval_expr` calls below.
        let cells: &'a S = self.book[sheet].2;
        let value = match cells.cell_raw(addr) {
            None | Some("") => Value::Empty,
            Some(raw) if raw.starts_with('=') => {
                if self.visiting.contains(&key) {
                    Value::Err(ERR_CYCLE)
                } else {
                    self.visiting.insert(key.clone());
                    self.depth += 1;
                    // Bare refs/names inside this formula belong to `sheet`,
                    // not the request's home sheet.
                    let prev_current = self.current;
                    self.current = sheet;
                    let v = if self.depth > MAX_EVAL_DEPTH {
                        Value::Err(ERR_CYCLE)
                    } else {
                        match parse_formula(&raw[1..]) {
                            Ok(ast) => {
                                let v = self.eval_expr(&ast);
                                scalarize(v)
                            }
                            Err(_) => Value::Err(ERR_NAME),
                        }
                    };
                    self.current = prev_current;
                    self.depth -= 1;
                    self.visiting.remove(&key);
                    v
                }
            }
            Some(raw) => scalar_from_raw(raw),
        };
        self.memo.insert(key, value.clone());
        value
    }

    /// Evaluate an ad-hoc formula string (leading `=` optional). A top-level
    /// range result collapses to `#VALUE!`.
    pub fn eval_formula_text(&mut self, text: &str) -> Value {
        let t = text.strip_prefix('=').unwrap_or(text);
        match parse_formula(t) {
            Ok(ast) => {
                let v = self.eval_expr(&ast);
                scalarize(v)
            }
            Err(_) => Value::Err(ERR_NAME),
        }
    }

    fn eval_expr(&mut self, e: &Expr) -> Value {
        match e {
            Expr::Num(n) => Value::Num(*n),
            Expr::Str(s) => Value::Str(s.clone()),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Empty => Value::Empty,
            Expr::ErrLit(x) => Value::Err(x),
            Expr::Name(name) => self.eval_name(name),
            Expr::BadRef => Value::Err(ERR_REF),
            Expr::Cell(a) => self.eval_at(self.current, a),
            Expr::XCell { sheet, addr } => match self.sheet_index(sheet) {
                Some(si) => self.eval_at(si, addr),
                None => Value::Err(ERR_REF),
            },
            Expr::XRange {
                sheet,
                c0,
                r0,
                c1,
                r1,
            } => match self.sheet_index(sheet) {
                Some(si) => self.eval_range(si, *c0, *r0, *c1, *r1),
                None => Value::Err(ERR_REF),
            },
            Expr::Range { c0, r0, c1, r1 } => {
                self.eval_range(self.current, *c0, *r0, *c1, *r1)
            }
            Expr::Neg(x) => {
                let v = self.eval_expr(x);
                match num_of(&v) {
                    Ok(n) => Value::Num(-n),
                    Err(e) => e,
                }
            }
            Expr::Pos(x) => {
                let v = self.eval_expr(x);
                match num_of(&v) {
                    Ok(n) => Value::Num(n),
                    Err(e) => e,
                }
            }
            Expr::Percent(x) => {
                let v = self.eval_expr(x);
                match num_of(&v) {
                    Ok(n) => Value::Num(n / 100.0),
                    Err(e) => e,
                }
            }
            Expr::Bin(op, l, r) => self.eval_bin(*op, l, r),
            Expr::Call(name, args) => self.eval_call(name, args),
        }
    }

    /// Resolve a bare identifier against the workbook `names` table. A name
    /// bound to a different sheet — or any name when no table was supplied —
    /// stays `#NAME?`. A single-cell target evaluates like a cell reference;
    /// a multi-cell target produces a range `List` for aggregates.
    fn eval_name(&mut self, name: &str) -> Value {
        // Names resolve only inside formulas on their bound sheet — the
        // sheet currently being evaluated, which may differ from `home`
        // when a cross-sheet reference pulled this formula in.
        let current_id = self.book[self.current].1;
        let target = self.names.as_ref().and_then(|table| {
            table
                .get(&name.to_ascii_uppercase())
                .copied()
                .filter(|t| t.sheet == current_id)
        });
        match target {
            Some(t) if t.c0 == t.c1 && t.r0 == t.r1 => {
                self.eval_at(self.current, &fmt_addr(t.c0, t.r0))
            }
            Some(t) => self.eval_range(self.current, t.c0, t.r0, t.c1, t.r1),
            None => Value::Err(ERR_NAME),
        }
    }

    /// Resolved coordinates of a name bound to the sheet currently being
    /// evaluated, for consumers that need a rectangle rather than a value
    /// (COUNTIF/SUMIF).
    pub(super) fn name_rect(&self, name: &str) -> Option<(u32, u32, u32, u32)> {
        let current_id = self.book[self.current].1;
        self.names.as_ref().and_then(|table| {
            table
                .get(&name.to_ascii_uppercase())
                .copied()
                .filter(|t| t.sheet == current_id)
                .map(|t| (t.c0, t.r0, t.c1, t.r1))
        })
    }

    fn eval_range(&mut self, sheet: usize, c0: u32, r0: u32, c1: u32, r1: u32) -> Value {
        let cells: &'a S = self.book[sheet].2;
        let mut addrs = cells.addrs_in(c0, r0, c1, r1);
        // Row-major order so CONCAT/etc. read naturally.
        addrs.sort_by_key(|a| {
            let (c, r) = parse_addr(a).unwrap_or((0, 0));
            (r, c)
        });
        let vals = addrs
            .iter()
            .map(|a| self.eval_at(sheet, a))
            .collect();
        Value::List(vals)
    }

    fn eval_bin(&mut self, op: BinOp, l: &Expr, r: &Expr) -> Value {
        let lv = self.eval_expr(l);
        if lv.is_error() {
            return lv;
        }
        let rv = self.eval_expr(r);
        if rv.is_error() {
            return rv;
        }
        if matches!(lv, Value::List(_)) || matches!(rv, Value::List(_)) {
            return Value::Err(ERR_VALUE);
        }
        match op {
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Pow => {
                let a = match num_of(&lv) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                let b = match num_of(&rv) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                let v = match op {
                    BinOp::Add => a + b,
                    BinOp::Sub => a - b,
                    BinOp::Mul => a * b,
                    BinOp::Div => {
                        if b == 0.0 {
                            return Value::Err(ERR_DIV0);
                        }
                        a / b
                    }
                    BinOp::Pow => {
                        if a == 0.0 && b == 0.0 {
                            return Value::Err(ERR_NUM); // Excel: 0^0 → #NUM!
                        }
                        a.powf(b)
                    }
                    _ => return Value::Err(ERR_VALUE),
                };
                if v.is_finite() {
                    Value::Num(v)
                } else {
                    Value::Err(ERR_NUM)
                }
            }
            BinOp::Concat => {
                let a = match text_of(&lv) {
                    Ok(s) => s,
                    Err(e) => return e,
                };
                let b = match text_of(&rv) {
                    Ok(s) => s,
                    Err(e) => return e,
                };
                Value::Str(a + &b)
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let ord = value_order(&lv, &rv);
                Value::Bool(match op {
                    BinOp::Eq => ord == Ordering::Equal,
                    BinOp::Ne => ord != Ordering::Equal,
                    BinOp::Lt => ord == Ordering::Less,
                    BinOp::Le => ord != Ordering::Greater,
                    BinOp::Gt => ord == Ordering::Greater,
                    BinOp::Ge => ord != Ordering::Less,
                    _ => return Value::Err(ERR_VALUE),
                })
            }
        }
    }

    /// Evaluate every argument, tagging each produced value as `lenient`
    /// (cell/range-derived — aggregates ignore text/empties there, Excel-style)
    /// or strict (literal/computed — aggregates coerce or error).
    fn eval_items(&mut self, args: &[Expr]) -> Vec<(Value, bool)> {
        let mut out = Vec::new();
        for a in args {
            let lenient = matches!(
                a,
                Expr::Cell(_)
                    | Expr::XCell { .. }
                    | Expr::Range { .. }
                    | Expr::XRange { .. }
                    | Expr::BadRef
                    | Expr::Name(_)
            );
            match self.eval_expr(a) {
                Value::List(items) => out.extend(items.into_iter().map(|v| (v, true))),
                v => out.push((v, lenient)),
            }
        }
        out
    }

    /// Numbers for SUM/AVERAGE/MIN/MAX: errors propagate; lenient text/empties
    /// are ignored; strict values must coerce (`"5"` → 5, `"a"` → `#VALUE!`).
    fn numbers(&mut self, args: &[Expr]) -> Result<Vec<f64>, Value> {
        let mut out = Vec::new();
        for (v, lenient) in self.eval_items(args) {
            match v {
                Value::Err(e) => return Err(Value::Err(e)),
                Value::Num(n) => out.push(n),
                Value::Empty => {}
                Value::Bool(b) => {
                    if !lenient {
                        out.push(if b { 1.0 } else { 0.0 });
                    }
                }
                Value::Str(s) => {
                    if !lenient {
                        match s.trim().parse::<f64>() {
                            Ok(n) if n.is_finite() => out.push(n),
                            _ => return Err(Value::Err(ERR_VALUE)),
                        }
                    }
                }
                Value::List(_) => return Err(Value::Err(ERR_VALUE)),
            }
        }
        Ok(out)
    }

    fn eval_call(&mut self, name: &str, args: &[Expr]) -> Value {
        let un = name.to_ascii_uppercase();
        match un.as_str() {
            "COUNTIF" => self.conditional(args, false),
            "SUMIF" => self.conditional(args, true),
            "SUM" | "AVERAGE" | "MIN" | "MAX" => {
                let ns = match self.numbers(args) {
                    Ok(v) => v,
                    Err(e) => return e,
                };
                match un.as_str() {
                    "SUM" => Value::Num(ns.iter().sum()),
                    "AVERAGE" => {
                        if ns.is_empty() {
                            Value::Err(ERR_DIV0)
                        } else {
                            Value::Num(ns.iter().sum::<f64>() / ns.len() as f64)
                        }
                    }
                    "MIN" => Value::Num(
                        ns.iter().copied().fold(f64::INFINITY, f64::min).finite_or_zero(),
                    ),
                    "MAX" => Value::Num(
                        ns.iter().copied().fold(f64::NEG_INFINITY, f64::max).finite_or_zero(),
                    ),
                    _ => Value::Err(ERR_NAME),
                }
            }
            "COUNT" => self.fn_count(args),
            "COUNTA" => {
                let items = self.eval_items(args);
                Value::Num(items.iter().filter(|(v, _)| !matches!(v, Value::Empty)).count() as f64)
            }
            "IF" => self.fn_if(args),
            "ROUND" => {
                if args.len() != 2 {
                    return Value::Err(ERR_VALUE);
                }
                let x = match num_of(&self.eval_expr(&args[0])) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                let n = match num_of(&self.eval_expr(&args[1])) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                let places = n.trunc().clamp(-30.0, 30.0) as i32;
                let m = 10f64.powi(places);
                let r = (x * m).round() / m; // round() = half away from zero, like Excel
                if r.is_finite() {
                    Value::Num(r)
                } else {
                    Value::Err(ERR_NUM)
                }
            }
            "ABS" => {
                if args.len() != 1 {
                    return Value::Err(ERR_VALUE);
                }
                match num_of(&self.eval_expr(&args[0])) {
                    Ok(n) => Value::Num(n.abs()),
                    Err(e) => e,
                }
            }
            "CONCAT" => {
                let items = self.eval_items(args);
                let mut s = String::new();
                for (v, _) in items {
                    match text_of(&v) {
                        Ok(t) => s.push_str(&t),
                        Err(e) => return e,
                    }
                }
                Value::Str(s)
            }
            "TRUE" | "FALSE" => {
                if args.is_empty() {
                    Value::Bool(un == "TRUE")
                } else {
                    Value::Err(ERR_VALUE)
                }
            }
            _ => Value::Err(ERR_NAME),
        }
    }

    fn fn_count(&mut self, args: &[Expr]) -> Value {
        let mut n = 0usize;
        for (v, lenient) in self.eval_items(args) {
            match v {
                Value::Err(e) => return Value::Err(e),
                Value::Num(_) => n += 1,
                Value::Bool(_) => {
                    if !lenient {
                        n += 1;
                    }
                }
                Value::Str(s)
                    if !lenient
                        && s.trim()
                            .parse::<f64>()
                            .ok()
                            .filter(|x| x.is_finite())
                            .is_some() =>
                {
                    n += 1;
                }
                Value::Str(_) => {}
                _ => {}
            }
        }
        Value::Num(n as f64)
    }

    /// `IF(cond, a, b)` — lazy branches; `IF(cond, a)` → FALSE when cond false.
    fn fn_if(&mut self, args: &[Expr]) -> Value {
        if args.len() < 2 || args.len() > 3 {
            return Value::Err(ERR_VALUE);
        }
        let cond = self.eval_expr(&args[0]);
        match truthy(&cond) {
            Err(e) => e,
            Ok(true) => {
                let v = self.eval_expr(&args[1]);
                scalarize(v)
            }
            Ok(false) => {
                if args.len() == 3 {
                    let v = self.eval_expr(&args[2]);
                    scalarize(v)
                } else {
                    Value::Bool(false)
                }
            }
        }
    }
}

/// Extra helpers on f64 used only for the MIN/MAX empty-case fold above.
trait FiniteOrZero {
    fn finite_or_zero(self) -> f64;
}

impl FiniteOrZero for f64 {
    fn finite_or_zero(self) -> f64 {
        if self.is_finite() {
            self
        } else {
            0.0
        }
    }
}

fn scalar_from_raw(raw: &str) -> Value {
    match raw.trim().parse::<f64>() {
        Ok(n) if n.is_finite() => Value::Num(n),
        _ => Value::Str(raw.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// Minimal CellLookup over raw strings for isolated formula tests.
    struct Cells(BTreeMap<String, String>);

    impl Cells {
        fn new(pairs: &[(&str, &str)]) -> Self {
            Cells(
                pairs
                    .iter()
                    .map(|(a, r)| (a.to_string(), r.to_string()))
                    .collect(),
            )
        }
    }

    impl CellLookup for Cells {
        fn cell_raw(&self, addr: &str) -> Option<&str> {
            self.0.get(addr).map(String::as_str)
        }
        fn addrs_in(&self, c0: u32, r0: u32, c1: u32, r1: u32) -> Vec<String> {
            self.0
                .keys()
                .filter(|k| match parse_addr(k) {
                    Some((c, r)) => c >= c0 && c <= c1 && r >= r0 && r <= r1,
                    None => false,
                })
                .cloned()
                .collect()
        }
    }

    fn eval(f: &str) -> Value {
        let cells = Cells(BTreeMap::new());
        Evaluator::new(&cells).eval_formula_text(f)
    }

    fn eval_on(cells: &Cells, f: &str) -> Value {
        Evaluator::new(cells).eval_formula_text(f)
    }

    fn num(f: &str) -> f64 {
        match eval(f) {
            Value::Num(n) => n,
            other => panic!("{f} → {other:?}, expected number"),
        }
    }

    fn err(f: &str) -> &'static str {
        match eval(f) {
            Value::Err(e) => e,
            other => panic!("{f} → {other:?}, expected error"),
        }
    }

    // -- addresses ----------------------------------------------------------

    #[test]
    fn addr_parse_and_format() {
        assert_eq!(parse_addr("A1"), Some((0, 0)));
        assert_eq!(parse_addr("$A$1"), Some((0, 0)));
        assert_eq!(parse_addr("a$1"), Some((0, 0)));
        assert_eq!(parse_addr("B2"), Some((1, 1)));
        assert_eq!(parse_addr("AA10"), Some((26, 9)));
        assert_eq!(parse_addr("A0"), None);
        assert_eq!(parse_addr("1A"), None);
        assert_eq!(parse_addr("A"), None);
        assert_eq!(parse_addr(""), None);
        assert_eq!(fmt_addr(0, 0), "A1");
        assert_eq!(fmt_addr(26, 9), "AA10");
        assert_eq!(fmt_addr(27, 0), "AB1");
    }

    // -- arithmetic & precedence ---------------------------------------------

    #[test]
    fn arithmetic_precedence() {
        assert_eq!(num("1+2*3"), 7.0);
        assert_eq!(num("(1+2)*3"), 9.0);
        assert_eq!(num("10-2-3"), 5.0);
        assert_eq!(num("2*3+4*5"), 26.0);
        assert_eq!(num("10/4"), 2.5);
        assert_eq!(num("2^3"), 8.0);
        // Excel semantics: ^ is left-associative.
        assert_eq!(num("2^3^2"), 64.0);
        // Excel semantics: unary minus binds tighter than ^.
        assert_eq!(num("-2^2"), 4.0);
        assert_eq!(num("2^-2"), 0.25);
        assert_eq!(num("--5"), 5.0);
        assert_eq!(num("+5"), 5.0);
        assert_eq!(num("-(2+3)"), -5.0);
    }

    #[test]
    fn percent_and_concat() {
        assert_eq!(num("50%"), 0.5);
        assert_eq!(num("200%%"), 0.02);
        assert_eq!(num("2^50%"), 2f64.powf(0.5));
        assert_eq!(eval("1&2"), Value::Str("12".into()));
        // & binds looser than + :
        assert_eq!(eval("1&2+3"), Value::Str("15".into()));
        assert_eq!(eval("1+2&3"), Value::Str("33".into()));
        assert_eq!(eval(r#""a"&"b""#), Value::Str("ab".into()));
        assert_eq!(eval(r#""x""y""#), Value::Str("x\"y".into()));
        assert_eq!(eval("1.5&\"!\""), Value::Str("1.5!".into()));
        assert_eq!(eval("2.0&\"!\""), Value::Str("2!".into()));
    }

    #[test]
    fn comparisons() {
        assert_eq!(eval("1=1"), Value::Bool(true));
        assert_eq!(eval("1=2"), Value::Bool(false));
        assert_eq!(eval("1<>2"), Value::Bool(true));
        assert_eq!(eval("1<2"), Value::Bool(true));
        assert_eq!(eval("2<=2"), Value::Bool(true));
        assert_eq!(eval("3>2"), Value::Bool(true));
        assert_eq!(eval("3>=3"), Value::Bool(true));
        // No cross-type coercion.
        assert_eq!(eval("1=\"1\""), Value::Bool(false));
        // Case-insensitive string equality, like Excel.
        assert_eq!(eval(r#""a"="A""#), Value::Bool(true));
        // Type ordering: number < text < bool.
        assert_eq!(eval("TRUE>5"), Value::Bool(true));
        assert_eq!(eval(r#""a">5"#), Value::Bool(true));
        // Chained comparisons are left-associative: (1<2)=TRUE < 3 → type order.
        assert_eq!(eval("1<2<3"), Value::Bool(false));
        // Comparison binds looser than concat/add.
        assert_eq!(eval("1+2=3"), Value::Bool(true));
        assert_eq!(eval("1&2=\"12\""), Value::Bool(true));
    }

    // -- functions -------------------------------------------------------------

    #[test]
    fn functions_basics() {
        assert_eq!(num("SUM(1,2,3)"), 6.0);
        assert_eq!(num("sum(1,2)"), 3.0); // case-insensitive
        assert_eq!(num("SuM(1)"), 1.0);
        assert_eq!(num("AVERAGE(2,4,6)"), 4.0);
        assert_eq!(num("MIN(3,1,2)"), 1.0);
        assert_eq!(num("MAX(3,1,2)"), 3.0);
        assert_eq!(num("MIN()"), 0.0);
        assert_eq!(num("COUNT(1,2,\"x\")"), 2.0);
        assert_eq!(num("COUNT(1,\"5\")"), 2.0); // strict scalar "5" counts
        assert_eq!(num("COUNT(TRUE)"), 1.0);
        assert_eq!(num("COUNTA(1,\"x\",TRUE)"), 3.0);
        assert_eq!(eval("IF(1>0,\"y\",\"n\")"), Value::Str("y".into()));
        assert_eq!(eval("IF(1<0,\"y\",\"n\")"), Value::Str("n".into()));
        assert_eq!(eval("IF(0,\"y\")"), Value::Bool(false));
        // IF is lazy: the untaken branch is not evaluated.
        assert_eq!(num("IF(FALSE,1/0,7)"), 7.0);
        assert_eq!(num("ROUND(2.5,0)"), 3.0);
        assert_eq!(num("ROUND(-2.5,0)"), -3.0); // half away from zero
        assert_eq!(num("ROUND(1.2345,2)"), 1.23);
        assert_eq!(num("ROUND(1499,-3)"), 1000.0);
        assert_eq!(num("ABS(-3)"), 3.0);
        assert_eq!(num("ABS(3)"), 3.0);
        assert_eq!(eval("CONCAT(\"a\",1,\"b\")"), Value::Str("a1b".into()));
        assert_eq!(eval("TRUE"), Value::Bool(true));
        assert_eq!(eval("false"), Value::Bool(false));
        assert_eq!(eval("TRUE()"), Value::Bool(true));
    }

    #[test]
    fn function_arity_errors() {
        assert_eq!(err("IF(1)"), ERR_VALUE);
        assert_eq!(err("ROUND(1)"), ERR_VALUE);
        assert_eq!(err("ABS(1,2)"), ERR_VALUE);
        assert_eq!(err("NOSUCHFN(1)"), ERR_NAME);
        assert_eq!(err("SOMEWHERE"), ERR_NAME);
    }

    // -- ranges over stored cells -----------------------------------------------

    #[test]
    fn ranges_and_aggregates() {
        let cells = Cells::new(&[
            ("A1", "1"),
            ("A2", "2"),
            ("B1", "3"),
            ("B2", "text"),
            ("A3", "=A1*10"),
        ]);
        assert_eq!(eval_on(&cells, "SUM(A1:B2)"), Value::Num(6.0)); // text ignored
        assert_eq!(eval_on(&cells, "SUM(A1:A3)"), Value::Num(13.0)); // formula cell
        assert_eq!(eval_on(&cells, "AVERAGE(A1:A2)"), Value::Num(1.5));
        assert_eq!(eval_on(&cells, "AVERAGE(A1:B2)"), Value::Num(2.0)); // text skipped
        assert_eq!(eval_on(&cells, "COUNT(A1:B2)"), Value::Num(3.0));
        assert_eq!(eval_on(&cells, "COUNTA(A1:B2)"), Value::Num(4.0));
        assert_eq!(eval_on(&cells, "MIN(A1:B2)"), Value::Num(1.0));
        assert_eq!(eval_on(&cells, "MAX(B2:A1)"), Value::Num(3.0)); // reversed range ok
        // Row-major order: A1,B1 then A2,B2.
        assert_eq!(
            eval_on(&cells, "CONCAT(A1:B2)"),
            Value::Str("132text".into())
        );
        // Scalar use of a range → #VALUE!.
        assert_eq!(eval_on(&cells, "A1:A2+1"), Value::Err(ERR_VALUE));
        assert_eq!(eval_on(&cells, "A1:A2"), Value::Err(ERR_VALUE));
    }

    // -- errors -------------------------------------------------------------------

    #[test]
    fn error_values() {
        assert_eq!(err("1/0"), ERR_DIV0);
        assert_eq!(err("0/0"), ERR_DIV0);
        assert_eq!(err("\"a\"+1"), ERR_VALUE);
        assert_eq!(err("1+\"a\""), ERR_VALUE);
        assert_eq!(err("FOO(1)"), ERR_NAME);
        assert_eq!(err("1+"), ERR_NAME);
        assert_eq!(err("(1+2"), ERR_NAME);
        assert_eq!(err("1 2"), ERR_NAME);
        assert_eq!(err(""), ERR_NAME);
        assert_eq!(err("A0"), ERR_REF);
        assert_eq!(err("0^0"), ERR_NUM);
        assert_eq!(err("(-1)^0.5"), ERR_NUM);
        assert_eq!(err("#DIV/0!+1"), ERR_DIV0); // error literals propagate
        assert_eq!(err("AVERAGE()"), ERR_DIV0);
    }

    #[test]
    fn cycles_and_memoization() {
        let cyc = Cells::new(&[("A1", "=B1"), ("B1", "=A1"), ("C1", "=A1+B1")]);
        let mut ev = Evaluator::new(&cyc);
        assert_eq!(ev.eval_cell("A1"), Value::Err(ERR_CYCLE));
        assert_eq!(ev.eval_cell("B1"), Value::Err(ERR_CYCLE));
        assert_eq!(ev.eval_cell("C1"), Value::Err(ERR_CYCLE));

        let selfref = Cells::new(&[("A1", "=A1+1")]);
        let mut ev = Evaluator::new(&selfref);
        assert_eq!(ev.eval_cell("A1"), Value::Err(ERR_CYCLE));

        // Range that includes the formula's own cell.
        let selfrange = Cells::new(&[("A1", "=SUM(A1:A3)"), ("A2", "1")]);
        let mut ev = Evaluator::new(&selfrange);
        assert_eq!(ev.eval_cell("A1"), Value::Err(ERR_CYCLE));
    }

    #[test]
    fn raw_scalars() {
        let cells = Cells::new(&[
            ("A1", "42"),
            ("A2", "hello"),
            ("A3", "-2.5e2"),
            ("A4", "nan"), // non-finite → treated as text
        ]);
        let mut ev = Evaluator::new(&cells);
        assert_eq!(ev.eval_cell("A1"), Value::Num(42.0));
        assert_eq!(ev.eval_cell("A2"), Value::Str("hello".into()));
        assert_eq!(ev.eval_cell("A3"), Value::Num(-250.0));
        assert_eq!(ev.eval_cell("A4"), Value::Str("nan".into()));
        assert_eq!(ev.eval_cell("Z9"), Value::Empty);
    }

    // -- cross-sheet references -------------------------------------------------

    /// Whole-workbook evaluator over `[(name, cells)]`; `home` is the sheet
    /// index bare refs resolve against.
    fn book_eval(sheets: &[(&str, &Cells)], home: usize, f: &str) -> Value {
        let book: Vec<(Option<&str>, u64, &Cells)> = sheets
            .iter()
            .enumerate()
            .map(|(i, (n, c))| (Some(*n), i as u64, *c))
            .collect();
        Evaluator::with_book(book, home, None).eval_formula_text(f)
    }

    #[test]
    fn cross_sheet_cells_ranges_and_quoting() {
        let home = Cells::new(&[("A1", "2")]);
        let data = Cells::new(&[("A1", "5"), ("B2", "10"), ("C3", "=A1+B2")]);
        let spaced = Cells::new(&[("A1", "7")]);
        let apos = Cells::new(&[("A1", "9")]);
        let sheets: [(&str, &Cells); 4] = [
            ("Sheet1", &home),
            ("Data", &data),
            ("My Sheet", &spaced),
            ("O'Brien", &apos),
        ];
        // Bare word qualifier, any case; ref-shaped qualifier (`Data` is a
        // Name, `Sheet1`-style names lex as Ref — both work).
        assert_eq!(book_eval(&sheets, 0, "=Data!A1*2"), Value::Num(10.0));
        assert_eq!(book_eval(&sheets, 0, "=data!A1+1"), Value::Num(6.0));
        assert_eq!(book_eval(&sheets, 0, "=Sheet1!A1+1"), Value::Num(3.0));
        // Quoted qualifier with a space; `''` escapes a literal quote.
        assert_eq!(book_eval(&sheets, 0, "='My Sheet'!A1+1"), Value::Num(8.0));
        assert_eq!(book_eval(&sheets, 0, "='O''Brien'!A1"), Value::Num(9.0));
        // Ranges aggregate across the sheet boundary.
        assert_eq!(book_eval(&sheets, 0, "=SUM(Data!A1:B2)"), Value::Num(15.0));
        assert_eq!(
            book_eval(&sheets, 0, "=Data!A1:B2+1"),
            Value::Err(ERR_VALUE)
        );
        // A formula stored on the other sheet sees *its own* bare refs.
        assert_eq!(book_eval(&sheets, 0, "=Data!C3*2"), Value::Num(30.0));
        // Empty target cell → Empty → 0 in arithmetic.
        assert_eq!(book_eval(&sheets, 0, "=Data!Z9+1"), Value::Num(1.0));
    }

    #[test]
    fn cross_sheet_missing_and_malformed_refs() {
        let home = Cells::new(&[]);
        let data = Cells::new(&[("A1", "1")]);
        let sheets: [(&str, &Cells); 2] = [("Sheet1", &home), ("Data", &data)];
        for (f, want) in [
            ("=Nope!A1", ERR_REF),       // no such sheet
            ("='Nope'!A1", ERR_REF),     // quoted, still missing
            ("=Data!A0", ERR_REF),       // off-grid address
            ("=Data!XFE1", ERR_REF),     // past the sheet edge
            ("=Data!", ERR_NAME),        // malformed
            ("='Data'", ERR_NAME),       // quote without qualifier
            ("=Data!A1:Data!B2", ERR_NAME), // second qualifier unsupported
            ("=Sheet1:Data!A1", ERR_NAME),  // 3D range unsupported
            ("=Data!A1+", ERR_NAME),
        ] {
            assert_eq!(book_eval(&sheets, 0, f), Value::Err(want), "{f}");
        }
        // Single-sheet `new` evaluators have no named sheets at all.
        assert_eq!(eval("=Data!A1"), Value::Err(ERR_REF));
    }

    #[test]
    fn cross_sheet_cycles_terminate() {
        // A!A1 → B!B1 → A!A1 across the sheet boundary.
        let a = Cells::new(&[("A1", "=Sheet2!B1")]);
        let b = Cells::new(&[("B1", "=Sheet1!A1")]);
        let sheets: [(&str, &Cells); 2] = [("Sheet1", &a), ("Sheet2", &b)];
        let book: Vec<(Option<&str>, u64, &Cells)> = sheets
            .iter()
            .enumerate()
            .map(|(i, (n, c))| (Some(*n), i as u64, *c))
            .collect();
        let mut ev = Evaluator::with_book(book, 0, None);
        assert_eq!(ev.eval_cell("A1"), Value::Err(ERR_CYCLE));
        // Self-qualified self-reference is also a cycle.
        let s = Cells::new(&[("A1", "=Sheet1!A1+1")]);
        let book2: Vec<(Option<&str>, u64, &Cells)> =
            vec![(Some("Sheet1"), 0, &s)];
        let mut ev2 = Evaluator::with_book(book2, 0, None);
        assert_eq!(ev2.eval_cell("A1"), Value::Err(ERR_CYCLE));
        // Acyclic cross-sheet chain still memoizes fine.
        let c1 = Cells::new(&[("A1", "=S2!B1+1")]);
        let c2 = Cells::new(&[("B1", "=S3!C1*2"), ("D1", "=S2!B1")]);
        let c3 = Cells::new(&[("C1", "21")]);
        let sheets3: [(&str, &Cells); 3] =
            [("S1", &c1), ("S2", &c2), ("S3", &c3)];
        assert_eq!(book_eval(&sheets3, 0, "=S1!A1"), Value::Num(43.0));
        assert_eq!(book_eval(&sheets3, 0, "=S2!D1"), Value::Num(42.0));
    }

    #[test]
    fn rename_sheet_refs_rewrites_qualifiers() {
        // Bare-word and quoted qualifiers rename; other sheets untouched.
        assert_eq!(
            rename_sheet_refs("=Sheet1!A1+'My Sheet'!B2", "Sheet1", "Data").unwrap(),
            "=Data!A1+'My Sheet'!B2"
        );
        assert_eq!(
            rename_sheet_refs("=sheet1!A1", "Sheet1", "Data").unwrap(),
            "=Data!A1"
        );
        assert_eq!(
            rename_sheet_refs("='My Sheet'!A1", "My Sheet", "Q1 Data").unwrap(),
            "='Q1 Data'!A1"
        );
        // Names needing quotes escape `'` and keep working.
        assert_eq!(
            rename_sheet_refs("=Old!A1", "Old", "O'Brien").unwrap(),
            "='O''Brien'!A1"
        );
        // Ref-shaped qualifier names rewrite too (`Data2024` lexes as Ref).
        assert_eq!(
            rename_sheet_refs("=Data2024!A1+B2", "Data2024", "D2").unwrap(),
            "=D2!A1+B2"
        );
        // No match / non-formula / dead text pass through unchanged.
        assert_eq!(
            rename_sheet_refs("=Other!A1", "Sheet1", "Data").unwrap(),
            "=Other!A1"
        );
        assert_eq!(
            rename_sheet_refs("plain", "Sheet1", "Data").unwrap(),
            "plain"
        );
        assert_eq!(
            rename_sheet_refs("=Sheet1!", "Sheet1", "Data").unwrap(),
            "=Sheet1!"
        );
        // The rewritten text re-parses: `=Data!A1` evaluates, not `#NAME?`.
        let home = Cells::new(&[]);
        let data = Cells::new(&[("A1", "3")]);
        let sheets: [(&str, &Cells); 2] = [("Data", &data), ("X", &home)];
        let rewritten =
            rename_sheet_refs("=Sheet1!A1", "Sheet1", "Data").unwrap();
        assert_eq!(book_eval(&sheets, 1, &rewritten), Value::Num(3.0));
    }

    #[test]
    fn remap_respects_sheet_qualifiers() {
        // On the edited sheet ("Sheet1"): bare + self-qualified refs move,
        // foreign-qualified refs stay verbatim. Insert one row at the top.
        assert_eq!(
            remap_references("=A1+Sheet1!B2+Sheet2!C3+'Q S'!D4", RefAxis::Row, 0, 1, false, "Sheet1")
                .unwrap(),
            "=A2+Sheet1!B3+Sheet2!C3+'Q S'!D4"
        );
        // On other sheets only refs qualified with the edited sheet move.
        assert_eq!(
            remap_qualified_references(
                "=A1+Sheet1!B2+Other!C3",
                RefAxis::Row,
                0,
                1,
                false,
                "Sheet1",
            )
            .unwrap(),
            "=A1+Sheet1!B3+Other!C3"
        );
        // A delete that kills a self-qualified ref still yields `#REF!`.
        assert_eq!(
            remap_references("=Sheet1!A1", RefAxis::Row, 0, 1, true, "Sheet1").unwrap(),
            "=#REF!"
        );
        assert_eq!(
            remap_qualified_references("=Sheet1!A1", RefAxis::Row, 0, 1, true, "Sheet1")
                .unwrap(),
            "=#REF!"
        );
    }
}
