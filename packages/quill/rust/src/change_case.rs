//! Default Unicode casing with style ownership per source scalar, not delete/insert.
use super::*;
use unicode_normalization::char::is_combining_mark;
const BUDGET: usize = 1024 * 1024;
fn append(inlines: &mut Vec<Inline>, text: &str, style: &Style) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = inlines.last_mut() {
        if &last.style == style {
            last.text.push_str(text);
            return;
        }
    }
    inlines.push(Inline {
        text: text.into(),
        style: style.clone(),
    });
}
impl QuillEngine {
    pub(super) fn op_change_case(&mut self, p: &Value) -> Result<CommandResult, EngineError> {
        let from = parse_pos(field(p, "from")?)?;
        let to = parse_pos(field(p, "to")?)?;
        self.check_range(from, to)?;
        let mode = as_str(field(p, "mode")?, "mode")?;
        if !matches!(mode, "lower" | "upper" | "sentence" | "capitalize") {
            return Err(EngineError::validation("unknown changeCase mode"));
        }
        let response = |end: Pos| json!({"from":{"block":from.block,"offset":from.offset},"to":{"block":end.block,"offset":end.offset}});
        if from == to {
            return Ok(Self::read_only(response(to)));
        }
        // Count source bytes before cloning blocks or materializing paragraph context.
        let span = &self.blocks[from.block..=to.block];
        if span.len() > 4096 {
            return Err(EngineError::validation(
                "changeCase exceeds 4096 affected blocks",
            ));
        }
        let mut context_runs = 0usize;
        let mut context_bytes = 0usize;
        for block in span {
            context_runs = context_runs
                .checked_add(block.inlines.len())
                .filter(|n| *n <= 65_536)
                .ok_or_else(|| EngineError::validation("changeCase exceeds 65536 affected runs"))?;
            for inline in &block.inlines {
                context_bytes = context_bytes
                    .checked_add(inline.text.len())
                    .filter(|n| *n <= BUDGET)
                    .ok_or_else(|| EngineError::validation("changeCase context exceeds 1 MiB"))?;
            }
        }
        // Re-anchor position marks inside the affected blocks through the
        // conversion: each mark keeps the output offset produced by the
        // source scalars before it (case mapping can expand one scalar
        // into several, e.g. ß → SS). `offset_maps` records, per affected
        // block, the output offset before each source scalar (plus the
        // final length); bookmarks and comment anchors share the mapping.
        let mut offset_maps: Vec<(usize, Vec<usize>)> = Vec::with_capacity(span.len());
        let mut next = Vec::with_capacity(span.len());
        let mut output_bytes = 0usize;
        let mut changed = false;
        let mut end = to;
        for (i, block) in span.iter().enumerate() {
            let block_index = from.block + i;
            let start = if block_index == from.block {
                from.offset
            } else {
                0
            };
            let stop = if block_index == to.block {
                to.offset
            } else {
                block_len(block)
            };
            let original = block_text(block);
            let lowered = original.to_lowercase();
            let mut lower = lowered.chars();
            let mut offset = 0;
            let mut selected_chars = 0;
            let mut inlines = Vec::new();
            let mut produced = 0usize;
            let mut offset_map = Vec::with_capacity(offset + 1);
            let mut word = false;
            let mut sentence = true;
            let mut punctuation = false;
            for inline in &block.inlines {
                for c in inline.text.chars() {
                    // Rust's full-string lowercase supplies context (notably final sigma), even across run/selection boundaries.
                    let count = c.to_lowercase().count();
                    let segment: String = lower.by_ref().take(count).collect();
                    if segment.chars().count() != count {
                        return Err(EngineError::unsupported(
                            "Unicode lowercase alignment changed",
                        ));
                    }
                    let text = if offset >= start && offset < stop {
                        let converted = match mode {
                            "upper" => c.to_uppercase().collect::<String>(),
                            "lower" => segment,
                            "capitalize" => {
                                let capitalize = !word && c.is_alphabetic();
                                word = c.is_alphanumeric()
                                    || is_combining_mark(c)
                                    || matches!(c, '\'' | '’');
                                if capitalize {
                                    segment.to_uppercase()
                                } else {
                                    segment
                                }
                            }
                            "sentence" => {
                                let capitalize = sentence && c.is_alphabetic();
                                if c.is_alphabetic() {
                                    sentence = false;
                                }
                                if matches!(c, '.' | '!' | '?') {
                                    punctuation = true;
                                } else if c.is_whitespace() {
                                    if punctuation {
                                        sentence = true;
                                    }
                                } else {
                                    punctuation = false;
                                }
                                if capitalize {
                                    segment.to_uppercase()
                                } else {
                                    segment
                                }
                            }
                            _ => unreachable!(),
                        };
                        output_bytes = output_bytes
                            .checked_add(converted.len())
                            .filter(|n| *n <= BUDGET)
                            .ok_or_else(|| {
                                EngineError::validation("changeCase output exceeds 1 MiB")
                            })?;
                        selected_chars += converted.chars().count();
                        changed |= converted != c.to_string();
                        converted
                    } else {
                        c.to_string()
                    };
                    // Marks at this source boundary keep the output
                    // offset produced so far.
                    offset_map.push(produced);
                    append(&mut inlines, &text, &inline.style);
                    produced += text.chars().count();
                    offset += 1;
                }
            }
            // Marks at the block end map to the converted block length.
            offset_map.push(produced);
            offset_maps.push((block_index, offset_map));
            if lower.next().is_some() {
                return Err(EngineError::unsupported(
                    "Unicode lowercase alignment changed",
                ));
            }
            if block_index == to.block {
                end.offset = to.offset - (stop - start) + selected_chars;
            }
            next.push(Block {
                kind: block.kind,
                list: block.list.clone(),
                style_id: block.style_id.clone(),
                inlines,
                // Table blocks carry no case-able text; the payload is
                // preserved verbatim through the clone.
                table: block.table.clone(),
            });
        }
        if !changed {
            return Ok(Self::read_only(response(to)));
        }
        let bookmarks_before = self.bookmarks.clone();
        let comments_before = self.comments.clone();
        for (bi, map) in &offset_maps {
            for bm in self.bookmarks.iter_mut().filter(|b| b.block == *bi) {
                bm.offset = map[bm.offset];
            }
            for c in self.comments.iter_mut() {
                if c.from.block == *bi {
                    c.from.offset = map[c.from.offset];
                }
                if c.to.block == *bi {
                    c.to.offset = map[c.to.offset];
                }
            }
        }
        let removed = span.to_vec();
        self.record_undo(
            from.block,
            removed,
            next.clone(),
            Collections {
                bookmarks: Some(bookmarks_before),
                comments: Some(comments_before),
                ..Default::default()
            },
        );
        self.blocks.splice(from.block..=to.block, next);
        Ok(CommandResult::data(response(end)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(
        e: &mut QuillEngine,
        from: (usize, usize),
        to: (usize, usize),
        mode: &str,
    ) -> CommandResult {
        e.apply(Command::new("changeCase",json!({"from":{"block":from.0,"offset":from.1},"to":{"block":to.0,"offset":to.1},"mode":mode}))).unwrap()
    }
    fn run(text: &str, style: Style) -> Inline {
        Inline {
            text: text.into(),
            style,
        }
    }
    #[test]
    fn engine_casing_retains_hyperlink_metadata() {
        let mut e = QuillEngine::new();
        let style = Style {
            link: Some("https://example.com".into()),
            ..Style::default()
        };
        e.blocks[0].inlines = vec![run("ß", style.clone())];
        apply(&mut e, (0, 0), (0, 1), "upper");
        assert_eq!(e.blocks[0].inlines, vec![run("SS", style)]);
    }

    #[test]
    fn expansions_preserve_every_style_and_adjust_selection_with_docx_roundtrip() {
        let mut e = QuillEngine::new();
        let style = Style {
            bold: true,
            italic: true,
            underline: true,
            strike: true,
            color: Some("#123456".into()),
            highlight: Some("#AABBCC".into()),
            font_family: Some("Aptos".into()),
            font_size: Some(12.5),
            ..Style::default()
        };
        e.blocks = vec![Block {
            kind: BlockKind::H1,
            list: None,
            style_id: None,
            table: None,
            inlines: vec![
                run("a", Style::default()),
                run("ß", style.clone()),
                run(" z", Style::default()),
            ],
        }];
        let before = e.snapshot().unwrap();
        let result = apply(&mut e, (0, 1), (0, 2), "upper");
        assert_eq!(result.data["to"]["offset"], 3);
        assert_eq!(block_text(&e.blocks[0]), "aSS z");
        assert_eq!(e.blocks[0].inlines[1], run("SS", style));
        assert_eq!(e.blocks[0].kind, BlockKind::H1);
        let bytes = docx::export_docx(&e.blocks).unwrap();
        assert_eq!(docx::import_docx(&bytes).unwrap(), e.blocks);
        let after = e.snapshot().unwrap();
        assert!(e.undo().unwrap());
        assert_eq!(e.snapshot().unwrap(), before);
        let noop = apply(&mut e, (0, 0), (0, 1), "lower");
        assert!(noop.events.is_empty());
        assert!(e.redo().unwrap());
        assert_eq!(e.snapshot().unwrap(), after);
    }
    #[test]
    fn contextual_default_lowercase_crosses_style_and_selection_boundaries() {
        for text in ["ΟΣ", "ΟΣ\u{301}", "ΟΣ'", "İ ΟΣ İ", "ΣΟΣ ΑΣ"] {
            let mut e = QuillEngine::new();
            e.blocks[0].inlines = text
                .chars()
                .enumerate()
                .map(|(i, c)| {
                    run(
                        &c.to_string(),
                        Style {
                            bold: i % 2 == 0,
                            ..Style::default()
                        },
                    )
                })
                .collect();
            apply(&mut e, (0, 0), (0, text.chars().count()), "lower");
            assert_eq!(block_text(&e.blocks[0]), text.to_lowercase());
            let expected: Vec<_> = text
                .chars()
                .enumerate()
                .flat_map(|(i, c)| std::iter::repeat_n(i % 2 == 0, c.to_lowercase().count()))
                .collect();
            let actual: Vec<_> = e.blocks[0]
                .inlines
                .iter()
                .flat_map(|r| std::iter::repeat_n(r.style.bold, r.text.chars().count()))
                .collect();
            assert_eq!(actual, expected);
        }
        let mut e = QuillEngine::new();
        e.blocks[0].inlines = vec![run("ΟΣΑ", Style::default())];
        apply(&mut e, (0, 1), (0, 2), "lower");
        assert_eq!(block_text(&e.blocks[0]), "ΟσΑ");
    }
    #[test]
    fn multiple_blocks_sentence_word_grammar_and_empty_selection() {
        let mut e = QuillEngine::new();
        e.blocks = vec![
            Block {
                kind: BlockKind::Para,
                list: None,
                style_id: None,
                table: None,
                inlines: vec![run("abß", Style::default())],
            },
            Block {
                kind: BlockKind::Quote,
                list: None,
                style_id: None,
                table: None,
                inlines: vec![run("éz", Style::default())],
            },
        ];
        let result = apply(&mut e, (0, 1), (1, 1), "upper");
        assert_eq!(block_text(&e.blocks[0]), "aBSS");
        assert_eq!(block_text(&e.blocks[1]), "Éz");
        assert_eq!(e.blocks[1].kind, BlockKind::Quote);
        assert_eq!(result.data["to"], json!({"block":1,"offset":1}));
        for (mode, text, expected) in [
            ("sentence", "hÉLLO. WORLD! next", "Héllo. World! Next"),
            (
                "capitalize",
                "élAN d’ARTAGNAN e\u{301}CLAIR",
                "Élan D’artagnan E\u{301}clair",
            ),
        ] {
            e.blocks[0].inlines = vec![run(text, Style::default())];
            apply(&mut e, (0, 0), (0, text.chars().count()), mode);
            assert_eq!(block_text(&e.blocks[0]), expected);
        }
        let before = e.snapshot().unwrap();
        assert!(apply(&mut e, (0, 0), (0, 0), "upper").events.is_empty());
        assert_eq!(e.snapshot().unwrap(), before);
    }
    #[test]
    fn errors_and_output_budget_do_not_consume_redo() {
        let mut e = QuillEngine::new();
        e.blocks[0].inlines = vec![run("UPPER", Style::default())];
        apply(&mut e, (0, 0), (0, 5), "lower");
        e.undo().unwrap();
        let before = e.snapshot().unwrap();
        for payload in [
            json!({"from":{"block":0,"offset":4},"to":{"block":0,"offset":1},"mode":"upper"}),
            json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":5},"mode":"turkish"}),
        ] {
            assert!(e.apply(Command::new("changeCase", payload)).is_err());
            assert_eq!(e.snapshot().unwrap(), before);
        }
        assert!(e.redo().unwrap());
        e.blocks[0].inlines = vec![run(&"İ".repeat(BUDGET / 2), Style::default())];
        let before = e.snapshot().unwrap();
        assert!(e.apply(Command::new("changeCase",json!({"from":{"block":0,"offset":0},"to":{"block":0,"offset":BUDGET/2},"mode":"lower"}))).is_err());
        assert_eq!(e.snapshot().unwrap(), before);
    }
}
