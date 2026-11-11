//! Generates `packages/folio/tests/fixtures/forms.pdf` — a one-page PDF
//! with AcroForm widgets covering Tx, Btn checkbox, Btn radio, Ch and
//! Sig fields. Regenerate with:
//!   cargo run -p folio-engine --example gen_form_fixture -- packages/folio/tests/fixtures/forms.pdf
use lopdf::{dictionary, Document, Object, Stream};

fn main() {
    let out = std::env::args().nth(1).expect("usage: gen_form_fixture <out.pdf>");
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

    // Merged Tx field.
    let mut d = base(dictionary! {
        "Rect" => rect(700.0),
        "FT" => "Tx",
        "T" => lopdf::text_string("name"),
        "V" => lopdf::text_string("old"),
        "Ff" => 0,
    });
    d.set("Rect", rect(700.0));
    let id = doc.add_object(Object::Dictionary(d));
    annots.push(Object::Reference(id));
    fields.push(Object::Reference(id));

    // Merged Btn checkbox.
    let d = base(dictionary! {
        "Rect" => rect(660.0),
        "FT" => "Btn",
        "T" => lopdf::text_string("agree"),
        "V" => Object::Name(b"Yes".to_vec()),
        "Ff" => 0,
    });
    let id = doc.add_object(Object::Dictionary(d));
    annots.push(Object::Reference(id));
    fields.push(Object::Reference(id));

    // Radio group: field + two widget kids.
    let radio = doc.new_object_id();
    let mut kids = Vec::new();
    for (state, y) in [("A", 620.0), ("B", 600.0)] {
        let d = base(dictionary! {
            "Rect" => rect(y),
            "Parent" => Object::Reference(radio),
            "AP" => dictionary! {
                "N" => dictionary! {
                    state => Object::Null,
                    "Off" => Object::Null,
                },
            },
        });
        let id = doc.add_object(Object::Dictionary(d));
        annots.push(Object::Reference(id));
        kids.push(Object::Reference(id));
    }
    doc.objects.insert(
        radio,
        Object::Dictionary(dictionary! {
            "FT" => "Btn",
            "T" => lopdf::text_string("choice"),
            "V" => Object::Name(b"A".to_vec()),
            "Ff" => 32768,
            "Kids" => Object::Array(kids),
        }),
    );
    fields.push(Object::Reference(radio));

    // Merged Ch field.
    let d = base(dictionary! {
        "Rect" => rect(560.0),
        "FT" => "Ch",
        "T" => lopdf::text_string("pick"),
        "V" => lopdf::text_string("a"),
        "Opt" => vec![lopdf::text_string("a"), lopdf::text_string("b")],
    });
    let id = doc.add_object(Object::Dictionary(d));
    annots.push(Object::Reference(id));
    fields.push(Object::Reference(id));

    // Merged Sig field.
    let d = base(dictionary! {
        "Rect" => rect(520.0),
        "FT" => "Sig",
        "T" => lopdf::text_string("signature"),
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
            "NeedAppearances" => false,
        },
    }));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    std::fs::write(&out, &buf).unwrap();
    eprintln!("wrote {} bytes to {out}", buf.len());
}
