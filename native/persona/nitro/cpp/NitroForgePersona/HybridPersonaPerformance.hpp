#pragma once
#include <NitroForgePersona/HybridPersonaPerformanceSpec.hpp>
#include <nitroforge/persona.hpp>
#include <limits>

namespace margelo::nitro::nitroforge::persona {
class HybridPersonaPerformance final : public HybridPersonaPerformanceSpec {
 public:
  HybridPersonaPerformance(double sourceCount,double targetCount,const std::vector<double>& matrix,const std::vector<double>& bias,const std::vector<double>& minimum,const std::vector<double>& maximum,double capacity,double maximumGap)
    : core_(makeCalibration(sourceCount,targetCount,matrix,bias,minimum,maximum),integer(capacity,4096),maximumGap) {}
  void append(double seconds,const std::vector<double>& weights) override {
    core_.append({seconds,floats(weights,1024)});
  }
  std::vector<double> sample(double seconds) override {
    auto result=core_.sample(seconds);return {result.begin(),result.end()};
  }
  void reset() override {core_.reset();}
  void close() override {core_.close();}
  // Native renderer can consume this core directly. The core does not import Nitro.
  ::nitroforge::persona::Performance& nativePerformance(){return core_;}
 private:
  static uint32_t integer(double n,uint32_t maximum){
    if(!std::isfinite(n)||n<1||n>maximum||std::trunc(n)!=n)throw std::invalid_argument("Invalid persona dimension");
    return static_cast<uint32_t>(n);
  }
  static std::vector<float> floats(const std::vector<double>& values,size_t limit){
    if(values.size()>limit)throw std::invalid_argument("Persona buffer exceeds limit");
    std::vector<float> result;result.reserve(values.size());
    for(double v:values){
      if(!std::isfinite(v)||std::abs(v)>std::numeric_limits<float>::max())throw std::invalid_argument("Invalid persona coefficient");
      result.push_back(static_cast<float>(v));
    }
    return result;
  }
  static ::nitroforge::persona::Calibration makeCalibration(double s,double t,const std::vector<double>& m,const std::vector<double>& b,const std::vector<double>& lo,const std::vector<double>& hi){
    const auto sources=integer(s,1024),targets=integer(t,1024);
    return {sources,targets,floats(m,size_t(sources)*targets),floats(b,targets),floats(lo,targets),floats(hi,targets)};
  }
  ::nitroforge::persona::Performance core_;
};
}
