#include "nitroforge/capture_session.hpp"
#include <cassert>
using namespace nitroforge::persona;
int main() {
  CaptureSession session({{"front",false},{"smile",true}});
  bool denied = false;
  try { session.start(false); } catch (const std::runtime_error&) { denied = true; }
  assert(denied && session.stage() == CaptureStage::prepare);
  auto first = session.start(true);
  bool badSkip = session.skip(first,"front");
  bool badQuality = session.observe(first,"front","bad-light",false);
  bool badOrder = session.observe(first,"smile","wrong-order",true);
  bool frontOk = session.observe(first,"front","frame-1",true);
  bool smileSkip = session.skip(first,"smile");
  assert(!badSkip && !badQuality && !badOrder && frontOk && smileSkip);
  auto job = session.generate();
  bool staleGen = session.generated(first,"stale-result",true);
  bool badGen = session.generated(job,"bad-model",false);
  bool failed = session.generationFailed(job);
  assert(!staleGen && !badGen && failed);
  auto retry = session.generate();
  bool oldJob = session.generated(job,"old-job",true);
  bool goodGen = session.generated(retry,"avatar-1",true);
  assert(!oldJob && goodGen && session.savedAsset().empty());
  session.save(); assert(session.savedAsset()=="avatar-1");
  auto second = session.start(true);
  assert(session.savedAsset()=="avatar-1"); // recapture cannot destroy saved avatar
  bool lateCam = session.observe(first,"front","late-camera",true);
  bool secondFront = session.observe(second,"front","frame-2",true);
  bool secondSmile = session.skip(second,"smile");
  assert(!lateCam && secondFront && secondSmile);
  auto cancelled = session.generate();session.cancel();
  bool lateModel = session.generated(cancelled,"late-model",true);
  assert(!lateModel);
  assert(session.savedAsset()=="avatar-1" && session.previewAsset().empty());
  session.forget();assert(session.savedAsset().empty() && session.observations().empty());

  // Companion-phone source: sealed capture waits for explicit transfer ack.
  CaptureSession phone({{"front",false},{"smile",true}}, CaptureSource::companion_phone);
  auto p1 = phone.start(true);
  bool pFront = phone.observe(p1,"front","phone-frame-1",true);
  bool pSmile = phone.skip(p1,"smile");
  assert(pFront && pSmile);
  auto seal = phone.generate();
  assert(phone.stage() == CaptureStage::handoff);
  bool earlyModel = phone.generated(seal,"early-model",true); // processing has not started
  bool lateSample = phone.observe(seal,"front","late-sample",true); // sealed bundle is closed
  assert(!earlyModel && !lateSample);
  auto pjob = phone.transferAcknowledged();
  assert(pjob != seal && phone.stage() == CaptureStage::processing);
  bool pGen = phone.generated(pjob,"phone-avatar",true);
  assert(pGen);
  phone.save(); assert(phone.savedAsset()=="phone-avatar");

  // Local and supplied-media sources skip the handoff stage.
  CaptureSession local({{"front",false}}, CaptureSource::local_device);
  auto l1 = local.start(true);
  bool lFront = local.observe(l1,"front","frame",true);
  assert(lFront);
  local.generate();
  assert(local.stage() == CaptureStage::processing);
  bool noHandoff = false;
  try { local.transferAcknowledged(); } catch (const std::logic_error&) { noHandoff = true; }
  assert(noHandoff);
  CaptureSession media({{"front",false}}, CaptureSource::supplied_media);
  auto m1 = media.start(true);
  bool mFront = media.observe(m1,"front","clip",true);
  assert(mFront);
  media.generate();
  assert(media.stage() == CaptureStage::processing);
}
