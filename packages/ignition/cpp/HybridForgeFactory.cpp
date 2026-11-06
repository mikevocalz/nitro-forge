#include <NitroForgeV1/HybridForgeMediaCache.hpp>
#include <cmath>
#include <NitroForgeV1/HybridForgeFactory.hpp>
#include <NitroForgeV1/HybridForgeDocument.hpp>
#include <NitroForgeV1/ForgeRustSession.hpp>

#include <stdexcept>
#include <string_view>
#include <utility>

namespace margelo::nitro::nitroforge::ignitionv1 {
namespace {

std::string_view kindName(ForgeEngineKind kind) {
  switch (kind) {
    case ForgeEngineKind::PRISM: return "prism";
    case ForgeEngineKind::CADENCE: return "cadence";
    case ForgeEngineKind::SPLICE: return "splice";
    case ForgeEngineKind::FOLIO: return "folio";
    case ForgeEngineKind::PITCH: return "pitch";
    case ForgeEngineKind::TALLY: return "tally";
    case ForgeEngineKind::QUILL: return "quill";
  }
  throw std::invalid_argument("Unknown NitroForge engine kind");
}

} // namespace

std::shared_ptr<HybridForgeMediaCacheSpec> HybridForgeFactory::createMediaCache(double capacity){
 if(!std::isfinite(capacity)||capacity<1||capacity>256u*1024u*1024u||std::trunc(capacity)!=capacity)throw std::invalid_argument("Cache capacity must be an integer 1..256 MiB");
 return std::make_shared<HybridForgeMediaCache>(static_cast<size_t>(capacity));
}

Promise<std::shared_ptr<HybridForgeDocumentSpec>>
HybridForgeFactory::open(ForgeEngineKind kind) {
  return Promise<std::shared_ptr<HybridForgeDocumentSpec>>::async([kind]() {
    auto session = ::nitroforge::native::ForgeRustSession::open(kindName(kind));
    auto document = std::make_shared<HybridForgeDocument>(kind, std::move(session));
    return std::static_pointer_cast<HybridForgeDocumentSpec>(document);
  });
}

} // namespace margelo::nitro::nitroforge::ignitionv1
