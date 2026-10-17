#include "tinycad/session/fingerprint.hpp"

#include <openssl/evp.h>

#include <array>
#include <memory>

#include <google/protobuf/descriptor.h>
#include <google/protobuf/util/json_util.h>

#include <string>
#include <utility>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/session/operation_codec.hpp"
#include "tinycad/v1/operations.pb.h"

namespace tinycad::session {

namespace pb = google::protobuf;

namespace {

/** The fields that do not make a request different (spec 14 "Idempotence", N57). */
constexpr std::array<const char*, 3> kIgnoredFields = {"session_id", "operation_id", "read"};

/** The proto3 JSON of a message (proto field names), parsed; keys come out sorted (std::map). */
core::Json protoJson(const pb::Message& message) {
  pb::util::JsonPrintOptions options;
  options.preserve_proto_field_names = true;
  std::string text;
  const auto printed = pb::util::MessageToJsonString(message, &text, options);
  TINYCAD_ASSERT(printed.ok(), "cannot print " + std::string(message.GetTypeName()) + " as JSON");
  return core::Json::parse(text);
}

/**
 * A field of type tinycad.v1.Operation as the JSON operation of spec 04; an operation the codec
 * refuses (an empty oneof) keeps its proto JSON, so even a broken request has one fingerprint.
 */
core::Json operationJson(const pb::Message& message) {
  const auto* op = dynamic_cast<const tinycad::v1::Operation*>(&message);
  TINYCAD_ASSERT(op != nullptr, "an Operation field that is not tinycad.v1.Operation");
  auto converted = operationToJson(*op);
  return converted ? *converted : protoJson(message);
}

/** N107: object of the set fields, Operation fields through the codec, sorted keys, compact. */
std::string canonicalJson(pb::Message& request) {
  const pb::Descriptor* descriptor = request.GetDescriptor();
  const pb::Reflection* reflection = request.GetReflection();
  const std::string operationType(tinycad::v1::Operation::descriptor()->full_name());

  // Operation fields are converted separately and cleared before the generic print.
  std::vector<std::pair<std::string, core::Json>> operations;
  for (int i = 0; i < descriptor->field_count(); ++i) {
    const pb::FieldDescriptor* field = descriptor->field(i);
    if (field->is_repeated() || field->cpp_type() != pb::FieldDescriptor::CPPTYPE_MESSAGE ||
        std::string(field->message_type()->full_name()) != operationType ||
        !reflection->HasField(request, field)) {
      continue;
    }
    const pb::Message& op = reflection->GetMessage(request, field);
    operations.emplace_back(std::string(field->name()), operationJson(op));
    reflection->ClearField(&request, field);
  }
  core::Json json = protoJson(request);
  for (auto& [name, op] : operations) json[name] = std::move(op);
  return json.dump();
}

}  // namespace

std::string sha256Hex(std::string_view bytes) {
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned int length = 0;
  const int ok = EVP_Digest(bytes.data(), bytes.size(), digest.data(), &length, EVP_sha256(),
                            nullptr);
  TINYCAD_ASSERT(ok == 1, "OpenSSL SHA-256 failed");

  static constexpr char kHex[] = "0123456789abcdef";
  std::string out;
  out.reserve(2 * length);
  for (unsigned int i = 0; i < length; ++i) {
    out.push_back(kHex[digest[i] >> 4]);
    out.push_back(kHex[digest[i] & 0x0f]);
  }
  return out;
}

std::string requestFingerprint(const pb::Message& request) {
  std::unique_ptr<pb::Message> copy(request.New());
  copy->CopyFrom(request);
  const pb::Descriptor* descriptor = copy->GetDescriptor();
  const pb::Reflection* reflection = copy->GetReflection();
  for (const char* name : kIgnoredFields) {
    if (const pb::FieldDescriptor* field = descriptor->FindFieldByName(name)) {
      reflection->ClearField(copy.get(), field);
    }
  }

  return sha256Hex(canonicalJson(*copy));
}

storage::OperationKey operationKey(const pb::Message& request) {
  const pb::FieldDescriptor* field = request.GetDescriptor()->FindFieldByName("operation_id");
  TINYCAD_ASSERT(field != nullptr && field->type() == pb::FieldDescriptor::TYPE_STRING,
                 "a request without operation_id: " + std::string(request.GetTypeName()));
  return {request.GetReflection()->GetString(request, field), requestFingerprint(request)};
}

}  // namespace tinycad::session
