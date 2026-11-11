//! Generates `packages/folio/tests/fixtures/signatures.pdf` — a one-page
//! PDF with two signature fields (one signed, one unsigned) and a
//! pre-existing `/Names`→`/EmbeddedFiles` attachment. Regenerate with:
//!   cargo run -p folio-engine --example gen_sigattach_fixture -- packages/folio/tests/fixtures/signatures.pdf
use lopdf::{dictionary, Document, Object, Stream};

fn main() {
    let out = std::env::args()
        .nth(1)
        .expect("usage: gen_sigattach_fixture <out.pdf>");
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content = Stream::new(dictionary! {}, Vec::new());
    let content_id = doc.add_object(Object::Stream(content));
    let page_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![
            Object::Integer(0), Object::Integer(0),
            Object::Integer(612), Object::Integer(792),
        ],
        "Resources" => dictionary! {},
        "Contents" => content_id,
    }));
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page_id)],
            "Count" => 1,
        }),
    );

    // Pre-existing embedded file: stream + filespec + name tree.
    let payload = b"fixture attachment bytes";
    let ef_stream = Stream::new(
        dictionary! {
            "Type" => "EmbeddedFile",
            "Params" => dictionary! { "Size" => payload.len() as i64 },
        },
        payload.to_vec(),
    );
    let ef_id = doc.add_object(Object::Stream(ef_stream));
    let spec_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => "Filespec",
        "F" => lopdf::text_string("readme.txt"),
        "UF" => lopdf::text_string("readme.txt"),
        "EF" => dictionary! { "F" => ef_id },
        "Desc" => lopdf::text_string("fixture notes"),
    }));

    let rect = |y: f32| {
        vec![
            Object::Real(50.0),
            Object::Real(y),
            Object::Real(250.0),
            Object::Real(y + 20.0),
        ]
    };
    let base = |extra: lopdf::Dictionary| {
        let mut d = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "P" => Object::Reference(page_id),
        };
        for (k, v) in extra.iter() {
            d.set(k.clone(), v.clone());
        }
        d
    };
    let mut annots = Vec::new();
    let mut fields = Vec::new();

    // Signed signature field: /V is a signature dictionary.
    let sig_dict = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => "Sig",
        "Filter" => "Adobe.PPKLite",
        "SubFilter" => "adbe.pkcs7.detached",
        "Name" => lopdf::text_string("Fixture Signer"),
        "M" => lopdf::text_string("D:20260102000000Z"),
        "Reason" => lopdf::text_string("fixture approval"),
        "ContactInfo" => lopdf::text_string("signer@example.com"),
        "ByteRange" => vec![
            Object::Integer(0), Object::Integer(512),
            Object::Integer(1024), Object::Integer(2048),
        ],
    }));
    let d = base(dictionary! {
        "Rect" => rect(700.0),
        "FT" => "Sig",
        "T" => lopdf::text_string("signature.signed"),
        "V" => Object::Reference(sig_dict),
    });
    let id = doc.add_object(Object::Dictionary(d));
    annots.push(Object::Reference(id));
    fields.push(Object::Reference(id));

    // Unsigned signature field: no /V yet.
    let d = base(dictionary! {
        "Rect" => rect(660.0),
        "FT" => "Sig",
        "T" => lopdf::text_string("signature.pending"),
    });
    let id = doc.add_object(Object::Dictionary(d));
    annots.push(Object::Reference(id));
    fields.push(Object::Reference(id));

    let page = doc
        .get_object_mut(page_id)
        .and_then(Object::as_dict_mut)
        .unwrap();
    page.set("Annots", Object::Array(annots));
    let catalog_id = doc.add_object(Object::Dictionary(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
        "AcroForm" => dictionary! {
            "Fields" => Object::Array(fields),
        },
        "Names" => dictionary! {
            "EmbeddedFiles" => dictionary! {
                "Names" => vec![
                    lopdf::text_string("readme.txt"),
                    Object::Reference(spec_id),
                ],
            },
        },
    }));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    std::fs::write(&out, &buf).unwrap();
    eprintln!("wrote {} bytes to {out}", buf.len());
}
