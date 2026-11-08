//! splice-render — JSON-lines host binary for the splice-render
//! service. Same wire shape as `nf-cli`/`folio-render`: one
//! `{"id","handle","op","payload"}` request per stdin line, one response
//! per stdout line. Ops: `renderFrame`, `renderRange`, `nextFrame`,
//! `dropJob`, `mixAudio`, `clearCache`, `describe`.

use splice_render::RenderService;

fn main() {
    let mut service = RenderService::new();
    if let Err(e) = splice_render::run_stdio(&mut service) {
        eprintln!("splice-render: {e}");
        std::process::exit(1);
    }
}
