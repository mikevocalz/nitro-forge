//! Embedded chart and table objects (P14 slice 10).
//!
//! DATA ONLY — HONESTY BOUNDARY: the engine stores bounded structured data
//! plus ordinary object geometry for `kind:"chart"` and `kind:"table"`
//! slide objects. It never renders charts or tables, never evaluates
//! series, and never resolves cell formulas — hosts own all rendering.
//! The chart contract mirrors the pinned NYC-Tron `SheetChartSpec`/
//! `SheetChartSeries` shape minus the spreadsheet-source fields
//! (`range`/`seriesIn`/`hasHeader`/`hasXValues`): slide charts carry their
//! series inline instead of referencing a sheet range. `kind` is the
//! NYC-Tron `SheetChartKind` catalog (`line|column|area` — the kinds
//! `@nyc-tron/native-charts` renders). The table contract is the bounded
//! subset of the NYC-Tron `VirtualSpreadsheetGrid`/`TableLayoutInspector`
//! pair: dimensions plus sparse cell values; per-cell layout (spans,
//! alignment, borders, fills) and formulas are deferred — see
//! docs/ENGINE_OPS.md.
//!
//! Objects have real bounds like media objects: move/resize/rotate apply,
//! `removeObject` cascades normally, and animations may target them.
//! `chart`/`table` spec fields are present iff the object kind matches
//! (enforced by the ops and by restore), and chart/table objects carry no
//! text/fill/src/stroke/connector/media payloads — the same content-field
//! rule media objects follow.

use super::*;
use std::collections::BTreeSet;

/// Bounded chart catalog mirroring NYC-Tron `SheetChartKind`
/// (`SHEET_CHART_KINDS`): the kinds `@nyc-tron/native-charts` renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartKind {
    Line,
    Column,
    Area,
}

impl ChartKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "line" => Some(Self::Line),
            "column" => Some(Self::Column),
            "area" => Some(Self::Area),
            _ => None,
        }
    }
}

/// One chart sample point in data units (NYC-Tron
/// `SheetChartSeries.points` element). `x`/`y` are finite and within
/// ±MAX_CHART_VALUE.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ChartPoint {
    pub x: f64,
    pub y: f64,
}

/// One named series (NYC-Tron `SheetChartSeries`): `id` is the stable
/// series identity hosts key legends/colors on, `label` the display name,
/// `points` the embedded samples. Ids are unique within a spec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChartSeries {
    pub id: String,
    pub label: String,
    pub points: Vec<ChartPoint>,
}

/// Stored chart payload on `Obj.chart` (present iff `kind == Chart`).
/// `title`/`x_axis_label`/`y_axis_label` mirror `SheetChartSpec`'s
/// optional text fields; `show_legend`/`show_data_labels` cover the
/// boolean half of NYC-Tron's `ChartPresentation` (number formats and
/// per-series colors are deferred — hosts own palettes). `series` is the
/// embedded bounded data: no sheet range, no formulas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChartSpec {
    pub kind: ChartKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x_axis_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y_axis_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_legend: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_data_labels: Option<bool>,
    pub series: Vec<ChartSeries>,
}

/// Bounded table cell value: the computed-value subset of the NYC-Tron
/// spreadsheet cell contract (`string | number | boolean`; null/blank
/// cells are simply absent from `cells`). Untagged so snapshots read as
/// plain JSON strings/numbers/booleans.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TableCellValue {
    Text(String),
    Number(f64),
    Flag(bool),
}

/// One sparse table cell: `row`/`col` are 0-based indices within the
/// spec's `rows`/`cols` dimensions; absent cells render empty. Cell
/// (row, col) pairs are unique within a spec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableCell {
    pub row: u32,
    pub col: u32,
    pub value: TableCellValue,
}

/// Stored table payload on `Obj.table` (present iff `kind == Table`).
/// `rows`/`cols` are the grid dimensions; `cells` is the sparse set of
/// non-empty cells. Per-cell layout (row/col spans, alignment, padding,
/// borders, fills — the NYC-Tron `TableCellLayout` contract) and formula
/// evaluation are deferred; the engine stores values as data only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableSpec {
    pub rows: u32,
    pub cols: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cells: Vec<TableCell>,
}

/// Chart bounds. Series/points mirror the NYC-Tron `MAX_CHART_CELLS`
/// budget (4096 cells per chart source) tightened for embedded storage:
/// at most 32 series, 1024 points per series and 4096 points total.
const MAX_CHART_SERIES: usize = 32;
const MAX_CHART_POINTS_PER_SERIES: usize = 1_024;
const MAX_CHART_POINTS_TOTAL: usize = 4_096;
/// Chart text fields (title/axis labels/series labels) are bounded
/// non-blank strings; series ids are shorter bounded identities.
const MAX_CHART_LABEL_BYTES: usize = 128;
const MAX_CHART_SERIES_ID_BYTES: usize = 64;
/// Point coordinates are data values, not geometry: finite within
/// ±1e12 keeps hostile restores and extreme exponents out of the model.
const MAX_CHART_VALUE: f64 = 1e12;
/// Table bounds: a slide table stays small; sparse cells cap total stored
/// values independently of the (already bounded) grid dimensions.
const MAX_TABLE_ROWS: u32 = 100;
const MAX_TABLE_COLS: u32 = 26;
const MAX_TABLE_CELLS: usize = 1_024;
/// Table text cells are bounded non-empty strings; numbers share the
/// chart value bound.
const MAX_TABLE_TEXT_BYTES: usize = 128;

fn chart_value(v: f64, what: &str) -> Result<f64, EngineError> {
    if !v.is_finite() || v.abs() > MAX_CHART_VALUE {
        return Err(EngineError::validation(format!(
            "{what} must be finite and within ±{MAX_CHART_VALUE}"
        )));
    }
    Ok(v)
}

fn bounded_label(v: &Value, max: usize, what: &str) -> Result<String, EngineError> {
    let s = v
        .as_str()
        .ok_or_else(|| EngineError::invalid(format!("{what} must be a string")))?;
    if s.trim().is_empty() || s.len() > max {
        return Err(EngineError::validation(format!(
            "{what} must be non-blank and <= {max} UTF-8 bytes"
        )));
    }
    Ok(s.to_string())
}

/// Optional bounded label payload field: absent or `null` clears to None.
fn opt_label(p: &Value, key: &str) -> Result<Option<String>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => bounded_label(v, MAX_CHART_LABEL_BYTES, &format!("chart {key}")).map(Some),
    }
}

/// Optional strict-boolean presentation flag: absent or `null` clears.
fn opt_bool(p: &Value, key: &str) -> Result<Option<bool>, EngineError> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_bool()
            .map(Some)
            .ok_or_else(|| EngineError::invalid(format!("chart {key} must be a boolean"))),
    }
}

fn parse_chart_point(v: &Value) -> Result<ChartPoint, EngineError> {
    Ok(ChartPoint {
        x: chart_value(req_f64(v, "x")?, "chart point x")?,
        y: chart_value(req_f64(v, "y")?, "chart point y")?,
    })
}

fn parse_chart_series(v: &Value) -> Result<ChartSeries, EngineError> {
    let id = bounded_label(field(v, "id")?, MAX_CHART_SERIES_ID_BYTES, "chart series id")?;
    let points_v = field(v, "points")?
        .as_array()
        .ok_or_else(|| EngineError::invalid("chart series points must be an array"))?;
    if points_v.is_empty() || points_v.len() > MAX_CHART_POINTS_PER_SERIES {
        return Err(EngineError::validation(format!(
            "chart series needs 1..={MAX_CHART_POINTS_PER_SERIES} points"
        )));
    }
    let mut points = Vec::with_capacity(points_v.len());
    for point in points_v {
        points.push(parse_chart_point(point)?);
    }
    Ok(ChartSeries {
        id,
        label: bounded_label(field(v, "label")?, MAX_CHART_LABEL_BYTES, "chart series label")?,
        points,
    })
}

fn parse_chart_series_array(v: &Value) -> Result<Vec<ChartSeries>, EngineError> {
    let arr = v
        .as_array()
        .ok_or_else(|| EngineError::invalid("chart series must be an array"))?;
    if arr.is_empty() || arr.len() > MAX_CHART_SERIES {
        return Err(EngineError::validation(format!(
            "chart needs 1..={MAX_CHART_SERIES} series"
        )));
    }
    let mut series = Vec::with_capacity(arr.len());
    for s in arr {
        series.push(parse_chart_series(s)?);
    }
    Ok(series)
}

/// Parse a complete chart spec from the `chart` payload object: `kind`
/// and `series` are required; text/flag fields are optional.
fn parse_chart_spec(v: &Value) -> Result<ChartSpec, EngineError> {
    let spec = ChartSpec {
        kind: ChartKind::parse(req_str(v, "kind")?).ok_or_else(|| {
            EngineError::validation("chart kind must be \"line\"|\"column\"|\"area\"")
        })?,
        title: opt_label(v, "title")?,
        x_axis_label: opt_label(v, "x_axis_label")?,
        y_axis_label: opt_label(v, "y_axis_label")?,
        show_legend: opt_bool(v, "show_legend")?,
        show_data_labels: opt_bool(v, "show_data_labels")?,
        series: parse_chart_series_array(field(v, "series")?)?,
    };
    check_chart_spec(&spec)?;
    Ok(spec)
}

/// Structural check shared by ops (validation errors, run on the merged
/// candidate) and restore (mapped to serialization errors): series count,
/// per-series point count, total point budget, label/id bounds, unique
/// series ids and point coordinate bounds.
fn check_chart_spec(spec: &ChartSpec) -> Result<(), EngineError> {
    if spec.series.is_empty() || spec.series.len() > MAX_CHART_SERIES {
        return Err(EngineError::validation(format!(
            "chart needs 1..={MAX_CHART_SERIES} series"
        )));
    }
    let mut ids = BTreeSet::new();
    let mut total = 0usize;
    for series in &spec.series {
        if series.id.trim().is_empty() || series.id.len() > MAX_CHART_SERIES_ID_BYTES {
            return Err(EngineError::validation(format!(
                "chart series id must be non-blank and <= {MAX_CHART_SERIES_ID_BYTES} UTF-8 bytes"
            )));
        }
        if !ids.insert(series.id.as_str()) {
            return Err(EngineError::validation("chart series ids must be unique"));
        }
        if series.label.trim().is_empty() || series.label.len() > MAX_CHART_LABEL_BYTES {
            return Err(EngineError::validation(format!(
                "chart series label must be non-blank and <= {MAX_CHART_LABEL_BYTES} UTF-8 bytes"
            )));
        }
        if series.points.is_empty() || series.points.len() > MAX_CHART_POINTS_PER_SERIES {
            return Err(EngineError::validation(format!(
                "chart series needs 1..={MAX_CHART_POINTS_PER_SERIES} points"
            )));
        }
        total += series.points.len();
        if total > MAX_CHART_POINTS_TOTAL {
            return Err(EngineError::validation(format!(
                "chart points exceed {MAX_CHART_POINTS_TOTAL} total"
            )));
        }
        for point in &series.points {
            chart_value(point.x, "chart point x")?;
            chart_value(point.y, "chart point y")?;
        }
    }
    for label in [&spec.title, &spec.x_axis_label, &spec.y_axis_label]
        .into_iter()
        .flatten()
    {
        if label.trim().is_empty() || label.len() > MAX_CHART_LABEL_BYTES {
            return Err(EngineError::validation(format!(
                "chart labels must be non-blank and <= {MAX_CHART_LABEL_BYTES} UTF-8 bytes"
            )));
        }
    }
    Ok(())
}

/// Optional bounded cell text: present values must be non-blank
/// <=MAX_TABLE_TEXT_BYTES UTF-8 bytes.
fn bounded_cell_text(s: &str) -> Result<String, EngineError> {
    if s.trim().is_empty() || s.len() > MAX_TABLE_TEXT_BYTES {
        return Err(EngineError::validation(format!(
            "table cell text must be non-blank and <= {MAX_TABLE_TEXT_BYTES} UTF-8 bytes"
        )));
    }
    Ok(s.to_string())
}

fn check_table_cell_value(value: &TableCellValue) -> Result<(), EngineError> {
    match value {
        TableCellValue::Text(s) => {
            bounded_cell_text(s)?;
        }
        TableCellValue::Number(n) => {
            chart_value(*n, "table cell number")?;
        }
        TableCellValue::Flag(_) => {}
    }
    Ok(())
}

fn parse_table_cell(v: &Value) -> Result<TableCell, EngineError> {
    let row = req_u64(v, "row")?;
    let col = req_u64(v, "col")?;
    let row = u32::try_from(row)
        .map_err(|_| EngineError::out_of_bounds("table cell row is too large"))?;
    let col = u32::try_from(col)
        .map_err(|_| EngineError::out_of_bounds("table cell col is too large"))?;
    let value = match field(v, "value")? {
        Value::String(s) => TableCellValue::Text(bounded_cell_text(s)?),
        Value::Number(n) => {
            let f = n
                .as_f64()
                .ok_or_else(|| EngineError::invalid("table cell number must be numeric"))?;
            TableCellValue::Number(chart_value(f, "table cell number")?)
        }
        Value::Bool(b) => TableCellValue::Flag(*b),
        _ => {
            return Err(EngineError::invalid(
                "table cell value must be a string, number or boolean",
            ))
        }
    };
    Ok(TableCell { row, col, value })
}

/// Parse a complete table spec from the `table` payload object: `rows`
/// and `cols` are required; `cells` defaults to empty.
fn parse_table_spec(v: &Value) -> Result<TableSpec, EngineError> {
    let rows = req_u64(v, "rows")?;
    let cols = req_u64(v, "cols")?;
    let rows = u32::try_from(rows)
        .map_err(|_| EngineError::out_of_bounds("table rows is too large"))?;
    let cols = u32::try_from(cols)
        .map_err(|_| EngineError::out_of_bounds("table cols is too large"))?;
    let cells = match v.get("cells") {
        None | Some(Value::Null) => Vec::new(),
        Some(cells) => {
            let arr = cells
                .as_array()
                .ok_or_else(|| EngineError::invalid("table cells must be an array"))?;
            if arr.len() > MAX_TABLE_CELLS {
                return Err(EngineError::validation(format!(
                    "table cells exceed {MAX_TABLE_CELLS}"
                )));
            }
            let mut parsed = Vec::with_capacity(arr.len());
            for cell in arr {
                parsed.push(parse_table_cell(cell)?);
            }
            parsed
        }
    };
    let spec = TableSpec { rows, cols, cells };
    check_table_spec(&spec)?;
    Ok(spec)
}

/// Structural check shared by ops and restore: dimensions within bounds,
/// cell count cap, every cell inside the grid, unique (row, col) pairs and
/// bounded cell values.
pub(super) fn check_table_spec(spec: &TableSpec) -> Result<(), EngineError> {
    if spec.rows == 0 || spec.rows > MAX_TABLE_ROWS {
        return Err(EngineError::validation(format!(
            "table rows must be within 1..={MAX_TABLE_ROWS}"
        )));
    }
    if spec.cols == 0 || spec.cols > MAX_TABLE_COLS {
        return Err(EngineError::validation(format!(
            "table cols must be within 1..={MAX_TABLE_COLS}"
        )));
    }
    if spec.cells.len() > MAX_TABLE_CELLS {
        return Err(EngineError::validation(format!(
            "table cells exceed {MAX_TABLE_CELLS}"
        )));
    }
    let mut seen = BTreeSet::new();
    for cell in &spec.cells {
        if cell.row >= spec.rows || cell.col >= spec.cols {
            return Err(EngineError::validation(
                "table cell is outside the grid dimensions",
            ));
        }
        if !seen.insert((cell.row, cell.col)) {
            return Err(EngineError::validation("duplicate table cell"));
        }
        check_table_cell_value(&cell.value)?;
    }
    Ok(())
}

pub(super) fn check_chart_spec_restore(spec: &ChartSpec) -> Result<(), EngineError> {
    check_chart_spec(spec)
        .map_err(|_| EngineError::serialization("invalid chart spec"))
}

fn slide_index(next: &PitchState, id: u64) -> Result<usize, EngineError> {
    next.slides
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no slide with id {id}")))
}

fn object_index(slide: &Slide, id: u64) -> Result<usize, EngineError> {
    slide
        .objects
        .iter()
        .position(|o| o.id == id)
        .ok_or_else(|| EngineError::not_found(format!("no object with id {id} on slide")))
}

/// Mirror of `PitchEngine::preflight_object`: 4096 objects per slide plus
/// the shared safe-identity bound before allocating from `next_id`.
fn preflight_object(next: &PitchState, slide: usize) -> Result<(), EngineError> {
    if next.slides[slide].objects.len() >= 4096 {
        return Err(EngineError::validation("object capacity exceeds 4096"));
    }
    if next.next_id == 0 || next.next_id >= 9_007_199_254_740_991 {
        return Err(EngineError::validation("safe identity capacity exhausted"));
    }
    Ok(())
}

fn alloc_id(next: &mut PitchState) -> u64 {
    let id = next.next_id;
    next.next_id += 1;
    id
}

fn geometry(p: &Value) -> Result<(f64, f64, f64, f64), EngineError> {
    let (x, y, w, h) = (req_f64(p, "x")?, req_f64(p, "y")?, req_f64(p, "w")?, req_f64(p, "h")?);
    // Chart/table objects have real bounds (like media): positive w/h.
    if !(w.is_finite() && w > 0.0) || !(h.is_finite() && h > 0.0) {
        return Err(EngineError::validation("'w' and 'h' must be > 0"));
    }
    Ok((x, y, w, h))
}

fn blank_obj(id: u64, kind: ObjKind, x: f64, y: f64, w: f64, h: f64) -> Obj {
    Obj {
        id,
        kind,
        x,
        y,
        w,
        h,
        rotation_deg: 0.0,
        text: None,
        fill: None,
        stroke: None,
        connector: None,
        media: None,
        chart: None,
        table: None,
        morph_name: None,
        placeholder_id: None,
        src: None,
    }
}

/// `updateChart` patch: every spec field is optional inside `chart`;
/// `series` replaces the whole series array when present, text/flag
/// fields set on a non-null value and clear on explicit null, `kind`
/// replaces the chart kind (null invalid).
fn patch_chart(spec: &mut ChartSpec, p: &Value) -> Result<(), EngineError> {
    if p.get("kind").is_some() {
        spec.kind = ChartKind::parse(req_str(p, "kind")?).ok_or_else(|| {
            EngineError::validation("chart kind must be \"line\"|\"column\"|\"area\"")
        })?;
    }
    if p.get("title").is_some() {
        spec.title = opt_label(p, "title")?;
    }
    if p.get("x_axis_label").is_some() {
        spec.x_axis_label = opt_label(p, "x_axis_label")?;
    }
    if p.get("y_axis_label").is_some() {
        spec.y_axis_label = opt_label(p, "y_axis_label")?;
    }
    if p.get("show_legend").is_some() {
        spec.show_legend = opt_bool(p, "show_legend")?;
    }
    if p.get("show_data_labels").is_some() {
        spec.show_data_labels = opt_bool(p, "show_data_labels")?;
    }
    if p.get("series").is_some() {
        // Reuse the add-path parser so patched series get identical bounds.
        spec.series = parse_chart_series_array(field(p, "series")?)?;
    }
    Ok(())
}

/// `updateTable` patch: `rows`/`cols` replace the dimensions and `cells`
/// replaces the sparse cell set; the merged spec is re-validated so cells
/// cannot survive outside shrunk dimensions.
fn patch_table(spec: &mut TableSpec, p: &Value) -> Result<(), EngineError> {
    if p.get("rows").is_some() {
        let rows = req_u64(p, "rows")?;
        spec.rows = u32::try_from(rows)
            .map_err(|_| EngineError::out_of_bounds("table rows is too large"))?;
    }
    if p.get("cols").is_some() {
        let cols = req_u64(p, "cols")?;
        spec.cols = u32::try_from(cols)
            .map_err(|_| EngineError::out_of_bounds("table cols is too large"))?;
    }
    if p.get("cells").is_some() {
        spec.cells = match field(p, "cells")? {
            Value::Null => Vec::new(),
            v => {
                let arr = v
                    .as_array()
                    .ok_or_else(|| EngineError::invalid("table cells must be an array"))?;
                if arr.len() > MAX_TABLE_CELLS {
                    return Err(EngineError::validation(format!(
                        "table cells exceed {MAX_TABLE_CELLS}"
                    )));
                }
                let mut parsed = Vec::with_capacity(arr.len());
                for cell in arr {
                    parsed.push(parse_table_cell(cell)?);
                }
                parsed
            }
        };
    }
    Ok(())
}

pub(super) fn apply(engine: &mut PitchEngine, cmd: &Command) -> Result<CommandResult, EngineError> {
    let p = &cmd.payload;
    let mut next = engine.state.clone();
    let mut data = json!({"ok":true});
    match cmd.op.as_str() {
        "addChart" | "addTable" => {
            let is_chart = cmd.op == "addChart";
            let slide = slide_index(&next, req_u64(p, "slide")?)?;
            let (x, y, w, h) = geometry(p)?;
            let kind = if is_chart { ObjKind::Chart } else { ObjKind::Table };
            let spec_value = field(p, if is_chart { "chart" } else { "table" })?;
            preflight_object(&next, slide)?;
            let id = alloc_id(&mut next);
            let mut object = blank_obj(id, kind, x, y, w, h);
            if is_chart {
                object.chart = Some(parse_chart_spec(spec_value)?);
            } else {
                object.table = Some(parse_table_spec(spec_value)?);
            }
            next.slides[slide].objects.push(object);
            data = json!({"object_id":id});
        }
        "updateChart" => {
            let slide = slide_index(&next, req_u64(p, "slide")?)?;
            let oi = object_index(&next.slides[slide], req_u64(p, "id")?)?;
            let original = next.slides[slide].objects[oi]
                .chart
                .clone()
                .ok_or_else(|| {
                    EngineError::validation("updateChart requires a chart object")
                })?;
            let mut spec = original.clone();
            patch_chart(&mut spec, field(p, "chart")?)?;
            check_chart_spec(&spec)?;
            if spec == original {
                return Ok(ro(data));
            }
            next.slides[slide].objects[oi].chart = Some(spec);
        }
        "updateTable" => {
            let slide = slide_index(&next, req_u64(p, "slide")?)?;
            let oi = object_index(&next.slides[slide], req_u64(p, "id")?)?;
            let original = next.slides[slide].objects[oi]
                .table
                .clone()
                .ok_or_else(|| {
                    EngineError::validation("updateTable requires a table object")
                })?;
            let mut spec = original.clone();
            patch_table(&mut spec, field(p, "table")?)?;
            check_table_spec(&spec)?;
            if spec == original {
                return Ok(ro(data));
            }
            next.slides[slide].objects[oi].table = Some(spec);
        }
        _ => return Err(EngineError::unsupported("unknown chart/table operation")),
    }
    if next == engine.state {
        return Ok(ro(data));
    }
    engine.journal.record(engine.state.clone());
    engine.state = next;
    Ok(CommandResult::data(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ignition_core::decode_envelope;
    use serde_json::json;

    fn apply(e: &mut PitchEngine, op: &str, payload: Value) -> Value {
        e.apply(Command::new(op, payload)).expect(op).data
    }

    fn apply_err(e: &mut PitchEngine, op: &str, payload: Value) -> EngineError {
        e.apply(Command::new(op, payload)).unwrap_err()
    }

    fn slide(e: &mut PitchEngine) -> u64 {
        e.state.slides[0].id
    }

    fn chart_payload() -> Value {
        json!({
            "kind": "column",
            "title": "Revenue",
            "x_axis_label": "Quarter",
            "series": [
                {"id": "s1", "label": "2025", "points": [{"x": 1, "y": 10}, {"x": 2, "y": 20}]},
                {"id": "s2", "label": "2026", "points": [{"x": 1, "y": 15}, {"x": 2, "y": 25}]}
            ]
        })
    }

    fn table_payload() -> Value {
        json!({
            "rows": 3,
            "cols": 2,
            "cells": [
                {"row": 0, "col": 0, "value": "Name"},
                {"row": 0, "col": 1, "value": "Score"},
                {"row": 1, "col": 1, "value": 42.5},
                {"row": 2, "col": 0, "value": true}
            ]
        })
    }

    #[test]
    fn add_chart_stores_embedded_spec_and_round_trips_schema7() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        apply(
            &mut e,
            "addChart",
            json!({"slide": s, "x": 10, "y": 20, "w": 400, "h": 300, "chart": chart_payload()}),
        );
        let object = &e.state.slides[0].objects[0];
        assert_eq!(object.kind, ObjKind::Chart);
        let chart_spec = object.chart.clone();
        let spec = chart_spec.as_ref().unwrap();
        assert_eq!(spec.kind, ChartKind::Column);
        assert_eq!(spec.title.as_deref(), Some("Revenue"));
        assert_eq!(spec.series.len(), 2);
        assert_eq!(spec.series[0].points[1].y, 20.0);

        // describe exposes the stored spec as data.
        let described = apply(&mut e, "describe", json!({}));
        assert_eq!(described["slides"][0]["objects"][0]["kind"], "chart");
        assert_eq!(described["slides"][0]["objects"][0]["chart"]["series"][1]["label"], "2026");

        // Chart objects force the schema:7 wrapper; a fresh engine
        // round-trips the exact bytes.
        let bytes = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&bytes).unwrap();
        let wrapped: Value = serde_json::from_slice(payload).unwrap();
        assert_eq!(wrapped["schema"], json!(7));
        let mut re = PitchEngine::new();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);
        assert_eq!(re.state.slides[0].objects[0].chart, chart_spec);
    }

    #[test]
    fn update_chart_patches_fields_and_is_eventless_when_equal() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        let id = apply(
            &mut e,
            "addChart",
            json!({"slide": s, "x": 0, "y": 0, "w": 100, "h": 100, "chart": chart_payload()}),
        )["object_id"]
            .as_u64()
            .unwrap();
        let before = e.snapshot().unwrap();

        // Equal patch: no events, no history, snapshot unchanged.
        let result = e
            .apply(Command::new(
                "updateChart",
                json!({"slide": s, "id": id, "chart": chart_payload()}),
            ))
            .unwrap();
        assert!(result.events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);

        // Partial patch: rename title, switch kind, replace series.
        apply(
            &mut e,
            "updateChart",
            json!({"slide": s, "id": id, "chart": {
                "kind": "line",
                "title": "Costs",
                "show_legend": true,
                "series": [{"id": "s9", "label": "Total", "points": [{"x": 0, "y": -3.5}]}]
            }}),
        );
        let spec = &e.state.slides[0].objects[0].chart;
        let spec = spec.as_ref().unwrap();
        assert_eq!(spec.kind, ChartKind::Line);
        assert_eq!(spec.title.as_deref(), Some("Costs"));
        assert_eq!(spec.x_axis_label.as_deref(), Some("Quarter"));
        assert_eq!(spec.show_legend, Some(true));
        assert_eq!(spec.series.len(), 1);
        assert_eq!(spec.series[0].points[0].y, -3.5);

        // Explicit null clears an optional field.
        apply(
            &mut e,
            "updateChart",
            json!({"slide": s, "id": id, "chart": {"title": null, "show_legend": null}}),
        );
        let spec = e.state.slides[0].objects[0].chart.as_ref().unwrap();
        assert!(spec.title.is_none());
        assert!(spec.show_legend.is_none());

        // Undo restores the original spec; redo reapplies the last patches.
        assert!(e.undo().unwrap());
        assert!(e.undo().unwrap());
        let spec = e.state.slides[0].objects[0].chart.as_ref().unwrap();
        assert_eq!(spec.title.as_deref(), Some("Revenue"));
        assert_eq!(spec.kind, ChartKind::Column);
        assert!(e.redo().unwrap());
        assert!(e.redo().unwrap());
        let spec = e.state.slides[0].objects[0].chart.as_ref().unwrap();
        assert!(spec.title.is_none());
        assert_eq!(spec.series[0].id, "s9");
    }

    #[test]
    fn chart_payload_bounds_and_kind_gates_reject_atomically() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        let text = apply(
            &mut e,
            "addText",
            json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "text": "hi"}),
        )["object_id"]
            .as_u64()
            .unwrap();
        let before = e.snapshot().unwrap();

        // Bad chart kind, missing series, empty points, dup series ids,
        // over-bound labels and non-finite/out-of-range points all reject
        // before any mutation.
        for chart in [
            json!({"kind": "pie", "series": [{"id": "a", "label": "A", "points": [{"x": 1, "y": 1}]}]}),
            json!({"kind": "line"}),
            json!({"kind": "line", "series": []}),
            json!({"kind": "line", "series": [{"id": "a", "label": "A", "points": []}]}),
            json!({"kind": "line", "series": [
                {"id": "a", "label": "A", "points": [{"x": 1, "y": 1}]},
                {"id": "a", "label": "B", "points": [{"x": 1, "y": 2}]}
            ]}),
            json!({"kind": "line", "title": "  ", "series": [{"id": "a", "label": "A", "points": [{"x": 1, "y": 1}]}]}),
            json!({"kind": "line", "series": [{"id": "a", "label": "A", "points": [{"x": 1e13, "y": 1}]}]}),
            json!({"kind": "line", "series": [{"id": "a", "label": "A", "points": [{"x": 1, "y": "NaN"}]}]}),
        ] {
            assert!(
                e.apply(Command::new(
                    "addChart",
                    json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "chart": chart})
                ))
                .is_err(),
                "chart payload must reject: {chart}"
            );
        }
        // Series count cap.
        let many = json!({"kind": "line", "series": (0..33).map(|i| json!({
            "id": format!("s{i}"), "label": format!("S{i}"),
            "points": [{"x": 1, "y": 1}]
        })).collect::<Vec<_>>()});
        assert!(e
            .apply(Command::new(
                "addChart",
                json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "chart": many})
            ))
            .is_err());
        // updateChart on a non-chart object rejects; geometry must be positive.
        assert!(e
            .apply(Command::new(
                "updateChart",
                json!({"slide": s, "id": text, "chart": chart_payload()})
            ))
            .is_err());
        assert!(e
            .apply(Command::new(
                "addChart",
                json!({"slide": s, "x": 0, "y": 0, "w": 0, "h": 10, "chart": chart_payload()})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }

    #[test]
    fn add_table_stores_sparse_cells_and_patches() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        let id = apply(
            &mut e,
            "addTable",
            json!({"slide": s, "x": 5, "y": 5, "w": 300, "h": 200, "table": table_payload()}),
        )["object_id"]
            .as_u64()
            .unwrap();
        let object = &e.state.slides[0].objects[0];
        assert_eq!(object.kind, ObjKind::Table);
        let spec = object.table.as_ref().unwrap();
        assert_eq!((spec.rows, spec.cols), (3, 2));
        assert_eq!(spec.cells.len(), 4);
        assert_eq!(spec.cells[2].value, TableCellValue::Number(42.5));
        assert_eq!(spec.cells[3].value, TableCellValue::Flag(true));

        let bytes = e.snapshot().unwrap();
        let mut re = PitchEngine::new();
        re.restore(&bytes).unwrap();
        assert_eq!(re.snapshot().unwrap(), bytes);

        // Patch dims + cells; shrinking dims with stray cells rejects.
        apply(
            &mut e,
            "updateTable",
            json!({"slide": s, "id": id, "table": {"rows": 2, "cols": 3, "cells": [
                {"row": 1, "col": 2, "value": "new"}
            ]}}),
        );
        let spec = e.state.slides[0].objects[0].table.as_ref().unwrap();
        assert_eq!((spec.rows, spec.cols), (2, 3));
        assert_eq!(spec.cells.len(), 1);
        let before = e.snapshot().unwrap();
        assert!(e
            .apply(Command::new(
                "updateTable",
                json!({"slide": s, "id": id, "table": {"rows": 1}})
            ))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), before);

        // Equal patch is an eventless no-op.
        let result = e
            .apply(Command::new(
                "updateTable",
                json!({"slide": s, "id": id, "table": {"rows": 2, "cols": 3, "cells": [
                    {"row": 1, "col": 2, "value": "new"}
                ]}}),
            ))
            .unwrap();
        assert!(result.events.is_empty());
        assert!(e.undo().unwrap());
        let spec = e.state.slides[0].objects[0].table.as_ref().unwrap();
        assert_eq!((spec.rows, spec.cols), (3, 2));
        assert_eq!(spec.cells.len(), 4);
    }

    #[test]
    fn table_cell_bounds_and_duplicate_cells_reject() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        for table in [
            json!({"rows": 0, "cols": 2}),
            json!({"rows": 101, "cols": 2}),
            json!({"rows": 2, "cols": 0}),
            json!({"rows": 2, "cols": 27}),
            json!({"rows": 2, "cols": 2, "cells": [{"row": 2, "col": 0, "value": "x"}]}),
            json!({"rows": 2, "cols": 2, "cells": [
                {"row": 0, "col": 0, "value": "a"},
                {"row": 0, "col": 0, "value": "b"}
            ]}),
            json!({"rows": 2, "cols": 2, "cells": [{"row": 0, "col": 0, "value": null}]}),
            json!({"rows": 2, "cols": 2, "cells": [{"row": 0, "col": 0, "value": {"nested": true}}]}),
            json!({"rows": 2, "cols": 2, "cells": [{"row": 0, "col": 0, "value": "  "}]}),
            json!({"rows": 2, "cols": 2, "cells": [{"row": 0, "col": 0, "value": 1e13}]}),
        ] {
            assert!(
                e.apply(Command::new(
                    "addTable",
                    json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "table": table})
                ))
                .is_err(),
                "table payload must reject: {table}"
            );
        }
        // Cells cap: 1025 sparse cells reject even inside 100x26 dims.
        let cells: Vec<Value> = (0..1025)
            .map(|i| json!({"row": i / 26, "col": i % 26, "value": i}))
            .collect();
        assert!(e
            .apply(Command::new(
                "addTable",
                json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10,
                    "table": {"rows": 40, "cols": 26, "cells": cells}})
            ))
            .is_err());
    }

    #[test]
    fn chart_and_table_objects_move_resize_rotate_and_die_with_slide() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        let chart = apply(
            &mut e,
            "addChart",
            json!({"slide": s, "x": 0, "y": 0, "w": 100, "h": 100, "chart": chart_payload()}),
        )["object_id"]
            .as_u64()
            .unwrap();
        let table = apply(
            &mut e,
            "addTable",
            json!({"slide": s, "x": 0, "y": 0, "w": 100, "h": 100, "table": table_payload()}),
        )["object_id"]
            .as_u64()
            .unwrap();
        apply(&mut e, "moveObject", json!({"slide": s, "id": chart, "x": 50, "y": 60}));
        apply(&mut e, "resizeObject", json!({"slide": s, "id": table, "w": 200, "h": 150}));
        apply(&mut e, "rotateObject", json!({"slide": s, "id": chart, "degrees": 15}));
        let objects = &e.state.slides[0].objects;
        assert_eq!((objects[0].x, objects[0].y, objects[0].rotation_deg), (50.0, 60.0, 15.0));
        assert_eq!((objects[1].w, objects[1].h), (200.0, 150.0));

        // slideAt resolves their geometry like any bounded object.
        let at = apply(&mut e, "slideAt", json!({"slide": s, "t_s": 0}));
        assert_eq!(at["objects"][0]["x"].as_f64(), Some(50.0));

        // removeObject drops the object and its spec in one undo step.
        apply(&mut e, "removeObject", json!({"slide": s, "id": chart}));
        assert_eq!(e.state.slides[0].objects.len(), 1);
        assert!(e.undo().unwrap());
        assert_eq!(e.state.slides[0].objects.len(), 2);
        assert!(e.state.slides[0].objects[0].chart.is_some());
    }

    #[test]
    fn hostile_restore_rejects_mismatched_or_over_bound_data_specs() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        apply(
            &mut e,
            "addChart",
            json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "chart": chart_payload()}),
        );
        apply(
            &mut e,
            "addTable",
            json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "table": table_payload()}),
        );
        let good = e.snapshot().unwrap();

        fn objects(d: &mut Value) -> &mut Vec<Value> {
            d["slides"][0]["objects"].as_array_mut().unwrap()
        }

        // Helper: mutate the serialized document inside a schema:7 wrapper.
        let mutate = |f: &dyn Fn(&mut Value)| -> Vec<u8> {
            let (_, payload) = decode_envelope(&good).unwrap();
            let mut wrapped: Value = serde_json::from_slice(payload).unwrap();
            f(&mut wrapped["document"]);
            encode_envelope(&serde_json::to_vec(&wrapped).unwrap())
        };

        // Chart spec on a text-kind object rejects.
        let bad = mutate(&|d| {
            let objs = objects(d);
            objs[0]["kind"] = json!("text");
        });
        assert!(e.restore(&bad).is_err());
        // Chart kind missing its spec rejects.
        let bad = mutate(&|d| {
            objects(d)[0].as_object_mut().unwrap().remove("chart");
        });
        assert!(e.restore(&bad).is_err());
        // Table spec on the chart object rejects (kind/spec mismatch).
        let bad = mutate(&|d| {
            let objs = objects(d);
            objs[0].as_object_mut().unwrap().remove("chart");
            objs[0]["table"] = objs[1]["table"].clone();
        });
        assert!(e.restore(&bad).is_err());
        // Over-bound series count inside a valid wrapper rejects.
        let bad = mutate(&|d| {
            let series: Vec<Value> = (0..33)
                .map(|i| json!({"id": format!("s{i}"), "label": "L", "points": [{"x": 1, "y": 1}]}))
                .collect();
            objects(d)[0]["chart"]["series"] = json!(series);
        });
        assert!(e.restore(&bad).is_err());
        // Duplicate table cell rejects.
        let bad = mutate(&|d| {
            objects(d)[1]["table"]["cells"]
                .as_array_mut()
                .unwrap()
                .push(json!({"row": 0, "col": 0, "value": "dup"}));
        });
        assert!(e.restore(&bad).is_err());
        // Cell outside shrunken dims rejects.
        let bad = mutate(&|d| {
            objects(d)[1]["table"]["rows"] = json!(1);
        });
        assert!(e.restore(&bad).is_err());
        // Chart object with non-positive bounds rejects.
        let bad = mutate(&|d| {
            objects(d)[0]["w"] = json!(0);
        });
        assert!(e.restore(&bad).is_err());
        // Chart object carrying a text payload rejects.
        let bad = mutate(&|d| {
            objects(d)[0]["text"] = json!({"content": "x", "font_size": 12, "color": [0,0,0,255], "bold": false, "italic": false});
        });
        assert!(e.restore(&bad).is_err());
        // Unknown future schema still rejects; state is untouched throughout.
        let mut wrapped: Value = {
            let (_, payload) = decode_envelope(&good).unwrap();
            serde_json::from_slice(payload).unwrap()
        };
        wrapped["schema"] = json!(9);
        assert!(e
            .restore(&encode_envelope(&serde_json::to_vec(&wrapped).unwrap()))
            .is_err());
        assert_eq!(e.snapshot().unwrap(), good);

        // A schema:6-labeled wrapper carrying chart data is still READ
        // (readers are lenient downward) but schema:≤6 writers never emit
        // it — matching the morph_name precedent.
        let mut downgraded: Value = {
            let (_, payload) = decode_envelope(&good).unwrap();
            serde_json::from_slice(payload).unwrap()
        };
        downgraded["schema"] = json!(6);
        let mut re = PitchEngine::new();
        re.restore(&encode_envelope(&serde_json::to_vec(&downgraded).unwrap()))
            .unwrap();
        assert!(re.state.slides[0].objects[0].chart.is_some());
    }

    #[test]
    fn new_resets_data_objects_with_the_deck() {
        let mut e = PitchEngine::new();
        let s = slide(&mut e);
        apply(
            &mut e,
            "addChart",
            json!({"slide": s, "x": 0, "y": 0, "w": 10, "h": 10, "chart": chart_payload()}),
        );
        apply(&mut e, "new", json!({"title": "Fresh"}));
        assert!(e.state.slides[0].objects.is_empty());
        let snap = e.snapshot().unwrap();
        let (_, payload) = decode_envelope(&snap).unwrap();
        let value: Value = serde_json::from_slice(payload).unwrap();
        // Bare legacy payload: no chart data remains, so no wrapper.
        assert!(value.get("schema").is_none());
    }
}
