#pragma once
#include <NitroForgePersona/HybridPersonaCaptureSpec.hpp>
#include <nitroforge/capture_session.hpp>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace margelo::nitro::nitroforge::persona {
using ::nitroforge::persona::CaptureAppearance;
using ::nitroforge::persona::CaptureSession;
using ::nitroforge::persona::CaptureSource;
using ::nitroforge::persona::CaptureStage;
using ::nitroforge::persona::CaptureStep;
using ::nitroforge::persona::CaptureQuality;
using ::nitroforge::persona::QualityGate;

class HybridPersonaCapture final : public HybridPersonaCaptureSpec {
 public:
  HybridPersonaCapture(const std::vector<std::string>& steps,
                       const std::vector<bool>& skippable, const std::string& source) {
    if (steps.size() != skippable.size())
      throw std::invalid_argument("steps and skippable must be parallel");
    std::vector<CaptureStep> captureSteps;
    captureSteps.reserve(steps.size());
    for (size_t i = 0; i < steps.size(); ++i)
      captureSteps.push_back({steps[i], skippable[i]});
    session_ = std::make_unique<CaptureSession>(std::move(captureSteps), parseSource(source));
  }
  std::string stage() override { return stageName(session_->stage()); }
  std::string source() override { return sourceName(session_->source()); }
  double start(bool permissionGranted) override {
    return epoch(session_->start(permissionGranted));
  }
  bool observe(double e, const std::string& step, const std::string& sample,
               const std::vector<std::string>& gateNames,
               const std::vector<bool>& gatePassed) override {
    if (gateNames.size() != gatePassed.size())
      throw std::invalid_argument("gate names and verdicts must be parallel");
    CaptureQuality quality;
    quality.gates.reserve(gateNames.size());
    for (size_t i = 0; i < gateNames.size(); ++i)
      quality.gates.push_back({parseGate(gateNames[i]), gatePassed[i]});
    return session_->observe(id(e), step, sample, quality);
  }
  bool observeSimple(double e, const std::string& step, const std::string& sample,
                     bool qualityAccepted) override {
    return session_->observe(id(e), step, sample, qualityAccepted);
  }
  bool skip(double e, const std::string& step) override {
    return session_->skip(id(e), step);
  }
  double generate() override { return epoch(session_->generate()); }
  double transferAcknowledged() override { return epoch(session_->transferAcknowledged()); }
  bool generated(double job, const std::string& asset, bool qualityAccepted) override {
    return session_->generated(id(job), asset, qualityAccepted);
  }
  bool generationFailed(double job) override { return session_->generationFailed(id(job)); }
  void save() override { session_->save(); }
  void cancel() override { session_->cancel(); }
  void forget() override { session_->forget(); }
  std::string savedAsset() override { return session_->savedAsset(); }
  std::string previewAsset() override { return session_->previewAsset(); }
  double observationCount() override {
    return static_cast<double>(session_->observations().size());
  }
  double appearanceWarmth() override { return session_->appearance().warmth; }
  double appearanceBrightness() override { return session_->appearance().brightness; }
  bool appearanceTouchUp() override { return session_->appearance().touchUp; }
  std::string appearanceBackgroundFill() override { return session_->appearance().backgroundFill; }
  void setAppearance(double warmth, double brightness, bool touchUp,
                     const std::string& backgroundFill) override {
    if (!std::isfinite(warmth) || !std::isfinite(brightness))
      throw std::invalid_argument("appearance values must be finite");
    session_->setAppearance({static_cast<float>(warmth), static_cast<float>(brightness),
                             touchUp, backgroundFill});
  }
  bool hasRejection() override { return session_->lastRejection() != nullptr; }
  std::string rejectionStep() override {
    const auto* r = session_->lastRejection();
    return r ? r->step : std::string{};
  }
  std::string rejectionGate() override {
    const auto* r = session_->lastRejection();
    if (!r) return std::string{};
    const auto* gate = r->quality.failedGate();
    return gate ? gateName(*gate) : std::string{};
  }
 private:
  static uint64_t id(double value) {
    if (!std::isfinite(value) || value < 0 || std::trunc(value) != value ||
        value > static_cast<double>(std::numeric_limits<uint64_t>::max()))
      throw std::invalid_argument("invalid capture epoch");
    return static_cast<uint64_t>(value);
  }
  static double epoch(uint64_t value) {
    // Epochs are sequential counters; 2^53 keeps every value exactly
    // representable as a JS number.
    if (value > (uint64_t{1} << 53)) throw std::overflow_error("capture epoch exceeds safe range");
    return static_cast<double>(value);
  }
  static CaptureSource parseSource(const std::string& name) {
    if (name == "local_device") return CaptureSource::local_device;
    if (name == "companion_phone") return CaptureSource::companion_phone;
    if (name == "supplied_media") return CaptureSource::supplied_media;
    throw std::invalid_argument("unknown capture source");
  }
  static QualityGate parseGate(const std::string& name) {
    if (name == "lighting") return QualityGate::lighting;
    if (name == "head_pose") return QualityGate::head_pose;
    if (name == "device_pose") return QualityGate::device_pose;
    if (name == "glasses") return QualityGate::glasses;
    if (name == "face_coverage") return QualityGate::face_coverage;
    throw std::invalid_argument("unknown quality gate");
  }
  static std::string stageName(CaptureStage stage) {
    switch (stage) {
      case CaptureStage::prepare: return "prepare";
      case CaptureStage::capture: return "capture";
      case CaptureStage::handoff: return "handoff";
      case CaptureStage::processing: return "processing";
      case CaptureStage::review: return "review";
      case CaptureStage::ready: return "ready";
      case CaptureStage::cancelled: return "cancelled";
    }
    return "prepare";
  }
  static std::string sourceName(CaptureSource source) {
    switch (source) {
      case CaptureSource::local_device: return "local_device";
      case CaptureSource::companion_phone: return "companion_phone";
      case CaptureSource::supplied_media: return "supplied_media";
    }
    return "local_device";
  }
  static std::string gateName(QualityGate gate) {
    switch (gate) {
      case QualityGate::lighting: return "lighting";
      case QualityGate::head_pose: return "head_pose";
      case QualityGate::device_pose: return "device_pose";
      case QualityGate::glasses: return "glasses";
      case QualityGate::face_coverage: return "face_coverage";
    }
    return "face_coverage";
  }
  std::unique_ptr<CaptureSession> session_;
};
}
