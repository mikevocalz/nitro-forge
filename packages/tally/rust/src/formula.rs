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
//!           | name | (name|ref) '(' args ')'
//! ```
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
//! * Cycle detection uses an evaluation-time visited set; computed cells are
//!   memoized per `Evaluator` (i.e. per request). An evaluation-depth cap
//!   guards against pathological dependency chains and reports `#CYCLE!`.
//! * Error literals (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`,
//!   `#CYCLE!`) may be written in formulas and evaluate to themselves.

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
fn is_ref_word(w: &str) -> bool {
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
    tokenize_refs(src, None)
}

fn tokenize_refs(src: &str, mut refs: Option<&mut Vec<(usize, usize)>>) -> Result<Vec<Tok>, ()> {
    let b = src.as_bytes();
    let mut i = 0usize;
    let mut out = Vec::new();
    while i < b.len() {
        let c = b[i];
        match c {
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
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
                    if let Some(refs) = refs.as_mut() {
                        if !src[i..].trim_start().starts_with('(') {
                            refs.push((start, i));
                        }
                    }
                    out.push(Tok::Ref(w.to_string()));
                } else {
                    out.push(Tok::Name(w.to_string()));
                }
            }
            _ => return Err(()),
        }
    }
    Ok(out)
}

/// Shift only lexed reference tokens, preserving literals, whitespace, names,
/// scientific notation and function identifiers. Malformed lexical input is
/// rejected by the caller before any workbook mutation.
pub fn shift_references(raw: &str, dc: i64, dr: i64) -> Result<String, ()> {
    if !raw.starts_with('=') {
        return Ok(raw.to_string());
    }
    let mut refs = Vec::new();
    tokenize_refs(raw, Some(&mut refs))?;
    let mut result = String::with_capacity(raw.len());
    let mut previous = 0;
    for (start, end) in refs {
        result.push_str(&raw[previous..start]);
        let word = &raw[start..end];
        let fixed_col = word.starts_with('$');
        let letters = word.trim_start_matches('$');
        let fixed_row = letters.contains('$');
        let shifted = parse_addr(word).and_then(|(c, r)| {
            let c = i64::from(c) + if fixed_col { 0 } else { dc };
            let r = i64::from(r) + if fixed_row { 0 } else { dr };
            if c < 0 || c > i64::from(u32::MAX) || r < 0 || r >= i64::from(u32::MAX) {
                return None;
            }
            Some((c as u32, r as u32))
        });
        if let Some((c, r)) = shifted {
            let address = fmt_addr(c, r);
            let split = address.find(|ch: char| ch.is_ascii_digit()).unwrap();
            if fixed_col {
                result.push('$');
            }
            result.push_str(&address[..split]);
            if fixed_row {
                result.push('$');
            }
            result.push_str(&address[split..]);
        } else {
            result.push_str(ERR_REF);
        }
        previous = end;
    }
    result.push_str(&raw[previous..]);
    Ok(result)
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
            Some(Tok::Ref(text)) => {
                self.bump();
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
        Some((c, r)) => Expr::Cell(fmt_addr(c, r)),
        None => Expr::BadRef,
    }
}

fn range_expr(a: &str, b: &str) -> Expr {
    match (parse_addr(a), parse_addr(b)) {
        (Some((ca, ra)), Some((cb, rb))) => Expr::Range {
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

/// Read access to one sheet's raw cell contents. Ranges iterate only stored
/// cells, so a `A1:ZZ1000000` range costs O(#stored cells), not O(rect area).
pub trait CellLookup {
    /// Raw text stored at a normalized address, or `None` if the cell is empty.
    fn cell_raw(&self, addr: &str) -> Option<&str>;
    /// Stored cell addresses inside the inclusive 0-based rect.
    fn addrs_in(&self, c0: u32, r0: u32, c1: u32, r1: u32) -> Vec<String>;
}

/// Evaluates formulas and cell contents against a single sheet.
///
/// One `Evaluator` = one evaluation request: it memoizes every computed cell
/// (`memo`) and detects cycles with an evaluation-time visited set
/// (`visiting`). Formulas can only see the sheet the evaluator was created
/// with — cross-sheet references are not supported.
pub struct Evaluator<'a, S: CellLookup + ?Sized> {
    sheet: &'a S,
    visiting: HashSet<String>,
    memo: HashMap<String, Value>,
    depth: usize,
}

impl<'a, S: CellLookup + ?Sized> Evaluator<'a, S> {
    pub fn new(sheet: &'a S) -> Self {
        Self {
            sheet,
            visiting: HashSet::new(),
            memo: HashMap::new(),
            depth: 0,
        }
    }

    /// Evaluated value of a normalized cell address ("A1"). Empty cells →
    /// `Value::Empty`; non-formula raws → number or string; formulas →
    /// evaluated AST.
    pub fn eval_cell(&mut self, addr: &str) -> Value {
        if let Some(v) = self.memo.get(addr) {
            return v.clone();
        }
        let value = match self.sheet.cell_raw(addr) {
            None | Some("") => Value::Empty,
            Some(raw) if raw.starts_with('=') => {
                if self.visiting.contains(addr) {
                    Value::Err(ERR_CYCLE)
                } else {
                    self.visiting.insert(addr.to_string());
                    self.depth += 1;
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
                    self.depth -= 1;
                    self.visiting.remove(addr);
                    v
                }
            }
            Some(raw) => scalar_from_raw(raw),
        };
        self.memo.insert(addr.to_string(), value.clone());
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
            Expr::Name(_) => Value::Err(ERR_NAME),
            Expr::BadRef => Value::Err(ERR_REF),
            Expr::Cell(a) => self.eval_cell(a),
            Expr::Range { c0, r0, c1, r1 } => self.eval_range(*c0, *r0, *c1, *r1),
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

    fn eval_range(&mut self, c0: u32, r0: u32, c1: u32, r1: u32) -> Value {
        let mut addrs = self.sheet.addrs_in(c0, r0, c1, r1);
        // Row-major order so CONCAT/etc. read naturally.
        addrs.sort_by_key(|a| {
            let (c, r) = parse_addr(a).unwrap_or((0, 0));
            (r, c)
        });
        let vals = addrs.iter().map(|a| self.eval_cell(a)).collect();
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
            let lenient = matches!(a, Expr::Cell(_) | Expr::Range { .. } | Expr::BadRef);
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
}
