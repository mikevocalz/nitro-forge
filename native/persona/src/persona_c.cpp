#include <nitroforge/persona.h>
#include <nitroforge/persona.hpp>
#include <memory>
struct nf_persona {
 nitroforge::persona::Performance value; uint32_t source,target;
 nf_persona(nitroforge::persona::Calibration c,uint32_t cap,double gap):value(c,cap,gap),source(c.sourceCount),target(c.targetCount){}
};
namespace {
template<class F> nf_persona_status protect(F f) noexcept {
 try{f();return NF_PERSONA_OK;}catch(const std::invalid_argument&){return NF_PERSONA_INVALID;}catch(const std::out_of_range&){return NF_PERSONA_NO_COVERAGE;}catch(...){return NF_PERSONA_FAILED;}
}
}
extern "C" {
nf_persona_status nf_persona_create(uint32_t s,uint32_t t,const float* m,const float* b,const float* lo,const float* hi,uint32_t cap,double gap,nf_persona** out){
 if(!out)return NF_PERSONA_INVALID;
 *out=nullptr;
 if(!m||!b||!lo||!hi||s==0||s>1024||t==0||t>1024)return NF_PERSONA_INVALID;
 return protect([&]{nitroforge::persona::Calibration c{s,t,{m,m+size_t(s)*t},{b,b+t},{lo,lo+t},{hi,hi+t}};*out=new nf_persona(std::move(c),cap,gap);});
}
nf_persona_status nf_persona_append(nf_persona* p,double seconds,const float* w,uint32_t count){
 if(!p||!w||count!=p->source)return NF_PERSONA_INVALID;
 return protect([&]{p->value.append({seconds,{w,w+count}});});
}
nf_persona_status nf_persona_sample(nf_persona* p,double seconds,float* out,uint32_t count){
 if(!p||!out||count!=p->target)return NF_PERSONA_INVALID;
 return protect([&]{auto values=p->value.sample(seconds);std::copy(values.begin(),values.end(),out);});
}
nf_persona_status nf_persona_reset(nf_persona* p){if(!p)return NF_PERSONA_INVALID;return protect([&]{p->value.reset();});}
nf_persona_status nf_persona_close(nf_persona* p){if(!p)return NF_PERSONA_INVALID;return protect([&]{p->value.close();});}
void nf_persona_destroy(nf_persona* p){delete p;}
}
