#ifndef NITROFORGE_PERSONA_H
#define NITROFORGE_PERSONA_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct nf_persona nf_persona;
typedef enum nf_persona_status { NF_PERSONA_OK=0, NF_PERSONA_INVALID=1, NF_PERSONA_NO_COVERAGE=2, NF_PERSONA_FAILED=3 } nf_persona_status;
/* Callers own all input/output storage. Input is copied before return.
 * matrix: target_count rows by source_count columns; all other arrays target_count.
 * App must supply an asset/model-version-specific calibration, never index-copy
 * NVIDIA or ARKit coefficients into GNM. Destroy after joining all caller threads.
 * sample needs target_count writable floats. No exception crosses this C ABI. */
nf_persona_status nf_persona_create(uint32_t source_count,uint32_t target_count,const float* matrix,const float* bias,const float* minimum,const float* maximum,uint32_t capacity,double maximum_gap,nf_persona** out);
nf_persona_status nf_persona_append(nf_persona*,double seconds,const float* weights,uint32_t count);
nf_persona_status nf_persona_sample(nf_persona*,double seconds,float* output,uint32_t count);
nf_persona_status nf_persona_reset(nf_persona*);
nf_persona_status nf_persona_close(nf_persona*);
void nf_persona_destroy(nf_persona*);
#ifdef __cplusplus
}
#endif
#endif
