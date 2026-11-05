#include "HybridForgeFactory.hpp"
#include "HybridForgeDocument.hpp"
#include "ForgeRustSession.hpp"

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

Promise<std::shared_ptr<HybridForgeDocumentSpec>>
HybridForgeFactory::open(ForgeEngineKind kind) {
  return Promise<std::shared_ptr<HybridForgeDocumentSpec>>::async([kind]() {
    auto session = ::nitroforge::native::ForgeRustSession::open(kindName(kind));
    auto document = std::make_shared<HybridForgeDocument>(kind, std::move(session));
    return std::static_pointer_cast<HybridForgeDocumentSpec>(document);
  });
}

} // namespace margelo::nitro::nitroforge::ignitionv1
