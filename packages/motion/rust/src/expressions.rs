//! Bounded scalar expressions (slice D): a hand-rolled recursive-descent
//! parser over a closed arithmetic/comparison/ternary grammar with a
//! whitelisted set of pure f64 functions and `time`/`frame`/`fps`/`duration`/
//! `this.<prop>`/`layer(<id>).<prop>` references. Sources are stored as text
//! and re-parsed at op time and on restore; evaluation is a pure function of
//! document state plus the explicit composition-local time — no clock, no
//! I/O, no host calls, no ambient state.
use crate::Property;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Stored expression binding: at most one per `(layer, property)`, mutually
/// exclusive with that property's curve (last write wins, atomic clear).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PropertyExpr {
    pub property: Property,
    pub source: String,
}

/// Source text cap in UTF-8 bytes.
pub const MAX_SOURCE_BYTES: usize = 4096;
/// Parsed AST node cap (every node kind counts, literals included).
pub const MAX_NODES: usize = 512;
/// Function-call node cap (a subset of the AST cap).
pub const MAX_CALLS: usize = 64;
/// Parser recursion-depth cap. Every nested-expression context —
/// parenthesized groups, ternary branches and call arguments — funnels
/// through `Parser::expr`, which counts one level per re-entry. Parens
/// produce no AST node, so without this cap ~2k nested parens fit the
/// 4096-byte source limit and overflow the stack; 128 levels keeps parser
/// recursion (~9 grammar frames per level) far below any thread stack.
pub const MAX_DEPTH: usize = 128;
/// Defensive per-cell evaluation step ceiling; exceeding it resolves the
/// property to 0.0 via NaN propagation at the property boundary.
pub const MAX_EVAL_STEPS: u32 = 10_000;

/// Composition-local evaluation context handed to every expression eval.
#[derive(Clone, Copy, Debug)]
pub struct Env {
    /// Seconds inside the owning composition (same mapping as curve eval).
    pub time: f64,
    /// `floor(time * fps)` of the owning composition.
    pub frame: f64,
    /// Rational frame rate `num/den` as f64.
    pub fps: f64,
    /// Owning composition `duration_s`.
    pub duration: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    And,
    Or,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TimeConst {
    Time,
    Frame,
    Fps,
    Duration,
}
#[derive(Clone, Debug)]
enum Node {
    Num(f64),
    Time(TimeConst),
    Neg(Box<Node>),
    Not(Box<Node>),
    Binary(BinOp, Box<Node>, Box<Node>),
    Ternary(Box<Node>, Box<Node>, Box<Node>),
    Call(&'static str, Vec<Node>),
    ThisProp(Property),
    LayerProp(u64, Property),
    /// Parser-internal markers; postfix resolves them into the Prop nodes
    /// above or rejects, so they can never reach evaluation.
    This,
    LayerSel(u64),
}

/// A parsed expression: the AST plus the property references it makes, in
/// `(layer_id, property)` cell space where `None` means the owner layer.
pub struct Ast {
    root: Node,
    refs: Vec<(Option<u64>, Property)>,
}
impl Ast {
    /// Every `this.<prop>` (`None`) and `layer(<id>).<prop>` reference.
    pub fn references(&self) -> &[(Option<u64>, Property)] {
        &self.refs
    }
    /// Evaluate against `env`; `resolve(layer_id, property)` supplies
    /// referenced cell values (the owner layer's id is passed for `this`).
    /// Node visits are counted defensively; exceeding MAX_EVAL_STEPS yields
    /// NaN, which the property boundary sanitizes to 0.0.
    pub fn eval(
        &self,
        env: &Env,
        owner: u64,
        resolve: &mut dyn FnMut(u64, Property) -> f64,
    ) -> f64 {
        let mut steps = 0u32;
        eval_node(&self.root, env, owner, resolve, &mut steps)
    }
}

fn eval_node(
    node: &Node,
    env: &Env,
    owner: u64,
    resolve: &mut dyn FnMut(u64, Property) -> f64,
    steps: &mut u32,
) -> f64 {
    *steps += 1;
    if *steps > MAX_EVAL_STEPS {
        return f64::NAN;
    }
    match node {
        Node::Num(v) => *v,
        Node::Time(c) => match c {
            TimeConst::Time => env.time,
            TimeConst::Frame => env.frame,
            TimeConst::Fps => env.fps,
            TimeConst::Duration => env.duration,
        },
        Node::Neg(a) => -eval_node(a, env, owner, resolve, steps),
        Node::Not(a) => {
            // Truthiness is `v != 0.0` (IEEE: NaN is truthy), matching &&/||.
            if eval_node(a, env, owner, resolve, steps) != 0. {
                0.
            } else {
                1.
            }
        }
        Node::Ternary(c, a, b) => {
            if eval_node(c, env, owner, resolve, steps) != 0. {
                eval_node(a, env, owner, resolve, steps)
            } else {
                eval_node(b, env, owner, resolve, steps)
            }
        }
        Node::Binary(op, l, r) => match op {
            BinOp::And => {
                if eval_node(l, env, owner, resolve, steps) != 0.
                    && eval_node(r, env, owner, resolve, steps) != 0.
                {
                    1.
                } else {
                    0.
                }
            }
            BinOp::Or => {
                if eval_node(l, env, owner, resolve, steps) != 0.
                    || eval_node(r, env, owner, resolve, steps) != 0.
                {
                    1.
                } else {
                    0.
                }
            }
            _ => {
                let a = eval_node(l, env, owner, resolve, steps);
                let b = eval_node(r, env, owner, resolve, steps);
                match op {
                    BinOp::Add => a + b,
                    BinOp::Sub => a - b,
                    BinOp::Mul => a * b,
                    BinOp::Div => a / b,
                    BinOp::Mod => a % b,
                    BinOp::Lt => (a < b) as u8 as f64,
                    BinOp::Le => (a <= b) as u8 as f64,
                    BinOp::Gt => (a > b) as u8 as f64,
                    BinOp::Ge => (a >= b) as u8 as f64,
                    BinOp::Eq => (a == b) as u8 as f64,
                    BinOp::Ne => (a != b) as u8 as f64,
                    BinOp::And | BinOp::Or => unreachable!(),
                }
            }
        },
        Node::Call(name, args) => {
            // Arity is fixed at parse time; every admitted function takes
            // at most 3 arguments.
            let mut v = [0.; 3];
            for (i, arg) in args.iter().enumerate() {
                v[i] = eval_node(arg, env, owner, resolve, steps);
            }
            apply_fn(name, &v[..args.len()])
        }
        Node::ThisProp(p) => resolve(owner, *p),
        Node::LayerProp(id, p) => resolve(*id, *p),
        // Postfix rejects unqualified this/layer() before they can eval.
        Node::This | Node::LayerSel(_) => f64::NAN,
    }
}

/// Whitelisted pure functions: name → (canonical &'static str, arity).
/// `random`/noise/time-source functions are deliberately absent — there is
/// no clock and no host call anywhere in evaluation.
fn function(name: &str) -> Option<(&'static str, usize)> {
    Some(match name {
        "abs" => ("abs", 1),
        "floor" => ("floor", 1),
        "ceil" => ("ceil", 1),
        "round" => ("round", 1),
        "trunc" => ("trunc", 1),
        "sign" => ("sign", 1),
        "sqrt" => ("sqrt", 1),
        "cbrt" => ("cbrt", 1),
        "exp" => ("exp", 1),
        "ln" => ("ln", 1),
        "log10" => ("log10", 1),
        "sin" => ("sin", 1),
        "cos" => ("cos", 1),
        "tan" => ("tan", 1),
        "asin" => ("asin", 1),
        "acos" => ("acos", 1),
        "atan" => ("atan", 1),
        "atan2" => ("atan2", 2),
        "pow" => ("pow", 2),
        "hypot" => ("hypot", 2),
        "min" => ("min", 2),
        "max" => ("max", 2),
        "mod" => ("mod", 2),
        "clamp" => ("clamp", 3),
        "lerp" => ("lerp", 3),
        "smoothstep" => ("smoothstep", 3),
        _ => return None,
    })
}

/// NaN-propagating min/max: IEEE min/max would silently drop NaN operands,
/// but the spec requires non-finite values to propagate to the boundary.
pub(crate) fn fmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}
pub(crate) fn fmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
/// Manual clamp: `f64::clamp` panics on NaN bounds; comparisons keep NaN v.
pub(crate) fn fclamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}
fn apply_fn(name: &str, args: &[f64]) -> f64 {
    match name {
        "abs" => args[0].abs(),
        "floor" => args[0].floor(),
        "ceil" => args[0].ceil(),
        "round" => args[0].round(),
        "trunc" => args[0].trunc(),
        "sign" => {
            let v = args[0];
            if v.is_nan() {
                f64::NAN
            } else if v > 0. {
                1.
            } else if v < 0. {
                -1.
            } else {
                0.
            }
        }
        "sqrt" => args[0].sqrt(),
        "cbrt" => args[0].cbrt(),
        "exp" => args[0].exp(),
        "ln" => args[0].ln(),
        "log10" => args[0].log10(),
        "sin" => args[0].sin(),
        "cos" => args[0].cos(),
        "tan" => args[0].tan(),
        "asin" => args[0].asin(),
        "acos" => args[0].acos(),
        "atan" => args[0].atan(),
        "atan2" => args[0].atan2(args[1]),
        "pow" => args[0].powf(args[1]),
        "hypot" => args[0].hypot(args[1]),
        "min" => fmin(args[0], args[1]),
        "max" => fmax(args[0], args[1]),
        "mod" => args[0] % args[1],
        "clamp" => fclamp(args[0], args[1], args[2]),
        "lerp" => args[0] + (args[1] - args[0]) * args[2],
        "smoothstep" => {
            let t = fclamp((args[2] - args[0]) / (args[1] - args[0]), 0., 1.);
            t * t * (3. - 2. * t)
        }
        _ => f64::NAN,
    }
}

// ---------------- lexer ----------------

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Ident(String),
    Op(&'static str),
    LParen,
    RParen,
    Comma,
    Dot,
    Question,
    Colon,
}
#[derive(Clone, Debug)]
struct Token {
    tok: Tok,
    start: usize,
    end: usize,
}

fn lex(src: &str) -> Result<Vec<Token>, &'static str> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let tok = match c {
            b'0'..=b'9' => {
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i < b.len() && b[i] == b'.' {
                    i += 1;
                    while i < b.len() && b[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
                    i += 1;
                    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
                        i += 1;
                    }
                    while i < b.len() && b[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                let text = &src[start..i];
                let v: f64 = text.parse().map_err(|_| "invalid number")?;
                Tok::Num(v)
            }
            b'.' if i + 1 < b.len() && b[i + 1].is_ascii_digit() => {
                i += 1;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
                    i += 1;
                    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
                        i += 1;
                    }
                    while i < b.len() && b[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                let v: f64 = src[start..i].parse().map_err(|_| "invalid number")?;
                Tok::Num(v)
            }
            b'.' => {
                i += 1;
                Tok::Dot
            }
            b'_' | b'a'..=b'z' | b'A'..=b'Z' => {
                while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                    i += 1;
                }
                Tok::Ident(src[start..i].to_string())
            }
            b'(' => {
                i += 1;
                Tok::LParen
            }
            b')' => {
                i += 1;
                Tok::RParen
            }
            b',' => {
                i += 1;
                Tok::Comma
            }
            b'?' => {
                i += 1;
                Tok::Question
            }
            b':' => {
                i += 1;
                Tok::Colon
            }
            b'+' => {
                i += 1;
                Tok::Op("+")
            }
            b'-' => {
                i += 1;
                Tok::Op("-")
            }
            b'*' => {
                i += 1;
                Tok::Op("*")
            }
            b'/' => {
                i += 1;
                Tok::Op("/")
            }
            b'%' => {
                i += 1;
                Tok::Op("%")
            }
            b'<' => {
                if i + 1 < b.len() && b[i + 1] == b'=' {
                    i += 2;
                    Tok::Op("<=")
                } else {
                    i += 1;
                    Tok::Op("<")
                }
            }
            b'>' => {
                if i + 1 < b.len() && b[i + 1] == b'=' {
                    i += 2;
                    Tok::Op(">=")
                } else {
                    i += 1;
                    Tok::Op(">")
                }
            }
            b'=' => {
                if i + 1 < b.len() && b[i + 1] == b'=' {
                    i += 2;
                    Tok::Op("==")
                } else {
                    return Err("unexpected character '='");
                }
            }
            b'!' => {
                if i + 1 < b.len() && b[i + 1] == b'=' {
                    i += 2;
                    Tok::Op("!=")
                } else {
                    i += 1;
                    Tok::Op("!")
                }
            }
            b'&' => {
                if i + 1 < b.len() && b[i + 1] == b'&' {
                    i += 2;
                    Tok::Op("&&")
                } else {
                    return Err("unexpected character '&'");
                }
            }
            b'|' => {
                if i + 1 < b.len() && b[i + 1] == b'|' {
                    i += 2;
                    Tok::Op("||")
                } else {
                    return Err("unexpected character '|'");
                }
            }
            _ => return Err("unexpected character"),
        };
        out.push(Token { tok, start, end: i });
    }
    Ok(out)
}

// ---------------- parser ----------------

/// Parse and validate `source` into an AST. Enforces the source byte cap,
/// the 512-node AST cap and the 64-call cap; rejects unknown identifiers,
/// non-whitelisted functions, wrong arities and malformed property
/// references. Parsing is total: hostile input returns Err, never panics.
pub fn parse(source: &str) -> Result<Ast, &'static str> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err("expression source exceeds 4096 bytes");
    }
    let tokens = lex(source)?;
    let mut p = Parser {
        tokens: &tokens,
        pos: 0,
        nodes: 0,
        calls: 0,
        depth: 0,
        refs: Vec::new(),
    };
    let root = p.ternary()?;
    if p.pos != p.tokens.len() {
        return Err("unexpected trailing input");
    }
    Ok(Ast { root, refs: p.refs })
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
    nodes: usize,
    calls: usize,
    depth: usize,
    refs: Vec<(Option<u64>, Property)>,
}
impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Tok> {
        self.tokens.get(self.pos).map(|t| &t.tok)
    }
    fn bump_node(&mut self) -> Result<(), &'static str> {
        self.nodes += 1;
        if self.nodes > MAX_NODES {
            Err("expression AST exceeds 512 nodes")
        } else {
            Ok(())
        }
    }
    fn eat_op(&mut self, op: &'static str) -> bool {
        if self.peek() == Some(&Tok::Op(op)) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, tok: &Tok) -> Result<(), &'static str> {
        if self.peek() == Some(tok) {
            self.pos += 1;
            Ok(())
        } else {
            Err("unexpected token")
        }
    }
    fn ident(&mut self) -> Result<String, &'static str> {
        match self.peek() {
            Some(Tok::Ident(s)) => {
                let s = s.clone();
                self.pos += 1;
                Ok(s)
            }
            _ => Err("expected identifier"),
        }
    }
    fn expr(&mut self) -> Result<Node, &'static str> {
        // Single funnel for nested-expression recursion (parens, ternary
        // branches, call arguments): count depth so hostile nesting returns
        // Err instead of growing the stack without bound.
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            self.depth -= 1;
            return Err("expression nesting exceeds 128 levels");
        }
        let node = self.ternary();
        self.depth -= 1;
        node
    }
    fn ternary(&mut self) -> Result<Node, &'static str> {
        let cond = self.logic()?;
        if self.peek() == Some(&Tok::Question) {
            self.pos += 1;
            let yes = self.expr()?;
            self.expect(&Tok::Colon)?;
            let no = self.expr()?;
            self.bump_node()?;
            Ok(Node::Ternary(Box::new(cond), Box::new(yes), Box::new(no)))
        } else {
            Ok(cond)
        }
    }
    fn logic(&mut self) -> Result<Node, &'static str> {
        let mut left = self.cmp()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op("&&")) => BinOp::And,
                Some(Tok::Op("||")) => BinOp::Or,
                _ => break,
            };
            self.pos += 1;
            let right = self.cmp()?;
            self.bump_node()?;
            left = Node::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
    fn cmp(&mut self) -> Result<Node, &'static str> {
        let mut left = self.add()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op("<")) => BinOp::Lt,
                Some(Tok::Op("<=")) => BinOp::Le,
                Some(Tok::Op(">")) => BinOp::Gt,
                Some(Tok::Op(">=")) => BinOp::Ge,
                Some(Tok::Op("==")) => BinOp::Eq,
                Some(Tok::Op("!=")) => BinOp::Ne,
                _ => break,
            };
            self.pos += 1;
            let right = self.add()?;
            self.bump_node()?;
            left = Node::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
    fn add(&mut self) -> Result<Node, &'static str> {
        let mut left = self.mul()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op("+")) => BinOp::Add,
                Some(Tok::Op("-")) => BinOp::Sub,
                _ => break,
            };
            self.pos += 1;
            let right = self.mul()?;
            self.bump_node()?;
            left = Node::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
    fn mul(&mut self) -> Result<Node, &'static str> {
        let mut left = self.unary()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op("*")) => BinOp::Mul,
                Some(Tok::Op("/")) => BinOp::Div,
                Some(Tok::Op("%")) => BinOp::Mod,
                _ => break,
            };
            self.pos += 1;
            let right = self.unary()?;
            self.bump_node()?;
            left = Node::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
    fn unary(&mut self) -> Result<Node, &'static str> {
        // Prefix `-`/`!` runs are collected iteratively: `-`-heavy sources
        // fit the byte cap many times over, so recursion here would also be
        // stack-unbounded. Each op still costs one AST node via bump_node.
        let mut ops = Vec::new();
        loop {
            if self.eat_op("-") {
                ops.push(false);
            } else if self.eat_op("!") {
                ops.push(true);
            } else {
                break;
            }
        }
        let mut node = self.postfix()?;
        for &is_not in ops.iter().rev() {
            self.bump_node()?;
            node = if is_not {
                Node::Not(Box::new(node))
            } else {
                Node::Neg(Box::new(node))
            };
        }
        Ok(node)
    }
    fn postfix(&mut self) -> Result<Node, &'static str> {
        let node = self.primary()?;
        if self.peek() == Some(&Tok::Dot) {
            self.pos += 1;
            let name = self.ident()?;
            let property = Property::from_name(&name).ok_or("unknown property")?;
            let node = match node {
                Node::This => {
                    self.refs.push((None, property));
                    Node::ThisProp(property)
                }
                Node::LayerSel(id) => {
                    self.refs.push((Some(id), property));
                    Node::LayerProp(id, property)
                }
                _ => return Err("property reference requires this or layer(id)"),
            };
            self.bump_node()?;
            Ok(node)
        } else if matches!(node, Node::This | Node::LayerSel(_)) {
            Err("expected .<property> after this or layer(id)")
        } else {
            Ok(node)
        }
    }
    fn primary(&mut self) -> Result<Node, &'static str> {
        match self.peek().cloned() {
            Some(Tok::Num(v)) => {
                self.pos += 1;
                self.bump_node()?;
                Ok(Node::Num(v))
            }
            Some(Tok::LParen) => {
                self.pos += 1;
                let node = self.expr()?;
                self.expect(&Tok::RParen)?;
                Ok(node)
            }
            Some(Tok::Ident(name)) => {
                self.pos += 1;
                match name.as_str() {
                    "time" | "frame" | "fps" | "duration" => {
                        if matches!(self.peek(), Some(Tok::LParen)) {
                            return Err("time constant is not callable");
                        }
                        self.bump_node()?;
                        Ok(Node::Time(match name.as_str() {
                            "time" => TimeConst::Time,
                            "frame" => TimeConst::Frame,
                            "fps" => TimeConst::Fps,
                            _ => TimeConst::Duration,
                        }))
                    }
                    "this" => {
                        if matches!(self.peek(), Some(Tok::LParen)) {
                            return Err("this is not callable");
                        }
                        self.bump_node()?;
                        Ok(Node::This)
                    }
                    "layer" => {
                        if !matches!(self.peek(), Some(Tok::LParen)) {
                            return Err("layer requires (id)");
                        }
                        self.pos += 1;
                        let id = self.layer_id()?;
                        self.bump_node()?;
                        Ok(Node::LayerSel(id))
                    }
                    _ => {
                        let Some((canonical, arity)) = function(&name) else {
                            return Err("unknown identifier");
                        };
                        if !matches!(self.peek(), Some(Tok::LParen)) {
                            return Err("function requires an argument list");
                        }
                        self.pos += 1;
                        let mut args = Vec::new();
                        if self.peek() != Some(&Tok::RParen) {
                            loop {
                                args.push(self.expr()?);
                                if self.peek() == Some(&Tok::Comma) {
                                    self.pos += 1;
                                } else {
                                    break;
                                }
                            }
                        }
                        self.expect(&Tok::RParen)?;
                        if args.len() != arity {
                            return Err("wrong argument count");
                        }
                        self.calls += 1;
                        if self.calls > MAX_CALLS {
                            return Err("expression exceeds 64 function calls");
                        }
                        self.bump_node()?;
                        Ok(Node::Call(canonical, args))
                    }
                }
            }
            _ => Err("expected expression"),
        }
    }
    /// `layer(<id>)` argument: a single nonnegative safe-integer literal.
    fn layer_id(&mut self) -> Result<u64, &'static str> {
        let id = match self.peek() {
            Some(Tok::Num(v))
                if v.is_finite() && v.fract() == 0. && *v >= 1. && *v <= 9_007_199_254_740_992. =>
            {
                *v as u64
            }
            _ => return Err("layer id must be a positive integer literal"),
        };
        self.pos += 1;
        self.expect(&Tok::RParen)?;
        Ok(id)
    }
}

/// Rewrite `layer(<id>)` numeric arguments through `ids` so a duplicated
/// composition's expressions point at the copy's fresh layer identities
/// (the `duplicateComposition` remap). `this` references need no rewrite.
/// Unmapped ids are left untouched so `validate` rejects the dangling ref.
pub fn remap_layer_refs(source: &str, ids: &BTreeMap<u64, u64>) -> Result<String, &'static str> {
    let tokens = lex(source)?;
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let mut i = 0;
    while i + 3 < tokens.len() {
        if matches!(&tokens[i].tok, Tok::Ident(s) if s == "layer")
            && tokens[i + 1].tok == Tok::LParen
        {
            if let Tok::Num(v) = tokens[i + 2].tok {
                if tokens[i + 3].tok == Tok::RParen && v.is_finite() && v.fract() == 0. && v >= 1. {
                    if let Some(&new) = ids.get(&(v as u64)) {
                        edits.push((tokens[i + 2].start, tokens[i + 2].end, new.to_string()));
                    }
                }
            }
        }
        i += 1;
    }
    let mut out = source.to_string();
    for (start, end, text) in edits.into_iter().rev() {
        out.replace_range(start..end, &text);
    }
    Ok(out)
}
