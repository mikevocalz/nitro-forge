//! folio-render — JSON-lines host binary for the folio-render service.
//! Same wire shape as `nf-cli`: one `{"id","handle","op","payload"}`
//! request per stdin line, one response per stdout line. Ops:
//! `open`, `close`, `renderPage`, `textPage`, `search`, `pageInfo`,
//! `describe`. Requires a pdfium shared library — see README.md.

use folio_render::RenderService;

fn main() {
    let mut service = RenderService::new();
    if let Err(e) = folio_render::run_stdio(&mut service) {
        eprintln!("folio-render: {e}");
        std::process::exit(1);
    }
}
