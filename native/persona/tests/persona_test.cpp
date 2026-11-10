#include <nitroforge/persona.hpp>
#include <nitroforge/audio2x_frames.hpp>
#include <cassert>
#include <iostream>
#include <limits>
#include <thread>
using namespace nitroforge::persona;
template<class F> void rejects(F f){bool threw=false;try{f();}catch(const std::exception&){threw=true;}assert(threw);}
int main(){
 Calibration c{2,2,{1,0,0,-2},{0,0},{0,-1},{1,1}};
 Performance p(c,3,.2);
 rejects([&]{p.sample(0);});
 p.append({0,{0,0}});p.append({.1,{1,.5}});
 auto middle=p.sample(.05);assert(std::abs(middle[0]-.5)<1e-6 && std::abs(middle[1]+.5)<1e-6);
 rejects([&]{p.append({.1,{0,0}});});
 rejects([&]{p.append({.2,{std::numeric_limits<float>::quiet_NaN(),0}});});
 assert(p.sample(.1)[0]==1); // rejected inputs did not mutate
 p.append({.2,{2,-2}});assert(p.sample(.2)[0]==1&&p.sample(.2)[1]==1);
 p.append({1,{0,0}});rejects([&]{p.sample(0);});rejects([&]{p.sample(.5);});rejects([&]{p.sample(2);});
 p.reset();rejects([&]{p.sample(.1);});p.append({0,{1,0}});
 std::thread reader([&]{for(int i=0;i<1000;++i){try{p.sample(0);}catch(const std::exception&){}}});
 std::thread closer([&]{p.close();p.close();});reader.join();closer.join();rejects([&]{p.append({1,{0,0}});});rejects([&]{p.reset();});
 Performance nvidia(c,8,.2);
 Audio2XFrames ingress(nvidia,{"jawOpen","browUp"});
 ingress.append(6000,60000,{"browUp","jawOpen"},{.25f,.75f});
 assert(nvidia.sample(.1)[0]==.75f&&nvidia.sample(.1)[1]==-.5f);
 rejects([&]{ingress.append(12000,60000,{"jawOpen","jawOpen"},{0,0});});
 rejects([&]{ingress.append(12000,0,{"jawOpen","browUp"},{0,0});});
 rejects([&]{ingress.append(12000,60000,{"jawOpen","unknown"},{0,0});});
 auto invalid=c;invalid.matrix.pop_back();rejects([&]{Performance bad(invalid,2,.1);});
 invalid=c;invalid.minimum[0]=2;rejects([&]{Performance bad(invalid,2,.1);});
 rejects([&]{Performance bad(c,1,.1);});
 const Vec3 triangle[3]={{1,2,3},{3,2,3},{1,5,3}};
 BoundSplat splat{{.5,.25,.25},{0,0,.1},{{1,0,0,0,1,0,0,0,1}}};
 auto deformed=deform(splat,triangle);assert(std::abs(deformed.center.x-1.5)<1e-9&&std::abs(deformed.center.y-2.75)<1e-9&&std::abs(deformed.center.z-3.1)<1e-9);
 assert(deformed.covariance.v[0]==4&&deformed.covariance.v[4]==9&&deformed.covariance.v[8]==1);
 const Vec3 rotated[3]={{0,0,0},{0,2,0},{-3,0,0}};
 auto rotation=deform(splat,rotated);assert(rotation.covariance.v[0]==9&&rotation.covariance.v[4]==4);
 const Vec3 degenerate[3]={{0,0,0},{0,0,0},{0,0,0}};rejects([&]{deform(splat,degenerate);});
 splat.localCovariance.v[0]=-1;rejects([&]{deform(splat,triangle);});
 std::cout<<"persona: timing, calibration, rejection atomicity, eviction, lifecycle, concurrent close and splat deformation passed\n";
}
