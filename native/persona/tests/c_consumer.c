#include <nitroforge/persona.h>
#include <assert.h>
#include <math.h>
int main(void){
 float matrix[1]={2},bias[1]={0},lo[1]={0},hi[1]={1},w[1]={.25f},out[1]={-7};nf_persona* p=0;
 assert(nf_persona_create(1,1,matrix,bias,lo,hi,4,.2,&p)==NF_PERSONA_OK);
 assert(nf_persona_append(p,0,w,1)==NF_PERSONA_OK);w[0]=.5f;
 assert(nf_persona_append(p,.1,w,1)==NF_PERSONA_OK);w[0]=0; // copied, not retained
 assert(nf_persona_sample(p,.05,out,1)==NF_PERSONA_OK&&fabsf(out[0]-.75f)<.00001f);
 out[0]=-7;assert(nf_persona_sample(p,.5,out,1)==NF_PERSONA_NO_COVERAGE&&out[0]==-7);
 assert(nf_persona_sample(p,0,out,0)==NF_PERSONA_INVALID);
 assert(nf_persona_close(p)==NF_PERSONA_OK);assert(nf_persona_close(p)==NF_PERSONA_OK);
 assert(nf_persona_sample(p,0,out,1)==NF_PERSONA_FAILED);nf_persona_destroy(p);nf_persona_destroy(0);
 assert(nf_persona_create(0,1,matrix,bias,lo,hi,4,.2,&p)==NF_PERSONA_INVALID&&p==0);
 return 0;
}
