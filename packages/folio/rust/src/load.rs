//! Loading untrusted PDF bytes into the engine's object model.
//!
//! lopdf 0.47 loads an encrypted file whose user password is not empty as
//! a document with its trailer and cross-reference table but no objects:
//! it parses objects only once it can decrypt them. Folio's contract is
//! older than that. `open` without a password, and `restore` of a snapshot
//! taken while encrypted, both keep the ciphertext object model (pages,
//! annotations and every other structural read stay available, strings and
//! streams stay ciphertext) until `decrypt` or `open {password}` runs.
//!
//! [`load_pdf`] keeps that contract. For a file lopdf leaves locked it lays
//! out the file's own indirect objects, at the offsets lopdf read from its
//! cross-reference data, behind a fresh cross-reference table and a
//! trailer without `/Encrypt`, and lets lopdf parse that. The original
//! trailer (with `/Encrypt` and `/ID`) and version are then put back, which
//! is the state lopdf 0.36 produced. Objects inside object streams cannot
//! be read without the key, exactly as before.
//!
//! The rebuilt buffer holds each source byte at most once plus a bounded
//! amount per object (one newline and one 20-byte table row), so its size
//! is linear in the input whatever the cross-reference data claims.

use crate::lopdf_err;
use ignition_core::EngineError;
use lopdf::xref::XrefEntry;
use lopdf::{Document, Object};
use std::io::Write as _;

/// Load a PDF the way every Folio entry point that takes file bytes does.
pub(crate) fn load_pdf(bytes: &[u8]) -> Result<Document, EngineError> {
    let doc = Document::load_mem(bytes).map_err(lopdf_err)?;
    // lopdf's own test for "waits for its password": the trailer names
    // `/Encrypt` and no password (not even the empty one) unlocked it.
    if !doc.trailer.has(b"Encrypt") || doc.encryption_state.is_some() {
        return Ok(doc);
    }
    ciphertext_view(bytes, doc)
}

fn ciphertext_view(bytes: &[u8], locked: Document) -> Result<Document, EngineError> {
    let root = match locked.trailer.get(b"Root").and_then(Object::as_reference) {
        Ok(root) => root,
        // Nothing to rebuild around; later reads fail with a typed error.
        Err(_) => return Ok(locked),
    };
    // Every in-file object, by its offset. Ids sharing an offset name the
    // same bytes, so each offset is copied once.
    let mut objects: Vec<(usize, u32, u16)> = locked
        .reference_table
        .entries
        .iter()
        .filter_map(|(&id, entry)| match *entry {
            XrefEntry::Normal { offset, generation } if (offset as usize) < bytes.len() => {
                Some((offset as usize, id, generation))
            }
            _ => None,
        })
        .collect();
    objects.sort_unstable();
    objects.dedup_by_key(|o| o.0);
    // The last object ends where the final cross-reference section starts.
    let body_end = match locked.xref_start {
        0 => bytes.len(),
        start => start.min(bytes.len()),
    };

    let mut out = Vec::with_capacity(bytes.len() + 32 + objects.len() * 21);
    let _ = writeln!(out, "%PDF-{}", locked.version);
    let mut rows = Vec::with_capacity(objects.len());
    for (i, &(offset, id, generation)) in objects.iter().enumerate() {
        let next = objects.get(i + 1).map_or(body_end, |o| o.0);
        let end = if next > offset { next } else { bytes.len() };
        rows.push((id, out.len(), generation));
        out.extend_from_slice(&bytes[offset..end]);
        out.push(b'\n');
    }
    rows.sort_unstable_by_key(|r| r.0);
    let xref_at = out.len();
    let _ = write!(out, "xref\n0 1\n0000000000 65535 f \n");
    for &(id, offset, generation) in &rows {
        let _ = write!(out, "{id} 1\n{offset:010} {generation:05} n \n");
    }
    let size = rows.last().map_or(1, |r| u64::from(r.0) + 1);
    let _ = write!(
        out,
        "trailer\n<</Size {size}/Root {} {} R>>\nstartxref\n{xref_at}\n%%EOF\n",
        root.0, root.1
    );

    let mut view = Document::load_mem(&out).map_err(lopdf_err)?;
    view.version = locked.version.clone();
    view.trailer = locked.trailer.clone();
    view.reference_table.cross_reference_type = locked.reference_table.cross_reference_type;
    // Ids that live in unreadable object streams stay reserved.
    view.max_id = view.max_id.max(locked.max_id);
    Ok(view)
}
