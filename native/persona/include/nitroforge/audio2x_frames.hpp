#pragma once
#include <nitroforge/persona.hpp>
#include <string>
#include <unordered_set>

namespace nitroforge::persona {
// Boundary for final Audio2X blendshape solver output (already conditioned by
// Audio2Emotion). No second emotion addition: it would double-count expressions.
// This is an ingestion adapter, NOT an NVIDIA inference implementation.
class Audio2XFrames final {
 public:
  Audio2XFrames(Performance& destination,std::vector<std::string> calibratedChannels)
      : destination_(destination), channels_(std::move(calibratedChannels)) {
    if(channels_.empty()||channels_.size()>1024)throw std::invalid_argument("Invalid Audio2X channel schema");
    std::unordered_set<std::string> seen;
    for(const auto& name:channels_)if(name.empty()||name.size()>128||!seen.insert(name).second)throw std::invalid_argument("Duplicate or invalid calibrated channel");
  }
  // Track routing belongs to the host: one instance per person/performance.
  // NVIDIA callbacks can have a rational timebase: preserve it, do not invent FPS.
  void append(int64_t timestamp,uint32_t ticksPerSecond,const std::vector<std::string>& sourceNames,const std::vector<float>& sourceValues){
    if(timestamp<0||ticksPerSecond==0||sourceNames.size()!=channels_.size()||sourceValues.size()!=sourceNames.size())throw std::invalid_argument("Invalid Audio2X frame");
    std::vector<float> ordered(channels_.size());
    std::unordered_set<std::string> seen;
    for(size_t i=0;i<sourceNames.size();++i){
      const auto& name=sourceNames[i];
      if(!seen.insert(name).second)throw std::invalid_argument("Duplicate source channel");
      auto it=std::find(channels_.begin(),channels_.end(),name);
      if(it==channels_.end())throw std::invalid_argument("Audio2X model schema differs from calibration");
      ordered[size_t(it-channels_.begin())]=sourceValues[i];
    }
    destination_.append({double(timestamp)/ticksPerSecond,std::move(ordered)});
  }
 private:
  Performance& destination_; // host must keep destination alive
  std::vector<std::string> channels_;
};
}
