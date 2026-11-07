// Isolated proof only; no Forge native module or production processing contract.
#include <libraw/libraw.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

static void check(int code, const char* stage) {
  if (code != LIBRAW_SUCCESS) throw std::runtime_error(std::string(stage)+": "+libraw_strerror(code));
}
static std::string quoted(const char* input) {
  std::string out="\"";
  for (const unsigned char ch : std::string(input)) {
    if (ch == '"' || ch == '\\') out += '\\';
    if (ch >= 32) out += static_cast<char>(ch);
  }
  return out+'"';
}
int main(int argc, char** argv) {
  try {
    if(argc != 3) throw std::runtime_error("usage: decode input.raw output.ppm");
    std::ifstream input(argv[1],std::ios::binary|std::ios::ate);
    const auto length=input.tellg();
    if(!input || length<=0 || length>64*1024*1024) throw std::runtime_error("input must be 1..64 MiB");
    std::vector<char> bytes(static_cast<size_t>(length));
    input.seekg(0); input.read(bytes.data(),length);
    if(!input) throw std::runtime_error("input read failed");
    // LibRaw and its input buffer share this exclusive synchronous owner thread.
    LibRaw raw;
    raw.imgdata.rawparams.max_raw_memory_mb=256;
    check(raw.open_buffer(bytes.data(),bytes.size()),"probe");
    const auto& size=raw.imgdata.sizes;
    if(!size.raw_width || !size.raw_height || uint64_t(size.raw_width)*size.raw_height>40000000)
      throw std::runtime_error("raw dimensions exceed prototype pixel budget");
    check(raw.unpack(),"unpack");
    const auto width=size.raw_width,height=size.raw_height;
    if(!width || !height || uint64_t(width)*height>40000000)
      throw std::runtime_error("unpacked RAW dimensions exceed prototype pixel budget");
    if(!raw.imgdata.rawdata.raw_image) throw std::runtime_error("prototype requires Bayer raw plane");
    const auto pitch=raw.imgdata.sizes.raw_pitch;
    if(pitch<uint64_t(width)*sizeof(unsigned short) || pitch%sizeof(unsigned short)!=0)
      throw std::runtime_error("invalid decoded RAW row pitch");
    const size_t row_samples=pitch/sizeof(unsigned short);
    uint64_t nonzero=0;
    for(size_t row=0;row<height;++row)
      for(size_t col=0;col<width;++col)
        nonzero += raw.imgdata.rawdata.raw_image[row*row_samples+col]!=0;
    if(!nonzero) throw std::runtime_error("decoded raw plane is empty");
    raw.imgdata.params.half_size=1;
    raw.imgdata.params.output_bps=8;
    raw.imgdata.params.output_color=1;
    raw.imgdata.params.use_camera_wb=1;
    check(raw.dcraw_process(),"basic preview processing");
    int error=0;
    auto free_image=[](libraw_processed_image_t* p){LibRaw::dcraw_clear_mem(p);};
    std::unique_ptr<libraw_processed_image_t,decltype(free_image)> image(raw.dcraw_make_mem_image(&error),free_image);
    check(error,"memory preview");
    if(!image || image->type!=LIBRAW_IMAGE_BITMAP || image->colors!=3 || image->bits!=8 ||
       image->data_size!=uint64_t(image->width)*image->height*3)
      throw std::runtime_error("unexpected preview format");
    std::ofstream output(argv[2],std::ios::binary);
    output<<"P6\n"<<image->width<<' '<<image->height<<"\n255\n";
    output.write(reinterpret_cast<const char*>(image->data),image->data_size);
    output.close(); if(!output) throw std::runtime_error("preview write failed");
    std::cout<<"{\"libraw\":"<<quoted(LibRaw::version())<<",\"make\":"<<quoted(raw.imgdata.idata.make)
      <<",\"model\":"<<quoted(raw.imgdata.idata.model)<<",\"raw_width\":"<<width<<",\"raw_height\":"<<height
      <<",\"raw_pitch_bytes\":"<<pitch<<",\"raw_nonzero_samples\":"<<nonzero<<",\"preview_width\":"<<image->width<<",\"preview_height\":"<<image->height
      <<",\"preview_rgb_bytes\":"<<image->data_size<<"}\n";
    return 0;
  } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
