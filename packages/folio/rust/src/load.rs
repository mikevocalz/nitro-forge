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
    let mut doc = if !doc.trailer.has(b"Encrypt") || doc.encryption_state.is_some() {
        doc
    } else {
        ciphertext_view(bytes, doc)?
    };
    normalize(&mut doc);
    check_reloadable(&doc)?;
    Ok(doc)
}

/// Refuse a document that lopdf could not load back from its own save.
///
/// lopdf's recovery accepts files with no usable catalog (and, for a locked
/// file, with no objects at all). Folio then held a document whose next
/// save wrote a trailer pointing at nothing, and restoring that snapshot
/// failed with "missing xref entry" (found by the `snapshot_restore` fuzz
/// target). The catalog must be a dictionary and `/Encrypt`, when it is a
/// reference, must name a loaded dictionary, since loading a file with
/// `/Encrypt` resolves it first.
fn check_reloadable(doc: &Document) -> Result<(), EngineError> {
    let root = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|_| EngineError::serialization("pdf: trailer has no /Root reference"))?;
    if doc.get_dictionary(root).is_err() {
        return Err(EngineError::serialization(format!(
            "pdf: catalog {} {} R is missing or not a dictionary",
            root.0, root.1
        )));
    }
    if let Ok(Object::Reference(id)) = doc.trailer.get(b"Encrypt") {
        if doc.get_dictionary(*id).is_err() {
            return Err(EngineError::serialization(format!(
                "pdf: /Encrypt {} {} R is missing or not a dictionary",
                id.0, id.1
            )));
        }
    }
    Ok(())
}

/// Remove what lopdf loads but never writes back, and derive `max_id` from
/// what is left, so that a save of the result loads back to itself.
///
/// Object number 0 is the head of the free list (ISO 32000-1, 7.5.4) and
/// never a real object, but lopdf's damaged-file recovery can load an
/// `0 0 obj` it finds in the body. A save writes it and the reload drops it
/// again (entry 0 is always free), so the first snapshot of such a file
/// differed from every later one (found by the `pdf_open` fuzz target).
///
/// lopdf loads a `/Type /XRef` stream as an ordinary object but never
/// writes it back (a save regenerates the table), while `max_id` still
/// counts it. The next save then numbers its own xref stream one higher,
/// so every snapshot -> restore cycle of an xref-stream file grew the
/// document by one id and no snapshot was ever stable (found by the
/// `pdf_open` fuzz target). `max_id` stays at least the highest id any
/// remaining object or the trailer refers to, so a new object can never
/// take the id of a dangling reference.
fn normalize(doc: &mut Document) {
    doc.objects
        .retain(|id, object| id.0 != 0 && !matches!(object.type_name(), Ok(b"XRef")));
    let mut max_id = doc.objects.keys().next_back().map_or(0, |id| id.0);
    let mut stack: Vec<&Object> = doc.objects.values().collect();
    stack.extend(doc.trailer.iter().map(|(_, v)| v));
    while let Some(object) = stack.pop() {
        match object {
            Object::Reference(id) => max_id = max_id.max(id.0),
            Object::Array(items) => stack.extend(items),
            Object::Dictionary(dict) => stack.extend(dict.iter().map(|(_, v)| v)),
            Object::Stream(stream) => stack.extend(stream.dict.iter().map(|(_, v)| v)),
            _ => {}
        }
    }
    doc.max_id = max_id;
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

#[cfg(test)]
mod tests {
    //! Regression inputs from the cargo-fuzz targets (docs/security/fuzzing.md).
    use crate::FolioEngine;
    use ignition_core::{Command, Engine, EngineError, ErrorCode};

    fn open(bytes: &[u8]) -> (FolioEngine, Result<(), EngineError>) {
        let mut e = FolioEngine::new();
        let mut cmd = Command::new("open", serde_json::json!({}));
        cmd.input = Some(bytes.to_vec());
        let r = e.apply(cmd).map(|_| ());
        (e, r)
    }

    /// The fuzz oracle: a snapshot restores, and restoring it snapshots to
    /// the same bytes.
    fn assert_stable(e: &FolioEngine) {
        let s1 = e.snapshot().unwrap();
        let mut f = FolioEngine::new();
        f.restore(&s1).expect("own snapshot restores");
        assert!(f.snapshot().unwrap() == s1, "snapshot -> restore -> snapshot changed");
    }

    #[test]
    fn xref_stream_file_snapshot_is_stable() {
        for bytes in [
            &include_bytes!("../../tests/fixtures/signatures.pdf")[..],
            &include_bytes!("../tests/fuzz-regressions/xref-stream-max-id.pdf")[..],
        ] {
            let (e, r) = open(bytes);
            r.expect("opens");
            assert_stable(&e);
        }
    }

    #[test]
    fn object_zero_is_dropped_on_load() {
        let bytes = include_bytes!("../tests/fuzz-regressions/object-zero.pdf");
        let (e, r) = open(bytes);
        if r.is_ok() {
            assert_stable(&e);
        }
        if let Ok(doc) = super::load_pdf(bytes) {
            assert!(doc.objects.keys().all(|id| id.0 != 0));
        }
    }

    #[test]
    fn locked_file_without_catalog_is_refused() {
        let snapshot = include_bytes!("../tests/fuzz-regressions/locked-no-catalog.nfd1");
        let mut e = FolioEngine::new();
        let before = e.snapshot().unwrap();
        let err = e.restore(snapshot).expect_err("no catalog");
        assert_eq!(err.code, ErrorCode::Serialization, "{}", err.message);
        assert!(err.recoverable);
        assert!(e.snapshot().unwrap() == before, "failed restore changed state");
    }

    /// RUSTSEC-2026-0187: deep nesting overflowed lopdf's parser stack
    /// before 0.42. It must now load or fail with a typed error.
    #[test]
    fn deeply_nested_object_does_not_overflow() {
        let depth = 10_380;
        let nested = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        let first = format!("1 0 obj\n<</Type/Catalog/Pages 2 0 R/X {nested}>>\nendobj\n");
        let second = "2 0 obj\n<</Type/Pages/Kids[]/Count 0>>\nendobj\n";
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let o1 = pdf.len();
        pdf.extend_from_slice(first.as_bytes());
        let o2 = pdf.len();
        pdf.extend_from_slice(second.as_bytes());
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!(
                "xref\n0 3\n0000000000 65535 f \n{o1:010} 00000 n \n{o2:010} 00000 n \n\
                 trailer\n<</Size 3/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n"
            )
            .as_bytes(),
        );
        let (e, r) = open(&pdf);
        match r {
            Ok(()) => assert_stable(&e),
            Err(err) => {
                assert_ne!(err.code, ErrorCode::Internal, "{}", err.message);
                assert!(err.recoverable);
            }
        }
    }
}
