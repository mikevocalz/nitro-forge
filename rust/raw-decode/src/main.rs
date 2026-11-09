//! raw-decode — JSON-lines host binary for the nf-raw RAW provider.
//! Same wire shape as `nf-cli`/`folio-render`/`splice-render`: one
//! `{"id","handle","op","payload"}` request per stdin line, one response
//! per stdout line. Ops: `probe`, `decodePreview`, `jobStatus`,
//! `cancelJob`, `describe`. LibRaw runs on a single worker thread;
//! decoded RGBA8 is for the host to feed to photo-engine
//! `processPreview` — see docs/completion/reports/P10-raw-product-admission.md.

use raw_decode::RawDecodeService;

fn main() {
    let mut service = RawDecodeService::new();
    if let Err(e) = raw_decode::run_stdio(&mut service) {
        eprintln!("raw-decode: {e}");
        std::process::exit(1);
    }
}
