//! Durable workbook-level chart objects and the `insertChart`/`updateChart`/
//! `removeChart`/`listCharts` ops.
//!
//! Model decision: charts are **workbook-level entries** bound to one sheet
//! by durable sheet id, like `NamedRange`s and the rule tables —
//! `ChartSpec = { id, sheet: sheet-id, kind, title?, range, series?,
//! colors? }` where `range` is the canonical `"A1"`/`"A1:B2"` data anchor on
//! the bound sheet (reuses `name_ops::parse_refers_to`, capped at the shared
//! 16,384-cell bound via `Rect::read` on the op path). `kind` is a bounded
//! enum (`line`/`column`/`bar`/`area`/`pie`); `title` is an optional bounded
//! string; `series` is an optional bounded list of `{name?, range?}`
//! overrides (each range canonical on the same sheet); `colors` an optional
//! bounded `#RRGGBB` palette. At most `MAX_CHARTS` per workbook.
//!
//! **Rendering stays host-side**: the engine stores and returns the bounded
//! spec only — it never evaluates series data, computes chart geometry or
//! draws pixels. `describe`/`listCharts` expose the stored spec; a host
//! reads cell values through `getRange`/`getCell` and renders.
//!
//! `updateChart` is a partial patch: present keys set, explicit `null`
//! clears the optional `title`/`series`/`colors`, `kind`/`range` cannot be
//! nulled, and unknown patch keys reject (`deny_unknown_fields` on the
//! stored spec keeps deferred NYC-Tron chart fields from being silently
//! dropped). An update that leaves the spec unchanged is eventless.
//! `insertChart` always creates (duplicate specs are allowed — charts are
//! objects, not keyed rules). `removeChart`/`updateChart` take `id` only;
//! a `sheet` field alongside `id` rejects like the `clear*` mixed-selector
//! precedent rather than being silently ignored. `removeSheet`
//! cascade-drops the sheet's charts into the same undo entry, mirroring
//! names/validation/conditional/filter rules.
//!
//! Protection: charts are workbook metadata bound to a sheet, so mutations
//! are guarded by the bound/target sheet exactly like name/rule ops (see
//! `protection.rs`); `listCharts` is ungated.
use super::format_ops::valid_color;
use super::range_ops::Rect;
use super::*;

/// Maximum charts per workbook.
pub const MAX_CHARTS: usize = 256;
/// Maximum series overrides per chart.
pub const MAX_CHART_SERIES: usize = 32;
/// `title` bound in UTF-8 bytes.
pub const MAX_CHART_TITLE_LEN: usize = 512;
/// Series `name` bound in UTF-8 bytes.
pub const MAX_CHART_SERIES_NAME_LEN: usize = 128;
/// Maximum `#RRGGBB` palette entries per chart.
pub const MAX_CHART_COLORS: usize = 16;

/// Bounded chart kinds; rendering is host-side.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChartKind {
    Line,
    Column,
    Bar,
    Area,
    Pie,
}

/// One optional series override: a display `name` and/or a `range`
/// canonical `"A1"`/`"A1:B2"` on the chart's sheet. At least one field is
/// required; `deny_unknown_fields` rejects deferred fields.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartSeries {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<String>,
}

/// One durable chart object: `id` is a workbook-unique handle,
/// `sheet` the bound sheet id, `range` the canonical data anchor.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartSpec {
    pub id: u64,
    pub sheet: u64,
    pub kind: ChartKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<Vec<ChartSeries>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
}

/// `insertChart`'s `chart` payload (id/sheet are engine-assigned).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChartInput {
    kind: ChartKind,
    #[serde(default)]
    title: Option<String>,
    range: Value,
    #[serde(default)]
    series: Option<Vec<ChartSeriesInput>>,
    #[serde(default)]
    colors: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChartSeriesInput {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    range: Option<Value>,
}

/// Parsed `updateChart` patch: `Some(None)` clears an optional field,
/// `Some(Some(_))` sets it, outer `None` leaves it untouched.
struct ChartPatch {
    kind: Option<ChartKind>,
    title: Option<Option<String>>,
    range: Option<name_ops::RefersCoords>,
    series: Option<Option<Vec<ChartSeries>>>,
    colors: Option<Option<Vec<String>>>,
}

fn valid_title(t: &str) -> bool {
    !t.is_empty() && t.len() <= MAX_CHART_TITLE_LEN
}

fn valid_series_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= MAX_CHART_SERIES_NAME_LEN
}

/// Canonicalize a color list: every entry `#RRGGBB`, deduped preserving
/// first occurrence so stored specs and equal-patch comparisons stay
/// canonical.
fn normalize_colors(colors: &[String]) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::with_capacity(colors.len());
    for c in colors {
        if !valid_color(c) {
            return None;
        }
        if !out.contains(c) {
            out.push(c.clone());
        }
    }
    Some(out)
}

/// Parse + bound-check a `series` payload into canonical stored form.
fn parse_series_input(raw: &[ChartSeriesInput]) -> Result<Vec<ChartSeries>, EngineError> {
    if raw.len() > MAX_CHART_SERIES {
        return Err(EngineError::out_of_bounds(format!(
            "chart series limit of {MAX_CHART_SERIES} exceeded"
        )));
    }
    let mut out = Vec::with_capacity(raw.len());
    for s in raw {
        let name = match &s.name {
            None => None,
            Some(n) if valid_series_name(n) => Some(n.clone()),
            Some(_) => {
                return Err(EngineError::validation(
                    "chart series name must be 1-128 bytes",
                ))
            }
        };
        let range = match &s.range {
            None => None,
            Some(v) => {
                let rect = Rect::read(v)?;
                Some(name_ops::canonical_refers_to(rect.coords()))
            }
        };
        if name.is_none() && range.is_none() {
            return Err(EngineError::validation(
                "chart series entries need a name or a range",
            ));
        }
        out.push(ChartSeries { name, range });
    }
    Ok(out)
}

fn parse_colors_input(raw: &[String]) -> Result<Vec<String>, EngineError> {
    if raw.len() > MAX_CHART_COLORS {
        return Err(EngineError::out_of_bounds(format!(
            "chart color limit of {MAX_CHART_COLORS} exceeded"
        )));
    }
    normalize_colors(raw)
        .ok_or_else(|| EngineError::validation("chart colors must be #RRGGBB"))
}

/// Parse the `chart` object of `insertChart` into a canonical spec minus
/// id/sheet.
fn parse_chart_input(v: &Value) -> Result<(ChartKind, Option<String>, String, Option<Vec<ChartSeries>>, Option<Vec<String>>), EngineError> {
    let input: ChartInput = serde_json::from_value(v.clone())
        .map_err(|e| EngineError::invalid(format!("invalid chart spec: {e}")))?;
    if let Some(t) = &input.title {
        if !valid_title(t) {
            return Err(EngineError::validation(
                "chart title must be 1-512 bytes",
            ));
        }
    }
    let rect = Rect::read(&input.range)?;
    let range = name_ops::canonical_refers_to(rect.coords());
    let series = input
        .series
        .as_deref()
        .map(parse_series_input)
        .transpose()?;
    let colors = input
        .colors
        .as_deref()
        .map(parse_colors_input)
        .transpose()?;
    Ok((input.kind, input.title, range, series, colors))
}

/// Parse `updateChart`'s `patch` object. Unknown keys reject; `kind` and
/// `range` cannot be null (a chart always has both); `title`/`series`/
/// `colors` accept null to clear.
fn parse_chart_patch(v: &Value) -> Result<ChartPatch, EngineError> {
    let obj = v
        .as_object()
        .ok_or_else(|| EngineError::invalid("chart patch must be an object"))?;
    for key in obj.keys() {
        if !matches!(key.as_str(), "kind" | "title" | "range" | "series" | "colors") {
            return Err(EngineError::invalid(format!(
                "unknown chart patch field '{key}'"
            )));
        }
    }
    let kind = match obj.get("kind") {
        None => None,
        Some(Value::Null) => {
            return Err(EngineError::invalid("chart patch 'kind' cannot be null"))
        }
        Some(v) => Some(
            serde_json::from_value::<ChartKind>(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid chart kind: {e}")))?,
        ),
    };
    let title = match obj.get("title") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(t)) if valid_title(t) => Some(Some(t.clone())),
        Some(_) => {
            return Err(EngineError::validation(
                "chart title must be 1-512 bytes or null",
            ))
        }
    };
    let range = match obj.get("range") {
        None => None,
        Some(Value::Null) => {
            return Err(EngineError::invalid("chart patch 'range' cannot be null"))
        }
        Some(v) => Some(Rect::read(v)?.coords()),
    };
    let series = match obj.get("series") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => {
            let raw: Vec<ChartSeriesInput> = serde_json::from_value(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid chart series: {e}")))?;
            Some(Some(parse_series_input(&raw)?))
        }
    };
    let colors = match obj.get("colors") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => {
            let raw: Vec<String> = serde_json::from_value(v.clone())
                .map_err(|e| EngineError::invalid(format!("invalid chart colors: {e}")))?;
            Some(Some(parse_colors_input(&raw)?))
        }
    };
    Ok(ChartPatch {
        kind,
        title,
        range,
        series,
        colors,
    })
}

/// Inclusive 0-based rectangle of a stored canonical range.
fn spec_coords(range: &str) -> Option<name_ops::RefersCoords> {
    name_ops::parse_refers_to(range).ok()
}

fn cell_count(coords: name_ops::RefersCoords) -> u64 {
    u64::from(coords.2 - coords.0 + 1) * u64::from(coords.3 - coords.1 + 1)
}

fn range_ok(range: &str) -> bool {
    spec_coords(range).is_some_and(|c| {
        name_ops::canonical_refers_to(c) == range && cell_count(c) <= MAX_GET_RANGE_CELLS
    })
}

fn series_ok(series: &Option<Vec<ChartSeries>>) -> bool {
    match series {
        None => true,
        Some(list) => {
            list.len() <= MAX_CHART_SERIES
                && list.iter().all(|s| {
                    (s.name.is_none() || s.name.as_deref().is_some_and(valid_series_name))
                        && s.range.as_deref().is_none_or(range_ok)
                        && (s.name.is_some() || s.range.is_some())
                })
        }
    }
}

fn colors_ok(colors: &Option<Vec<String>>) -> bool {
    match colors {
        None => true,
        Some(list) => {
            list.len() <= MAX_CHART_COLORS
                && list.iter().all(|c| valid_color(c))
                && {
                    let mut seen = std::collections::BTreeSet::new();
                    list.iter().all(|c| seen.insert(c))
                }
        }
    }
}

/// Field-level check shared by hostile-restore (after canonicalization)
/// and undo re-admission: title bound, canonical in-cap ranges, bounded
/// series/colors, existing bound sheet checked by the caller.
pub(super) fn stored_ok(c: &ChartSpec) -> bool {
    c.title.as_deref().is_none_or(valid_title)
        && range_ok(&c.range)
        && series_ok(&c.series)
        && colors_ok(&c.colors)
}

/// Re-admission check for undo of `removeSheet`: a cascade-dropped chart
/// comes back only while it still satisfies every invariant `restore`
/// enforces — bound sheet exists, unique id, under the cap, stored spec
/// valid. Charts cannot be created for a sheet while it is gone (sheet ids
/// are never recycled), so conflicts are defensive.
pub(super) fn readd_ok(doc: &Workbook, chart: &ChartSpec) -> bool {
    doc.charts.len() < MAX_CHARTS
        && !doc.charts.iter().any(|c| c.id == chart.id)
        && doc.sheets.iter().any(|s| s.id == chart.sheet)
        && stored_ok(chart)
}

impl TallyEngine {
    /// JSON view of one chart with its bound sheet's *current* name
    /// resolved; optional fields appear only when set.
    fn chart_json(&self, c: &ChartSpec) -> Result<Value, EngineError> {
        let sheet = self
            .doc
            .sheets
            .iter()
            .find(|s| s.id == c.sheet)
            .map(|s| s.name.clone());
        let mut out = serde_json::Map::new();
        out.insert("id".to_string(), json!(c.id));
        out.insert("sheet".to_string(), json!(sheet));
        out.insert("sheet_id".to_string(), json!(c.sheet));
        out.insert("kind".to_string(), serde_json::to_value(c.kind)?);
        if let Some(t) = &c.title {
            out.insert("title".to_string(), json!(t));
        }
        out.insert("range".to_string(), json!(c.range));
        if let Some(series) = &c.series {
            out.insert("series".to_string(), serde_json::to_value(series)?);
        }
        if let Some(colors) = &c.colors {
            out.insert("colors".to_string(), serde_json::to_value(colors)?);
        }
        Ok(Value::Object(out))
    }

    /// `insertChart {sheet?, chart:{kind,title?,range:{from,to},
    /// series?,colors?}}` — create a chart object bound to the resolved
    /// sheet. Always appends with a fresh workbook-unique id; duplicate
    /// specs are allowed.
    pub(super) fn op_insert_chart(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let idx = self.sheet_index(p)?;
        let sheet_id = self.doc.sheets[idx].id;
        let (kind, title, range, series, colors) =
            parse_chart_input(Self::field(p, "chart")?)?;
        if self.doc.charts.len() >= MAX_CHARTS {
            return Err(EngineError::out_of_bounds(format!(
                "chart limit of {MAX_CHARTS} reached"
            )));
        }
        let id = self.doc.next_chart;
        self.doc.next_chart = self
            .doc
            .next_chart
            .checked_add(1)
            .ok_or_else(|| EngineError::validation("chart id space exhausted"))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        let chart = ChartSpec {
            id,
            sheet: sheet_id,
            kind,
            title,
            range,
            series,
            colors,
        };
        self.doc.charts.push(chart.clone());
        Ok(Self::changed(json!({ "chart": self.chart_json(&chart)? })))
    }

    /// `updateChart {id, patch:{…}}` — partial patch over the stored spec;
    /// present keys set, `null` clears `title`/`series`/`colors`, unknown
    /// keys and a `sheet` field alongside `id` reject. An unchanged spec is
    /// eventless.
    pub(super) fn op_update_chart(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "updateChart 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let patch = parse_chart_patch(Self::field(p, "patch")?)?;
        let pos = self
            .doc
            .charts
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no chart {id}")))?;
        let mut next = self.doc.charts[pos].clone();
        if let Some(k) = patch.kind {
            next.kind = k;
        }
        if let Some(t) = patch.title {
            next.title = t;
        }
        if let Some(r) = patch.range {
            next.range = name_ops::canonical_refers_to(r);
        }
        if let Some(s) = patch.series {
            next.series = s;
        }
        if let Some(c) = patch.colors {
            next.colors = c;
        }
        if next == self.doc.charts[pos] {
            return Ok(Self::readonly(json!({
                "chart": self.chart_json(&self.doc.charts[pos].clone())?
            })));
        }
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.charts[pos] = next.clone();
        Ok(Self::changed(json!({ "chart": self.chart_json(&next)? })))
    }

    /// `removeChart {id}` — remove one chart; `sheet` alongside `id`
    /// rejects like the `clear*` mixed-selector precedent.
    pub(super) fn op_remove_chart(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        if p.get("sheet").is_some_and(|v| !v.is_null()) {
            return Err(EngineError::invalid(
                "removeChart 'sheet' is not allowed alongside 'id'",
            ));
        }
        let id = p
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| EngineError::invalid("'id' must be a non-negative integer"))?;
        let pos = self
            .doc
            .charts
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| EngineError::not_found(format!("no chart {id}")))?;
        self.journal.record(UndoEntry::Reset {
            prev: self.doc.clone(),
        });
        self.doc.charts.remove(pos);
        Ok(Self::changed(json!({ "ok": true })))
    }

    /// `listCharts {sheet?}` — silent read; `sheet` absent lists every
    /// chart in the workbook, present filters to that sheet.
    pub(super) fn op_list_charts(&self, p: &Value) -> Result<CommandResult, EngineError> {
        let charts: Vec<&ChartSpec> = match p.get("sheet") {
            None | Some(Value::Null) => self.doc.charts.iter().collect(),
            Some(v) => {
                let idx = self.resolve_sheet(v)?;
                let sheet_id = self.doc.sheets[idx].id;
                self.doc
                    .charts
                    .iter()
                    .filter(|c| c.sheet == sheet_id)
                    .collect()
            }
        };
        let mut out = Vec::with_capacity(charts.len());
        for c in charts {
            out.push(self.chart_json(c)?);
        }
        Ok(Self::readonly(json!({ "charts": out })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::ErrorCode;

    fn apply(e: &mut TallyEngine, op: &str, p: Value) -> CommandResult {
        e.apply(Command::new(op, p)).unwrap()
    }
    fn apply_err(e: &mut TallyEngine, op: &str, p: Value) -> EngineError {
        e.apply(Command::new(op, p)).unwrap_err()
    }
    fn data(e: &mut TallyEngine, op: &str, p: Value) -> Value {
        apply(e, op, p).data
    }
    fn charts(e: &mut TallyEngine) -> Vec<Value> {
        data(e, "listCharts", json!({}))["charts"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
    fn insert(e: &mut TallyEngine, chart: Value) -> Value {
        data(e, "insertChart", json!({"chart":chart}))["chart"].clone()
    }

    #[test]
    fn insert_list_update_remove_roundtrip() {
        let mut e = TallyEngine::new();
        data(&mut e, "setRange", json!({"from":"A1","values":[["1","2"],["3","4"]]}));
        let c = insert(
            &mut e,
            json!({"kind":"column","title":"Sales","range":{"from":"B2","to":"A1"},
                   "series":[{"name":"S1","range":{"from":"A1","to":"A2"}}],
                   "colors":["#FF0000","#00ff00","#FF0000"]}),
        );
        assert_eq!(c["id"], json!(1));
        assert_eq!(c["kind"], json!("column"));
        assert_eq!(c["range"], json!("A1:B2")); // canonicalized
        assert_eq!(c["series"][0]["range"], json!("A1:A2"));
        assert_eq!(c["colors"], json!(["#FF0000","#00ff00"])); // deduped
        assert_eq!(c["sheet"], json!("Sheet1"));
        assert_eq!(c["sheet_id"], json!(0));
        // describe exposes the stored spec.
        let d = data(&mut e, "describe", json!({}));
        assert_eq!(d["charts"].as_array().unwrap().len(), 1);
        assert_eq!(d["charts"][0]["kind"], json!("column"));
        // listCharts sheet filter.
        data(&mut e, "addSheet", json!({"name":"Other"}));
        assert_eq!(charts(&mut e).len(), 1);
        assert_eq!(
            data(&mut e, "listCharts", json!({"sheet":"Other"}))["charts"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            data(&mut e, "listCharts", json!({"sheet":"Sheet1"}))["charts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        // Partial patch: title + colors, kind/range untouched.
        let u = data(
            &mut e,
            "updateChart",
            json!({"id":1,"patch":{"title":"Revenue","colors":null}}),
        );
        assert_eq!(u["chart"]["title"], json!("Revenue"));
        assert!(u["chart"].get("colors").is_none());
        assert_eq!(u["chart"]["kind"], json!("column"));
        // Equal patch is eventless.
        let noop = apply(
            &mut e,
            "updateChart",
            json!({"id":1,"patch":{"title":"Revenue"}}),
        );
        assert!(noop.events.is_empty());
        // Patch kind + range.
        let u = data(
            &mut e,
            "updateChart",
            json!({"id":1,"patch":{"kind":"line","range":{"from":"A1","to":"B2"}}}),
        );
        assert_eq!(u["chart"]["kind"], json!("line"));
        assert_eq!(u["chart"]["range"], json!("A1:B2"));
        // removeChart; unknown id not_found; sheet alongside id rejects.
        assert_eq!(
            apply_err(&mut e, "removeChart", json!({"id":1,"sheet":"Sheet1"})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(&mut e, "updateChart", json!({"id":1,"sheet":0,"patch":{}})).code,
            ErrorCode::InvalidCommand
        );
        assert_eq!(
            apply_err(&mut e, "removeChart", json!({"id":99})).code,
            ErrorCode::NotFound
        );
        let r = data(&mut e, "removeChart", json!({"id":1}));
        assert_eq!(r["ok"], json!(true));
        assert!(charts(&mut e).is_empty());
    }

    #[test]
    fn insert_chart_payload_validation_is_atomic() {
        let mut e = TallyEngine::new();
        let before = e.snapshot().unwrap();
        for (chart, code) in [
            (json!({"kind":"bogus","range":{"from":"A1","to":"A1"}}), ErrorCode::InvalidCommand),
            (json!({"kind":"line"}), ErrorCode::InvalidCommand), // missing range
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"extra":1}), ErrorCode::InvalidCommand),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"title":""}), ErrorCode::Validation),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"title":"x".repeat(513)}), ErrorCode::Validation),
            (json!({"kind":"line","range":{"from":"A1","to":"XFE1"}}), ErrorCode::OutOfBounds),
            (json!({"kind":"line","range":{"from":"A1","to":"A16385"}}), ErrorCode::OutOfBounds),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"colors":["red"]}), ErrorCode::Validation),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"series":[{}]}), ErrorCode::Validation),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"series":[{"name":""}]}), ErrorCode::Validation),
            (json!({"kind":"line","range":{"from":"A1","to":"A1"},"series":[{"range":{"from":"A1","to":"XFE1"}}]}), ErrorCode::OutOfBounds),
        ] {
            assert_eq!(
                apply_err(&mut e, "insertChart", json!({"chart":chart})).code,
                code,
                "{chart}"
            );
            assert_eq!(e.snapshot().unwrap(), before, "{chart} mutated");
        }
        // Bounds: >32 series, >16 colors, >256 charts.
        let many_series: Vec<Value> = (0..33)
            .map(|i| json!({"name":format!("s{i}")}))
            .collect();
        assert_eq!(
            apply_err(
                &mut e,
                "insertChart",
                json!({"chart":{"kind":"line","range":{"from":"A1","to":"A1"},"series":many_series}})
            )
            .code,
            ErrorCode::OutOfBounds
        );
        let many_colors: Vec<Value> = (0..17)
            .map(|i| json!(format!("#{i:06X}")))
            .collect();
        assert_eq!(
            apply_err(
                &mut e,
                "insertChart",
                json!({"chart":{"kind":"line","range":{"from":"A1","to":"A1"},"colors":many_colors}})
            )
            .code,
            ErrorCode::OutOfBounds
        );
        for i in 0..MAX_CHARTS {
            data(
                &mut e,
                "insertChart",
                json!({"chart":{"kind":"line","range":{"from":"A1","to":"A1"},"title":format!("c{i}")}}),
            );
        }
        assert_eq!(
            apply_err(
                &mut e,
                "insertChart",
                json!({"chart":{"kind":"line","range":{"from":"A1","to":"A1"}}})
            )
            .code,
            ErrorCode::OutOfBounds
        );
    }

    #[test]
    fn update_chart_patch_edges() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({"kind":"pie","title":"T","range":{"from":"A1","to":"A1"}}));
        // null clears optionals; kind/range cannot be null; unknown keys reject.
        for (patch, code) in [
            (json!({"kind":null}), ErrorCode::InvalidCommand),
            (json!({"range":null}), ErrorCode::InvalidCommand),
            (json!({"bogus":1}), ErrorCode::InvalidCommand),
            (json!({"title":5}), ErrorCode::Validation),
            (json!({"series":[{"name":"x","extra":1}]}), ErrorCode::InvalidCommand),
        ] {
            assert_eq!(
                apply_err(&mut e, "updateChart", json!({"id":1,"patch":patch})).code,
                code,
                "{patch}"
            );
        }
        let u = data(
            &mut e,
            "updateChart",
            json!({"id":1,"patch":{"title":null,"series":[{"name":"only"}],"colors":["#123456"]}}),
        );
        assert!(u["chart"].get("title").is_none());
        assert_eq!(u["chart"]["series"][0]["name"], json!("only"));
        assert_eq!(u["chart"]["colors"], json!(["#123456"]));
        // Missing patch/id reject.
        assert!(e.apply(Command::new("updateChart", json!({"id":1}))).is_err());
        assert!(e.apply(Command::new("updateChart", json!({"patch":{}}))).is_err());
    }

    #[test]
    fn undo_redo_and_sheet_removal_cascade() {
        let mut e = TallyEngine::new();
        data(&mut e, "addSheet", json!({"name":"Data"}));
        insert(&mut e, json!({"kind":"bar","range":{"from":"A1","to":"A1"}}));
        data(
            &mut e,
            "insertChart",
            json!({"sheet":"Data","chart":{"kind":"area","range":{"from":"B2","to":"B2"},"title":"D"}}),
        );
        assert_eq!(charts(&mut e).len(), 2);
        // Undo the second insert.
        assert!(e.undo().unwrap());
        assert_eq!(charts(&mut e).len(), 1);
        assert!(e.redo().unwrap());
        assert_eq!(charts(&mut e).len(), 2);
        // Removing Data cascade-drops its chart into the same undo entry.
        data(&mut e, "removeSheet", json!({"sheet":"Data"}));
        assert_eq!(charts(&mut e).len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(charts(&mut e).len(), 2);
        assert!(charts(&mut e).iter().any(|c| c["sheet_id"] == json!(1)));
        assert!(e.redo().unwrap());
        assert_eq!(charts(&mut e).len(), 1);
        // Undoing addSheet drops rules bound to the added sheet too.
        let mut e2 = TallyEngine::new();
        data(&mut e2, "addSheet", json!({"name":"Temp"}));
        data(
            &mut e2,
            "insertChart",
            json!({"sheet":"Temp","chart":{"kind":"line","range":{"from":"A1","to":"A1"}}}),
        );
        assert!(e2.undo().unwrap()); // undo insertChart
        assert!(e2.undo().unwrap()); // undo addSheet
        assert!(charts(&mut e2).is_empty());
    }

    #[test]
    fn hostile_restore_validates_charts() {
        let mut e = TallyEngine::new();
        insert(&mut e, json!({"kind":"line","range":{"from":"A1","to":"A2"},"title":"ok"}));
        insert(&mut e, json!({"kind":"bar","range":{"from":"B1","to":"B2"}}));
        let snap = e.snapshot().unwrap();
        // Round-trip preserves the spec (schema:5 wrapper).
        let mut e2 = TallyEngine::new();
        e2.restore(&snap).unwrap();
        let d = data(&mut e2, "describe", json!({}));
        assert_eq!(d["charts"].as_array().unwrap()[0]["title"], json!("ok"));
        // Crafted payloads fail closed and atomically.
        let doc = data(&mut e, "describe", json!({}));
        let before = describe_snapshot(&mut e);
        let mutates: Vec<Box<dyn Fn(&mut Value)>> = vec![
            // duplicate id
            Box::new(|d| d["charts"][1]["id"] = json!(1)),
            // missing sheet
            Box::new(|d| d["charts"][0]["sheet"] = json!(99)),
            // unparseable range
            Box::new(|d| d["charts"][0]["range"] = json!("not-a-range")),
            // over-cap range
            Box::new(|d| d["charts"][0]["range"] = json!("A1:XFD1048576")),
            // bad color
            Box::new(|d| d["charts"][0]["colors"] = json!(["red"])),
            // unknown spec field (deny_unknown_fields)
            Box::new(|d| d["charts"][0]["deferred"] = json!(true)),
            // empty series entry
            Box::new(|d| d["charts"][0]["series"] = json!([{}])),
            // over-cap series count
            Box::new(|d| {
                d["charts"][0]["series"] = json!(
                    (0..33).map(|i| json!({"name":format!("s{i}")})).collect::<Vec<_>>()
                )
            }),
        ];
        for mutate in mutates {
            let mut bad = doc.clone();
            mutate(&mut bad);
            let wrapped = json!({"kind":"tally","schema":5,"document":bad});
            assert!(
                e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap())).is_err()
            );
            assert_eq!(describe_snapshot(&mut e), before);
        }
        // next_chart repair: id space below max+1 is bumped.
        let mut repaired = doc.clone();
        repaired["next_chart"] = json!(1);
        let wrapped = json!({"kind":"tally","schema":5,"document":repaired});
        e.restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .unwrap();
        let d = data(&mut e, "describe", json!({}));
        assert!(d["next_chart"].as_u64().unwrap() > 1);
    }

    fn describe_snapshot(e: &mut TallyEngine) -> Value {
        data(e, "describe", json!({}))
    }
}
