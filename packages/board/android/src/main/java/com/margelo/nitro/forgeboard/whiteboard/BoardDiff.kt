package com.margelo.nitro.forgeboard.whiteboard

/**
 * A parsed QuickDraw diff: records to insert or replace (`added` and the
 * second element of each `updated` pair) and ids to delete (`removed`).
 * Applied puts-then-removes, like `Store.applyDiff`.
 */
internal class BoardDiff(val puts: List<BoardRecord>, val removedIds: List<String>)
