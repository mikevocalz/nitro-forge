#pragma once
#include "nf_v1.h"
#include <stdexcept>
namespace nitroforge::native {
// The worker and JS task share ownership; the Rust pointer never reaches JS.
class TaskControl final {
 public:
 TaskControl():_task(nf_task_create()){if(!_task)throw std::runtime_error("Cannot create task");}
 ~TaskControl(){nf_task_free(_task);}
 TaskControl(const TaskControl&)=delete;TaskControl& operator=(const TaskControl&)=delete;
 void cancel()const{nf_task_cancel(_task);}double progress()const{return nf_task_progress(_task);}
 const NfTaskContext* native()const{return _task;}
 private:NfTaskContext* _task;
};
}
