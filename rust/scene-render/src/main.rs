//! scene-render — JSON-lines host binary for the scene-render service.
//! Same wire shape as `nf-cli`/`folio-render`: one
//! `{"id","handle","op","payload"}` request per stdin line, one response
//! per stdout line. Ops: `render`, `describe`. Stateless — each `render`
//! carries the full canonical scene description; there are no sessions.

use scene_render::SceneRenderService;

fn main() {
    let service = SceneRenderService::new();
    if let Err(e) = scene_render::run_stdio(&service) {
        eprintln!("scene-render: {e}");
        std::process::exit(1);
    }
}
