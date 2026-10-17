#include "tinycad/document/serialize.hpp"

// Plain JSON (spec 03, src/document/json.ts): the one check for reading (fromData) and writing
// (op validate), so that a write never accepts what a read refuses. nlohmann::json can hold what
// JSON cannot write back: NaN and ±∞ in a float, binary values and the "discarded" value of a
// failed parse.

namespace tinycad::document {

bool isJsonValue(const Json& v) {
  switch (v.type()) {
    case Json::value_t::null:
    case Json::value_t::string:
    case Json::value_t::boolean:
    case Json::value_t::number_integer:
    case Json::value_t::number_unsigned: return true;
    case Json::value_t::number_float: return core::isFiniteNumber(v);
    case Json::value_t::array:
      for (const Json& item : v) {
        if (!isJsonValue(item)) return false;
      }
      return true;
    case Json::value_t::object: return isJsonObject(v);
    case Json::value_t::binary:
    case Json::value_t::discarded: return false;
  }
  return false;
}

bool isJsonObject(const Json& v) {
  if (!v.is_object()) return false;
  for (const auto& item : v.items()) {
    if (!isJsonValue(item.value())) return false;
  }
  return true;
}

}  // namespace tinycad::document
