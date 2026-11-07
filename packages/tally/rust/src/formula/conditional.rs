//! Strict, bounded COUNTIF/SUMIF subset; see report for deliberate Excel differences.
use super::*;
const CELLS: u64 = 16_384;
const WORK: usize = 1_000_000;
#[derive(Clone, Copy)]
enum Op {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}
#[derive(Clone, Copy)]
enum Token {
    Literal(char),
    Any,
    Star,
}
#[derive(Clone)]
enum Criterion {
    Number(Op, f64),
    Text(Op, Vec<Token>),
    Boolean(bool),
}
fn spend(work: &mut usize, n: usize) -> Result<(), Value> {
    *work = work
        .checked_add(n)
        .filter(|n| *n <= WORK)
        .ok_or(Value::Err(ERR_NUM))?;
    Ok(())
}
fn criterion(value: Value, work: &mut usize) -> Result<Criterion, Value> {
    spend(work, 1)?;
    match value {
        Value::Err(e) => Err(Value::Err(e)),
        Value::Num(n) if n.is_finite() => Ok(Criterion::Number(Op::Eq, n)),
        Value::Num(_) => Err(Value::Err(ERR_NUM)),
        Value::Bool(b) => Ok(Criterion::Boolean(b)),
        Value::Empty => Ok(Criterion::Text(Op::Eq, vec![])),
        Value::Str(text) => {
            let length = text.chars().take(256).count();
            if length > 255 {
                return Err(Value::Err(ERR_VALUE));
            }
            spend(work, length)?;
            let mut op = Op::Eq;
            let mut body = text.as_str();
            for (prefix, kind) in [
                ("<=", Op::Le),
                (">=", Op::Ge),
                ("<>", Op::Ne),
                ("=", Op::Eq),
                ("<", Op::Lt),
                (">", Op::Gt),
            ] {
                if let Some(tail) = body.strip_prefix(prefix) {
                    body = tail;
                    op = kind;
                    break;
                }
            }
            if let Ok(n) = body.trim().parse::<f64>() {
                if n.is_finite() {
                    return Ok(Criterion::Number(op, n));
                }
            }
            if !matches!(op, Op::Eq | Op::Ne) {
                return Err(Value::Err(ERR_VALUE));
            }
            let mut chars = body.chars().peekable();
            let mut tokens = vec![];
            while let Some(c) = chars.next() {
                tokens.push(match c {
                    '*' => Token::Star,
                    '?' => Token::Any,
                    '~' if chars.peek().is_some_and(|n| matches!(n, '*' | '?' | '~')) => {
                        Token::Literal(chars.next().unwrap().to_ascii_lowercase())
                    }
                    _ => Token::Literal(c.to_ascii_lowercase()),
                });
            }
            Ok(Criterion::Text(op, tokens))
        }
        _ => Err(Value::Err(ERR_VALUE)),
    }
}
fn pattern(tokens: &[Token], text: &str, work: &mut usize) -> Result<bool, Value> {
    if text.len() > 4096 {
        return Err(Value::Err(ERR_VALUE));
    }
    // Charge allocation-sized work first; Unicode scalar count cannot exceed byte count.
    spend(work, text.len() + tokens.len() + 1)?;
    let chars: Vec<_> = text.chars().map(|c| c.to_ascii_lowercase()).collect();
    let mut dp = vec![false; chars.len() + 1];
    let mut next = dp.clone();
    dp[0] = true;
    for token in tokens {
        next.fill(false);
        next[0] = matches!(token, Token::Star) && dp[0];
        for i in 1..=chars.len() {
            spend(work, 1)?;
            next[i] = match token {
                Token::Star => dp[i] || next[i - 1],
                Token::Any => dp[i - 1],
                Token::Literal(c) => dp[i - 1] && *c == chars[i - 1],
            };
        }
        std::mem::swap(&mut dp, &mut next);
    }
    Ok(dp[chars.len()])
}
impl Criterion {
    fn matches(&self, value: Value, work: &mut usize) -> Result<bool, Value> {
        if matches!(value, Value::Num(n) if !n.is_finite()) {
            return Err(Value::Err(ERR_NUM));
        }
        if let Value::Err(e) = value {
            return Err(Value::Err(e));
        }
        match (self, value) {
            (Criterion::Number(op, n), Value::Num(value)) => Ok(match op {
                Op::Eq => value == *n,
                Op::Ne => value != *n,
                Op::Lt => value < *n,
                Op::Le => value <= *n,
                Op::Gt => value > *n,
                Op::Ge => value >= *n,
            }),
            (Criterion::Boolean(expected), Value::Bool(value)) => Ok(*expected == value),
            (Criterion::Text(op, tokens), Value::Str(text)) => {
                let matched = pattern(tokens, &text, work)?;
                Ok(if matches!(op, Op::Ne) {
                    !matched
                } else {
                    matched
                })
            }
            (Criterion::Text(op, tokens), Value::Empty) if tokens.is_empty() => {
                Ok(!matches!(op, Op::Ne))
            }
            _ => Ok(false),
        }
    }
}
/// A parsed COUNTIF-style criteria string, reusable across many computed
/// values (conditional-format rules evaluate one criteria per cell).
#[derive(Clone)]
pub struct CriteriaMatcher(Criterion);

impl CriteriaMatcher {
    /// Parse a criteria string (`">=3"`, `"apple*"`, `""`, …) under the same
    /// rules `COUNTIF` applies to its criteria argument: numbers and
    /// `=`/`<>`/`<`/`<=`/`>`/`>=`-prefixed numerics compare numbers only,
    /// text supports `*`/`?`/`~` wildcards with ASCII-case-insensitive
    /// matching, and relational non-numeric text rejects.
    pub fn parse(criteria: &str) -> Result<Self, Value> {
        let mut work = 0usize;
        criterion(Value::Str(criteria.to_string()), &mut work).map(Self)
    }

    /// Whether `criteria` parses; used by op validation and hostile-restore
    /// checks so stored rules always satisfy the matcher.
    pub fn is_valid(criteria: &str) -> bool {
        Self::parse(criteria).is_ok()
    }

    /// Test a computed cell value against the criteria. `work` is the shared
    /// per-evaluator conditional allowance; exhaustion returns `#NUM!`.
    pub fn matches(&self, value: &Value, work: &mut usize) -> Result<bool, Value> {
        self.0.matches(value.clone(), work)
    }
}

#[derive(Clone, Copy)]
struct Rect {
    c: u32,
    r: u32,
    w: u32,
    h: u32,
}
fn rect_coords(c0: u32, r0: u32, c1: u32, r1: u32) -> Result<Rect, Value> {
    if !on_sheet(c0, r0) || !on_sheet(c1, r1) {
        return Err(Value::Err(ERR_REF));
    }
    let w = c1 - c0 + 1;
    let h = r1 - r0 + 1;
    if u64::from(w) * u64::from(h) > CELLS {
        return Err(Value::Err(ERR_NUM));
    }
    Ok(Rect { c: c0, r: r0, w, h })
}

fn rect(expr: &Expr) -> Result<Rect, Value> {
    let (c0, r0, c1, r1) = match expr {
        Expr::Cell(a) => {
            let (c, r) = parse_addr(a).ok_or(Value::Err(ERR_REF))?;
            (c, r, c, r)
        }
        Expr::Range { c0, r0, c1, r1 } => (*c0, *r0, *c1, *r1),
        Expr::BadRef => return Err(Value::Err(ERR_REF)),
        _ => return Err(Value::Err(ERR_VALUE)),
    };
    rect_coords(c0, r0, c1, r1)
}

impl<'a, S: CellLookup + ?Sized> Evaluator<'a, S> {
    /// Range argument for COUNTIF/SUMIF: a literal ref/range, or a defined
    /// name bound to this sheet (unresolved names stay `#VALUE!`, matching
    /// how a non-rectangle argument is rejected).
    fn rect_arg(&self, expr: &Expr) -> Result<Rect, Value> {
        if let Expr::Name(name) = expr {
            if let Some((c0, r0, c1, r1)) = self.name_rect(name) {
                return rect_coords(c0, r0, c1, r1);
            }
            return Err(Value::Err(ERR_VALUE));
        }
        rect(expr)
    }

    pub(super) fn conditional(&mut self, args: &[Expr], sum: bool) -> Value {
        let result = (|| -> Result<Value, Value> {
            if (!sum && args.len() != 2) || (sum && !(2..=3).contains(&args.len())) {
                return Err(Value::Err(ERR_VALUE));
            }
            let criteria_range = self.rect_arg(&args[0])?;
            let sum_range = if sum && args.len() == 3 {
                self.rect_arg(&args[2])?
            } else {
                criteria_range
            };
            if criteria_range.w != sum_range.w || criteria_range.h != sum_range.h {
                return Err(Value::Err(ERR_VALUE));
            }
            let criterion_value = self.eval_expr(&args[1]);
            let criteria = criterion(criterion_value, &mut self.conditional_work)?;
            let mut result = 0.0;
            for row in 0..criteria_range.h {
                for col in 0..criteria_range.w {
                    spend(&mut self.conditional_work, 1)?;
                    let value =
                        self.eval_cell(&fmt_addr(criteria_range.c + col, criteria_range.r + row));
                    if criteria.matches(value, &mut self.conditional_work)? {
                        if !sum {
                            result += 1.0;
                        } else {
                            match self.eval_cell(&fmt_addr(sum_range.c + col, sum_range.r + row)) {
                                Value::Num(n) => {
                                    result += n;
                                    if !result.is_finite() {
                                        return Err(Value::Err(ERR_NUM));
                                    }
                                }
                                Value::Err(e) => return Err(Value::Err(e)),
                                _ => {}
                            }
                        }
                    }
                }
            }
            Ok(Value::Num(result))
        })();
        result.unwrap_or_else(|error| error)
    }

    /// Charge `n` units of the shared per-evaluator conditional allowance for
    /// work that is not a criteria match — `sortRange` uses this for key-cell
    /// evaluations and sort comparisons so large sorts cannot run unbounded.
    /// Exhaustion returns the `#NUM!` error value; callers map it to an op
    /// error before mutating.
    pub fn charge_work(&mut self, n: usize) -> Result<(), Value> {
        spend(&mut self.conditional_work, n)
    }

    /// Test an already-computed value against `matcher`, sharing the
    /// evaluator's conditional work allowance. Every candidate rule-cell
    /// evaluation is charged one unit up front — numeric comparisons,
    /// empty-criteria matches and type mismatches never reach `pattern`'s
    /// inner spends, so without the flat charge a large rule×cell product
    /// (conditional formats evaluate up to 256 rules over 16,384 cells)
    /// could serialize unbounded match reports. Error-valued cells never
    /// match; matcher failures (work exhaustion, over-long text) surface as
    /// `Err`. Pair with `eval_cell` so the cell evaluates once per request.
    pub fn match_value(
        &mut self,
        value: &Value,
        matcher: &CriteriaMatcher,
    ) -> Result<bool, Value> {
        spend(&mut self.conditional_work, 1)?;
        match value {
            Value::Err(_) => Ok(false),
            _ => matcher.matches(value, &mut self.conditional_work),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    struct Cells(BTreeMap<String, String>);
    impl Cells {
        fn new(rows: &[(&str, &str)]) -> Self {
            Self(
                rows.iter()
                    .map(|(a, v)| (a.to_string(), v.to_string()))
                    .collect(),
            )
        }
    }
    impl CellLookup for Cells {
        fn cell_raw(&self, a: &str) -> Option<&str> {
            self.0.get(a).map(String::as_str)
        }
        fn addrs_in(&self, c0: u32, r0: u32, c1: u32, r1: u32) -> Vec<String> {
            self.0
                .keys()
                .filter(|a| {
                    parse_addr(a).is_some_and(|(c, r)| c >= c0 && c <= c1 && r >= r0 && r <= r1)
                })
                .cloned()
                .collect()
        }
    }
    fn value(cells: &Cells, formula: &str) -> JsonValue {
        Evaluator::new(cells).eval_formula_text(formula).to_json()
    }
    #[test]
    fn numbers_references_concatenated_criteria_blanks_and_evaluated_cells() {
        let cells = Cells::new(&[
            ("A1", "1"),
            ("A2", "=2+1"),
            ("A3", "5"),
            ("C1", ">=3"),
            ("B1", "10"),
            ("B2", "20"),
            ("B3", "30"),
            ("C2", "=TRUE"),
            ("C3", "=\"3\""),
        ]);
        for (f, want) in [
            ("COUNTIF(A1:A4,\">=3\")", 2.0),
            ("COUNTIF(A1:A4,C1)", 2.0),
            ("COUNTIF(A1:A4,\">\"&A1)", 2.0),
            ("SUMIF(A1:A3,\">1\",B1:B3)", 50.0),
            ("SUMIF(A1:A3,\">1\")", 8.0),
            ("COUNTIF(A1:A4,\"\")", 1.0),
            ("COUNTIF(C2,TRUE)", 1.0),
            ("COUNTIF(C3,3)", 0.0),
        ] {
            assert_eq!(value(&cells, f), json!(want), "{f}");
        }
    }
    #[test]
    fn unicode_scalars_ascii_case_and_escaped_wildcards() {
        let cells = Cells::new(&[
            ("A1", "Apple"),
            ("A2", "APPLE"),
            ("A3", "a*"),
            ("A4", "a?"),
            ("A5", "a~"),
            ("A6", "猫😀"),
            ("A7", "Ä"),
            ("A8", "ä"),
        ]);
        for (f, want) in [
            (r#"COUNTIF(A1:A8,"apple")"#, 2.0),
            (r#"COUNTIF(A1:A8,"a~*")"#, 1.0),
            (r#"COUNTIF(A1:A8,"a~?")"#, 1.0),
            (r#"COUNTIF(A1:A8,"a~~")"#, 1.0),
            (r#"COUNTIF(A6,"??")"#, 1.0),
            (r#"COUNTIF(A6,"?")"#, 0.0),
            (r#"COUNTIF(A7:A8,"Ä")"#, 1.0),
            (r#"COUNTIF(A1:A8,"a*")"#, 5.0),
            (r#"COUNTIF(A1:A8,"<>apple")"#, 6.0),
        ] {
            assert_eq!(value(&cells, f), json!(want), "{f}");
        }
        assert_eq!(value(&Cells::new(&[]), r#"COUNTIF(A1:A3,"*")"#), json!(0.0));
    }
    #[test]
    fn shape_reference_errors_cycles_and_lazy_sum_cells() {
        let cells = Cells::new(&[
            ("A1", "1"),
            ("A2", "2"),
            ("B1", "=1/0"),
            ("B2", "10"),
            ("C1", "=COUNTIF(C1,1)"),
            ("D1", "1e308"),
            ("D2", "1e308"),
            ("E1", "=SUM(D1:D2)"),
        ]);
        for (f, want) in [
            ("SUMIF(A1:A2,1,B1:C1)", ERR_VALUE),
            ("COUNTIF(XFE1,1)", ERR_REF),
            ("COUNTIF(1,1)", ERR_VALUE),
            ("COUNTIF(A1:A2)", ERR_VALUE),
            ("COUNTIF(B1,1)", ERR_DIV0),
            ("COUNTIF(A1,B1)", ERR_DIV0),
            ("COUNTIF(C1,1)", ERR_CYCLE),
            ("SUMIF(A1:A2,1,B1:B2)", ERR_DIV0),
            ("SUMIF(D1:D2,\">0\")", ERR_NUM),
            ("COUNTIF(A1,E1)", ERR_NUM),
            ("COUNTIF(E1,1)", ERR_NUM),
            ("COUNTIF(A1:A2,\">apple\")", ERR_VALUE),
        ] {
            assert_eq!(value(&cells, f), json!(want), "{f}");
        }
        assert_eq!(value(&cells, "SUMIF(A1:A2,2,B1:B2)"), json!(10.0));
    }
    #[test]
    fn deterministic_range_text_criteria_and_shared_work_limits() {
        let cells = Cells::new(&[]);
        assert_eq!(value(&cells, "COUNTIF(A1:XFD2,1)"), json!(ERR_NUM));
        assert_eq!(
            value(&cells, &format!("COUNTIF(A1,\"{}\")", "x".repeat(256))),
            json!(ERR_VALUE)
        );
        let cells = Cells::new(&[("A1", &"x".repeat(4097))]);
        assert_eq!(value(&cells, "COUNTIF(A1,\"*\")"), json!(ERR_VALUE));
        let cells = Cells::new(&[("A1", &"x".repeat(4096))]);
        let f = format!("COUNTIF(A1,\"{}\")", "?".repeat(255));
        assert_eq!(value(&cells, &f), json!(ERR_NUM));
        let mut evaluator = Evaluator::new(&cells);
        evaluator.conditional_work = WORK;
        assert_eq!(
            evaluator.eval_formula_text("COUNTIF(A2,1)").to_json(),
            json!(ERR_NUM)
        );
    }
}

#[cfg(test)]
mod document_tests {
    use super::*;
    use ignition_core::{Command, Engine};
    #[test]
    fn stored_conditional_formulas_recompute_after_edit_undo_and_reopen() {
        let mut engine = crate::TallyEngine::new();
        for (addr, raw) in [
            ("A1", "Apple"),
            ("A2", "APPLE"),
            ("B1", "10"),
            ("B2", "20"),
            ("C1", "=COUNTIF(A1:A2,\"apple\")"),
            ("D1", "=SUMIF(A1:A2,\"apple\",B1:B2)"),
        ] {
            engine
                .apply(Command::new("setCell", json!({"addr":addr,"value":raw})))
                .unwrap();
        }
        let get = |e: &mut crate::TallyEngine, a: &str| {
            e.apply(Command::new("getCell", json!({"addr":a})))
                .unwrap()
                .data
        };
        assert_eq!(get(&mut engine, "C1")["computed"], 2.0);
        assert_eq!(get(&mut engine, "D1")["computed"], 30.0);
        let saved = engine.snapshot().unwrap();
        engine
            .apply(Command::new("setCell", json!({"addr":"A1","value":"pear"})))
            .unwrap();
        assert_eq!(get(&mut engine, "C1")["computed"], 1.0);
        assert_eq!(get(&mut engine, "D1")["computed"], 20.0);
        assert!(engine.undo().unwrap());
        assert_eq!(get(&mut engine, "D1")["computed"], 30.0);
        assert!(engine.redo().unwrap());
        assert_eq!(get(&mut engine, "D1")["computed"], 20.0);
        let mut reopened = crate::TallyEngine::new();
        reopened.restore(&saved).unwrap();
        assert_eq!(get(&mut reopened, "C1")["raw"], "=COUNTIF(A1:A2,\"apple\")");
        assert_eq!(get(&mut reopened, "C1")["computed"], 2.0);
        assert_eq!(get(&mut reopened, "D1")["computed"], 30.0);
    }
}
