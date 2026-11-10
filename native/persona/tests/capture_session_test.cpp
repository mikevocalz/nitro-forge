#include "nitroforge/capture_session.hpp"
#include <cassert>
#include <cmath>
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

  // Structured quality gates: measured failures record which gate failed.
  CaptureSession gated({{"front",false},{"smile",true}});
  auto g1 = gated.start(true);
  CaptureQuality dim{{{QualityGate::lighting,false},{QualityGate::head_pose,true}}};
  bool dimOk = gated.observe(g1,"front","dark-frame",dim);
  assert(!dimOk && gated.observations().empty());
  const CaptureRejection* rej = gated.lastRejection();
  assert(rej && rej->step=="front" && rej->quality.failedGate());
  assert(*rej->quality.failedGate()==QualityGate::lighting);
  CaptureQuality empty{};
  assert(!gated.observe(g1,"front","no-gates",empty)); // unevaluated gates cannot pass
  CaptureQuality good{{{QualityGate::lighting,true},{QualityGate::head_pose,true},
                       {QualityGate::device_pose,true},{QualityGate::glasses,false},
                       {QualityGate::face_coverage,true}}};
  bool goodOk = gated.observe(g1,"front","bright-frame",good);
  assert(!goodOk && *gated.lastRejection()->quality.failedGate()==QualityGate::glasses);
  CaptureQuality pass{{{QualityGate::lighting,true},{QualityGate::head_pose,true},
                       {QualityGate::face_coverage,true}}};
  bool passOk = gated.observe(g1,"front","good-frame",pass);
  bool gSmile = gated.skip(g1,"smile");
  assert(passOk && gSmile && gated.lastRejection()==nullptr);
  auto gjob = gated.generate();
  bool gGen = gated.generated(gjob,"gated-avatar",true);
  assert(gGen);

  // Appearance edits: review-only, clamped, reset per candidate, kept on save.
  CaptureAppearance look{0.4f, 1.5f, true, "solid:#334455"};
  gated.setAppearance(look);
  assert(gated.appearance().warmth==0.4f && gated.appearance().brightness==1.f);
  gated.save();
  assert(gated.savedAsset()=="gated-avatar" && gated.appearance().touchUp);
  bool earlyEdit = false;
  try { gated.setAppearance({}); } catch (const std::logic_error&) { earlyEdit = true; }
  assert(earlyEdit); // stage is ready, not review
  CaptureAppearance nan{NAN, 0.f, false, {}};
  CaptureSession app({{"front",false}});
  auto a1 = app.start(true); app.observe(a1,"front","f",true);
  auto ajob = app.generate();
  bool aGen = app.generated(ajob,"a1",true);
  assert(aGen);
  bool badEdit = false;
  try { app.setAppearance(nan); } catch (const std::invalid_argument&) { badEdit = true; }
  assert(badEdit);
  app.save();
  app.start(true); // recapture resets the accepted look
  assert(app.appearance().warmth==0.f && app.appearance().brightness==0.f);
}
