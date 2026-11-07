#pragma once
#include <algorithm>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
namespace nitroforge::persona {
enum class CaptureStage { prepare, capture, processing, review, ready, cancelled };
struct CaptureStep { std::string id; bool skippable; };
struct CaptureObservation { std::string step, sample; bool skipped; };
// Native lifecycle only. A host supplies real camera/quality evaluation, model
// generation and persistence. No progress timer or fabricated avatar is used.
class CaptureSession final {
 public:
  explicit CaptureSession(std::vector<CaptureStep> steps) : steps_(std::move(steps)) {
    if (steps_.empty()) throw std::invalid_argument("capture needs steps");
    for (size_t i = 0; i < steps_.size(); ++i) {
      if (steps_[i].id.empty()) throw std::invalid_argument("empty capture step");
      for (size_t j = 0; j < i; ++j)
        if (steps_[i].id == steps_[j].id) throw std::invalid_argument("duplicate capture step");
    }
  }
  CaptureStage stage() const { return stage_; }
  const std::string& savedAsset() const { return saved_; }
  const std::string& previewAsset() const { return candidate_; }
  const std::vector<CaptureObservation>& observations() const { return observations_; }
  const CaptureStep* currentStep() const {
    return stage_ == CaptureStage::capture && observations_.size() < steps_.size()
      ? &steps_[observations_.size()] : nullptr;
  }
  uint64_t start(bool capturePermissionGranted) {
    if (!capturePermissionGranted) throw std::runtime_error("capture permission required");
    advanceEpoch(); observations_.clear(); candidate_.clear(); stage_ = CaptureStage::capture;
    return epoch_;
  }
  // The caller carries the epoch through asynchronous camera callbacks. Quality
  // rejection does not advance the guide. Sample is an opaque host-owned handle.
  bool observe(uint64_t epoch, const std::string& step, const std::string& sample, bool qualityAccepted) {
    const auto* current = currentStep();
    if (epoch != epoch_ || !current || step != current->id || !qualityAccepted || sample.empty()) return false;
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
    advanceEpoch(); stage_ = CaptureStage::processing; return epoch_;
  }
  bool generated(uint64_t job, std::string asset, bool qualityAccepted) {
    if (stage_ != CaptureStage::processing || job != epoch_ || asset.empty() || !qualityAccepted) return false;
    candidate_ = std::move(asset); stage_ = CaptureStage::review; return true;
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
    advanceEpoch(); candidate_.clear(); observations_.clear(); stage_ = CaptureStage::cancelled;
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
  std::vector<CaptureObservation> observations_;
  CaptureStage stage_ = CaptureStage::prepare;
  uint64_t epoch_ = 0;
  std::string saved_, candidate_;
};
}
