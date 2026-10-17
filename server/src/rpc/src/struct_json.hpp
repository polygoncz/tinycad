#pragma once

// google.protobuf.Struct / Value / ListValue ↔ core::Json (internal to tinycad_session): the
// dynamic data of the contract (feature params, defaults, VisibleWhen values, sketch entities)
// is JSON in the domain and Struct on the wire (spec 14 "Pravidla tvaru kontraktu").
//
// Numbers: the wire has one number type (double). JSON written from it goes through
// core::numberJson, so a whole number comes out as an integer (2, not 2.0) like JSON.stringify.

#include <google/protobuf/struct.pb.h>

#include "tinycad/core/json.hpp"

namespace tinycad::session {

core::Json jsonOfValue(const google::protobuf::Value& value);
/** Always a JSON object (empty for an unset Struct). */
core::Json jsonOfStruct(const google::protobuf::Struct& value);
/** Always a JSON array. */
core::Json jsonOfList(const google::protobuf::ListValue& value);

void valueOfJson(const core::Json& json, google::protobuf::Value* out);
/** Precondition: `json` is an object (TINYCAD_ASSERT). */
void structOfJson(const core::Json& json, google::protobuf::Struct* out);
/** Precondition: `json` is an array (TINYCAD_ASSERT). */
void listOfJson(const core::Json& json, google::protobuf::ListValue* out);

}  // namespace tinycad::session
