#pragma once

#include <NativeModules.h>
#include <string>
#include <vector>

namespace nitroforge::windows {

REACT_STRUCT(ApplyRequest)
struct ApplyRequest final {
  REACT_FIELD(documentId)
  std::string documentId;
  REACT_FIELD(operation)
  std::string operation;
  REACT_FIELD(payloadJson)
  std::string payloadJson;
  REACT_FIELD(version)
  double version{1};
};

REACT_STRUCT(CommandEvent)
struct CommandEvent final {
  REACT_FIELD(kind)
  std::string kind;
  REACT_FIELD(detailJson)
  std::string detailJson;
};

REACT_STRUCT(CommandReply)
struct CommandReply final {
  REACT_FIELD(dataJson)
  std::string dataJson;
  REACT_FIELD(events)
  std::vector<CommandEvent> events;
};

} // namespace nitroforge::windows
