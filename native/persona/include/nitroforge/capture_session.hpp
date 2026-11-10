#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
namespace nitroforge::persona {
enum class CaptureStage { prepare, capture, handoff, processing, review, ready, cancelled };
// companion_phone mirrors the observed reference flow: capture runs on the
// phone, the receiving host must acknowledge transfer before processing, and
// no account/cloud sync is implied by that acknowledgement.
enum class CaptureSource { local_device, companion_phone, supplied_media };
struct CaptureStep { std::string id; bool skippable; };
struct CaptureObservation { std::string step, sample; bool skipped; };
// Per-signal quality gates mirroring the reference app's guidance statuses
// (lighting, head pose, device pose, glasses, face coverage). Only measured
// verdicts are reported; an unevaluated gate is simply absent.
enum class QualityGate : std::uint8_t { lighting, head_pose, device_pose, glasses, face_coverage };
struct CaptureQuality {
  std::vector<std::pair<QualityGate, bool>> gates;
  bool accepted() const {
    return !gates.empty() &&
           std::all_of(gates.begin(), gates.end(), [](const auto& g) { return g.second; });
  }
  const QualityGate* failedGate() const {
    for (const auto& g : gates) if (!g.second) return &g.first;
    return nullptr;
  }
};
struct CaptureRejection { std::string step; CaptureQuality quality; };
// Appearance edits observed on the reference headset preview: warmth,
// brightness, portrait touch-up and background fill. Values are normalized
// and clamped by the session; the host renders them into the generated asset.
struct CaptureAppearance {
  float warmth = 0.f;
  float brightness = 0.f;
  bool touchUp = false;
  std::string backgroundFill; // opaque host token, e.g. a color spec
};
// Native lifecycle only. A host supplies real camera/quality evaluation, model
// generation and persistence. No progress timer or fabricated avatar is used.
class CaptureSession final {
 public:
  explicit CaptureSession(std::vector<CaptureStep> steps,
                          CaptureSource source = CaptureSource::local_device)
      : steps_(std::move(steps)), source_(source) {
    if (steps_.empty()) throw std::invalid_argument("capture needs steps");
    for (size_t i = 0; i < steps_.size(); ++i) {
      if (steps_[i].id.empty()) throw std::invalid_argument("empty capture step");
      for (size_t j = 0; j < i; ++j)
        if (steps_[i].id == steps_[j].id) throw std::invalid_argument("duplicate capture step");
    }
  }
  CaptureStage stage() const { return stage_; }
  CaptureSource source() const { return source_; }
  const std::string& savedAsset() const { return saved_; }
  const std::string& previewAsset() const { return candidate_; }
  const std::vector<CaptureObservation>& observations() const { return observations_; }
  // Last quality rejection for the current capture epoch, or nullptr. Lets the
  // guide show which gate failed instead of a bare reject. Cleared on start.
  const CaptureRejection* lastRejection() const { return has_rejection_ ? &rejection_ : nullptr; }
  // Appearance parameters accepted during review; valid from review through
  // ready. Editing is only allowed in review so a saved avatar's look is the
  // one explicitly accepted.
  const CaptureAppearance& appearance() const { return appearance_; }
  void setAppearance(const CaptureAppearance& appearance) {
    if (stage_ != CaptureStage::review) throw std::logic_error("review required");
    if (!std::isfinite(appearance.warmth) || !std::isfinite(appearance.brightness))
      throw std::invalid_argument("appearance values must be finite");
    appearance_ = appearance;
    appearance_.warmth = std::max(-1.f, std::min(1.f, appearance_.warmth));
    appearance_.brightness = std::max(-1.f, std::min(1.f, appearance_.brightness));
  }
  const CaptureStep* currentStep() const {
    return stage_ == CaptureStage::capture && observations_.size() < steps_.size()
      ? &steps_[observations_.size()] : nullptr;
  }
  uint64_t start(bool capturePermissionGranted) {
    if (!capturePermissionGranted) throw std::runtime_error("capture permission required");
    advanceEpoch(); observations_.clear(); candidate_.clear(); appearance_ = {};
    stage_ = CaptureStage::capture;
    rejection_ = {}; has_rejection_ = false;
    return epoch_;
  }
  // The caller carries the epoch through asynchronous camera callbacks. Quality
  // rejection does not advance the guide. Sample is an opaque host-owned handle.
  bool observe(uint64_t epoch, const std::string& step, const std::string& sample, bool qualityAccepted) {
    return observe(epoch, step, sample,
                   qualityAccepted ? CaptureQuality{{{QualityGate::face_coverage, true}}}
                                   : CaptureQuality{});
  }
  // Structured variant: every measured gate must pass and at least one gate
  // must be reported. Rejections record which gate failed for guide feedback.
  bool observe(uint64_t epoch, const std::string& step, const std::string& sample,
               const CaptureQuality& quality) {
    const auto* current = currentStep();
    if (epoch != epoch_ || !current || step != current->id || sample.empty()) return false;
    if (!quality.accepted()) {
      rejection_ = {step, quality}; has_rejection_ = true; return false;
    }
    has_rejection_ = false;
    observations_.push_back({step, sample, false}); return true;
  }
  bool skip(uint64_t epoch, const std::string& step) {
    const auto* current = currentStep();
    if (epoch != epoch_ || !current || current->id != step || !current->skippable) return false;
    observations_.push_back({step, {}, true}); return true;
  }
  uint64_t generate() {
    if (stage_ != CaptureStage::capture || observations_.size() != steps_.size())
      throw std::logic_error("capture coverage incomplete");
    if (std::none_of(observations_.begin(), observations_.end(), [](const auto& o){return !o.skipped;}))
      throw std::logic_error("capture has no samples");
    advanceEpoch();
    stage_ = source_ == CaptureSource::companion_phone ? CaptureStage::handoff
                                                     : CaptureStage::processing;
    return epoch_;
  }
  // Companion-phone bundles wait in handoff until the receiving host
  // acknowledges the transfer; the returned epoch is the processing job id.
  uint64_t transferAcknowledged() {
    if (stage_ != CaptureStage::handoff) throw std::logic_error("no pending transfer");
    advanceEpoch(); stage_ = CaptureStage::processing; return epoch_;
  }
  bool generated(uint64_t job, std::string asset, bool qualityAccepted) {
    if (stage_ != CaptureStage::processing || job != epoch_ || asset.empty() || !qualityAccepted) return false;
    candidate_ = std::move(asset); appearance_ = {}; stage_ = CaptureStage::review; return true;
  }
  bool generationFailed(uint64_t job) {
    if (stage_ != CaptureStage::processing || job != epoch_) return false;
    stage_ = CaptureStage::capture; return true; // retry generation with a new epoch
  }
  void save() {
    if (stage_ != CaptureStage::review || candidate_.empty()) throw std::logic_error("review required");
    saved_ = candidate_; candidate_.clear(); stage_ = CaptureStage::ready;
  }
  void cancel() {
    advanceEpoch(); candidate_.clear(); observations_.clear(); appearance_ = {};
    stage_ = CaptureStage::cancelled;
  }
  // Removes references only; the host must delete encrypted files/cloud copies
  // and acknowledge that storage operation separately.
  void forget() { cancel(); saved_.clear(); stage_ = CaptureStage::prepare; }
 private:
  void advanceEpoch() {
    if (epoch_ == std::numeric_limits<uint64_t>::max()) throw std::overflow_error("capture session exhausted");
    ++epoch_;
  }
  std::vector<CaptureStep> steps_;
  CaptureSource source_;
  std::vector<CaptureObservation> observations_;
  CaptureStage stage_ = CaptureStage::prepare;
  uint64_t epoch_ = 0;
  std::string saved_, candidate_;
  CaptureRejection rejection_{};
  bool has_rejection_ = false;
  CaptureAppearance appearance_{};
};
}
