#include "nitroforge/capture_session.hpp"
#include <cassert>
using namespace nitroforge::persona;
int main() {
  CaptureSession session({{"front",false},{"smile",true}});
  bool denied = false;
  try { session.start(false); } catch (const std::runtime_error&) { denied = true; }
  assert(denied && session.stage() == CaptureStage::prepare);
  auto first = session.start(true);
  assert(!session.skip(first,"front"));
  assert(!session.observe(first,"front","bad-light",false));
  assert(!session.observe(first,"smile","wrong-order",true));
  assert(session.observe(first,"front","frame-1",true));
  assert(session.skip(first,"smile"));
  auto job = session.generate();
  assert(!session.generated(first,"stale-result",true));
  assert(!session.generated(job,"bad-model",false));
  assert(session.generationFailed(job));
  auto retry = session.generate();
  assert(!session.generated(job,"old-job",true));
  assert(session.generated(retry,"avatar-1",true));
  assert(session.savedAsset().empty());
  session.save(); assert(session.savedAsset()=="avatar-1");
  auto second = session.start(true);
  assert(session.savedAsset()=="avatar-1"); // recapture cannot destroy saved avatar
  assert(!session.observe(first,"front","late-camera",true));
  session.observe(second,"front","frame-2",true);session.skip(second,"smile");
  auto cancelled = session.generate();session.cancel();
  assert(!session.generated(cancelled,"late-model",true));
  assert(session.savedAsset()=="avatar-1" && session.previewAsset().empty());
  session.forget();assert(session.savedAsset().empty() && session.observations().empty());
}
