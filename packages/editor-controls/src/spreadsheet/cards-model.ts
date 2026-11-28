// Portions ported from GridCraft for Android,
// apps/gridcraft-android/android/app/src/main/java/io/github/artcraftandroid/gridcraft/ui/editor/Cards.kt
// at https://github.com/artcraft-android/gridcraft-android/commit/72d5bfc0729d0966e9bd966c2eabaa0312eea3ff
// Copyright (c) 2026 ArtCraft Team and the GridCraft contributors.
// Licensed under the MIT License or the Apache License, Version 2.0, at your option;
// see licenses/GridCraft-MIT.txt and licenses/GridCraft-Apache-2.0.txt.
// Modified by NYC-Tron UI contributors, 2026-11-05: rewritten in TypeScript as a pure
// model over A1-addressed cells; the AppViewModel/TableCards source is replaced by a
// header row plus a cell record supplied by the app.
import { cellAddress, type SheetRange } from "../sheet-window.ts";

/** How many fields after the title a card in the list shows (GridCraft `CARD_LINES`). */
export const CARD_PREVIEW_FIELDS = 3;

/** One field of a card: a cell in the table row. */
export interface SheetCardField {
  /** Column header text, or the column letter when the header is blank. */
  readonly name: string;
  /** Cell address the field edits. */
  readonly address: string;
  /** What the cell holds as typed (a formula keeps its `=`). Edits start from this. */
  readonly raw: string;
  /** The engine's computed value, as text. */
  readonly display: string;
}

/** One table row as a card. */
export interface SheetCard {
  /** 0-based sheet row. */
  readonly row: number;
  readonly title: string;
  readonly fields: readonly SheetCardField[];
}

/** Cell values the model reads, keyed by A1 address. */
export type CardCellValues = Readonly<Record<string, {
  readonly raw: string;
  readonly computed: string | number | boolean | null;
} | undefined>>;

const text = (value: string | number | boolean | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** Column letters for a 0-based index (A, B, ..., AA). */
function letters(column: number): string {
  return cellAddress(0, column).replace(/[0-9]+$/, "");
}

/**
 * Cards for a table range whose first row is the header. The first column is
 * each card's title; a blank title reads `(blank)` as in GridCraft. Throws
 * `RangeError` for a range with no data rows.
 */
export function sheetCards(table: SheetRange, cells: CardCellValues): SheetCard[] {
  if (table.endRow <= table.startRow) throw new RangeError("A card table needs a header row and at least one row.");
  const names: string[] = [];
  for (let c = table.startColumn; c <= table.endColumn; c++) {
    const header = text(cells[cellAddress(table.startRow, c)]?.computed).trim();
    names.push(header || letters(c));
  }
  const cards: SheetCard[] = [];
  for (let r = table.startRow + 1; r <= table.endRow; r++) {
    const fields = names.map((name, i) => {
      const address = cellAddress(r, table.startColumn + i);
      const cell = cells[address];
      return { name, address, raw: cell?.raw ?? "", display: text(cell?.computed) };
    });
    cards.push({ row: r, title: fields[0]!.display.trim() || "(blank)", fields });
  }
  return cards;
}

/** Resolve one visible card without allocating the table's other rows. */
export function sheetCardAt(table:SheetRange,cells:CardCellValues,index:number):SheetCard{
 if(![table.startRow,table.endRow,table.startColumn,table.endColumn,index].every(Number.isSafeInteger)||table.startRow<0||table.startColumn<0||table.endColumn<table.startColumn||table.endColumn-table.startColumn>=256||index<0||index>=table.endRow-table.startRow)throw new RangeError('Invalid card table or row index');
 const row=table.startRow+index+1,fields:SheetCardField[]=[];
 for(let column=table.startColumn;column<=table.endColumn;column++){
  const name=text(cells[cellAddress(table.startRow,column)]?.computed).trim()||letters(column),address=cellAddress(row,column),cell=cells[address];
  fields.push({name,address,raw:cell?.raw??'',display:text(cell?.computed)});
 }
 return {row,title:fields[0]!.display.trim()||'(blank)',fields};
}
