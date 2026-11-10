#include <nitroforge/persona.hpp>
#include <limits>
namespace nitroforge::persona {
namespace {
void require(bool ok, const char* message) { if (!ok) throw std::invalid_argument(message); }
bool finite(const std::vector<float>& v) { return std::all_of(v.begin(),v.end(),[](float x){return std::isfinite(x);}); }
Vec3 sub(Vec3 a,Vec3 b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
Vec3 cross(Vec3 a,Vec3 b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
}
void Calibration::validate() const {
  require(sourceCount>0 && sourceCount<=1024 && targetCount>0 && targetCount<=1024,"Control count outside 1..1024");
  require(matrix.size()==size_t(sourceCount)*targetCount && bias.size()==targetCount && minimum.size()==targetCount && maximum.size()==targetCount,"Invalid calibration dimensions");
  require(finite(matrix)&&finite(bias)&&finite(minimum)&&finite(maximum),"Non-finite calibration");
  for(size_t i=0;i<targetCount;++i) require(minimum[i]<=maximum[i],"Invalid target range");
}
std::vector<float> Calibration::map(const std::vector<float>& source) const {
  validate();
  require(source.size()==sourceCount && finite(source),"Invalid source controls");
  std::vector<float> result(targetCount);
  for(size_t i=0;i<targetCount;++i){
    double value=bias[i];
    for(size_t j=0;j<sourceCount;++j) value+=double(matrix[i*sourceCount+j])*source[j];
    result[i]=float(std::clamp(value,double(minimum[i]),double(maximum[i])));
  }
  return result;
}
Performance::Performance(Calibration calibration,size_t capacity,double maximumGap)
 :calibration_(std::move(calibration)),capacity_(capacity),maximumGap_(maximumGap){
  calibration_.validate();
  require(capacity>=2 && capacity<=4096,"Capacity outside 2..4096");
  require(std::isfinite(maximumGap)&&maximumGap>0&&maximumGap<=10,"Invalid maximum gap");
}
void Performance::append(const Frame& frame){
  require(std::isfinite(frame.seconds)&&frame.seconds>=0,"Invalid timestamp");
  auto mapped=calibration_.map(frame.weights);
  std::lock_guard<std::mutex> lock(mutex_);
  if(closed_)throw std::runtime_error("Persona session closed");
  require(frames_.empty()||frame.seconds>frames_.back().seconds,"Frame timestamps must increase; reset for a new clip");
  frames_.push_back({frame.seconds,std::move(mapped)});
  if(frames_.size()>capacity_)frames_.pop_front();
}
std::vector<float> Performance::sample(double seconds) const {
  require(std::isfinite(seconds)&&seconds>=0,"Invalid playback time");
  std::lock_guard<std::mutex> lock(mutex_);
  if(closed_)throw std::runtime_error("Persona session closed");
  if(frames_.empty()||seconds<frames_.front().seconds||seconds>frames_.back().seconds)throw std::out_of_range("No frame coverage at playback time");
  auto after=std::lower_bound(frames_.begin(),frames_.end(),seconds,[](const Frame& f,double t){return f.seconds<t;});
  if(after->seconds==seconds)return after->weights;
  const auto& before=*std::prev(after);
  if(after->seconds-before.seconds>maximumGap_)throw std::out_of_range("Performance gap exceeds limit");
  const double mix=(seconds-before.seconds)/(after->seconds-before.seconds);
  auto result=before.weights;
  for(size_t i=0;i<result.size();++i)result[i]=float(double(result[i])*(1-mix)+double(after->weights[i])*mix);
  return result;
}
void Performance::reset(){std::lock_guard<std::mutex> lock(mutex_);if(closed_)throw std::runtime_error("Persona session closed");frames_.clear();}
void Performance::close(){std::lock_guard<std::mutex> lock(mutex_);closed_=true;frames_.clear();}
DeformedSplat deform(const BoundSplat& splat,const Vec3 (&triangle)[3]){
  for(const auto& p:triangle)require(std::isfinite(p.x)&&std::isfinite(p.y)&&std::isfinite(p.z),"Non-finite triangle");
  double total=0;for(double b:splat.barycentric){require(std::isfinite(b)&&b>=0&&b<=1,"Invalid barycentric weight");total+=b;}
  require(std::abs(total-1)<1e-6,"Barycentric weights must sum to one");
  const auto& o=splat.localOffset;require(std::isfinite(o.x)&&std::isfinite(o.y)&&std::isfinite(o.z),"Non-finite offset");
  const auto& c=splat.localCovariance.v;
  for(double v:c)require(std::isfinite(v),"Non-finite covariance");
  require(c[1]==c[3]&&c[2]==c[6]&&c[5]==c[7],"Covariance must be symmetric");
  // Positive definite covariance, checked by Cholesky without determinant overflow.
  require(c[0]>0,"Invalid covariance");
  const double l00=std::sqrt(c[0]),l10=c[3]/l00,l20=c[6]/l00;
  const double d11=c[4]-l10*l10;require(std::isfinite(d11)&&d11>0,"Invalid covariance");
  const double l21=(c[7]-l20*l10)/std::sqrt(d11),d22=c[8]-l20*l20-l21*l21;
  require(std::isfinite(d22)&&d22>0,"Invalid covariance");
  auto e1=sub(triangle[1],triangle[0]),e2=sub(triangle[2],triangle[0]),n=cross(e1,e2);
  double length=std::hypot(n.x,n.y,n.z);require(std::isfinite(length)&&length>1e-12,"Degenerate triangle");
  n={n.x/length,n.y/length,n.z/length};
  const double basis[9]={e1.x,e2.x,n.x,e1.y,e2.y,n.y,e1.z,e2.z,n.z};
  DeformedSplat out{};
  out.center={triangle[0].x*splat.barycentric[0]+triangle[1].x*splat.barycentric[1]+triangle[2].x*splat.barycentric[2]+basis[0]*o.x+basis[1]*o.y+basis[2]*o.z,
              triangle[0].y*splat.barycentric[0]+triangle[1].y*splat.barycentric[1]+triangle[2].y*splat.barycentric[2]+basis[3]*o.x+basis[4]*o.y+basis[5]*o.z,
              triangle[0].z*splat.barycentric[0]+triangle[1].z*splat.barycentric[1]+triangle[2].z*splat.barycentric[2]+basis[6]*o.x+basis[7]*o.y+basis[8]*o.z};
  for(int i=0;i<3;++i)for(int j=0;j<3;++j)for(int k=0;k<3;++k)for(int l=0;l<3;++l)out.covariance.v[i*3+j]+=basis[i*3+k]*c[k*3+l]*basis[j*3+l];
  require(std::isfinite(out.center.x)&&std::isfinite(out.center.y)&&std::isfinite(out.center.z),"Deformation overflow");
  for(double v:out.covariance.v)require(std::isfinite(v),"Covariance overflow");
  return out;
}
}
