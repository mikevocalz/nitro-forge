#pragma once
#include <NitroForgeV1/HybridForgeTaskSpec.hpp>
#include <NitroForgeV1/TaskControl.hpp>
namespace margelo::nitro::nitroforge::ignitionv1 {
class HybridForgeTask final:public HybridForgeTaskSpec {
 public:
 HybridForgeTask(std::shared_ptr<::nitroforge::native::TaskControl> control,Promise<ForgeBinaryCommandResult> result):_control(std::move(control)),_result(std::move(result)){}
 double getProgress()override{return _control->progress();}
 void cancel()override{_control->cancel();}
 Promise<ForgeBinaryCommandResult> result()override{return _result;}
 private:std::shared_ptr<::nitroforge::native::TaskControl> _control;Promise<ForgeBinaryCommandResult> _result;
};
}
