#include "tinycad/session/fingerprint.hpp"

#include <openssl/evp.h>

#include <array>
#include <memory>

#include <google/protobuf/descriptor.h>
#include <google/protobuf/io/coded_stream.h>
#include <google/protobuf/io/zero_copy_stream_impl_lite.h>

#include "tinycad/core/result.hpp"

namespace tinycad::session {

namespace pb = google::protobuf;

namespace {

/** The fields that do not make a request different (spec 14 "Idempotence", N57). */
constexpr std::array<const char*, 3> kIgnoredFields = {"session_id", "operation_id", "read"};

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

  // Deterministic: map entries (Struct fields of params) sorted by key, so equal requests give
  // equal bytes within one build of the server.
  std::string bytes;
  {
    pb::io::StringOutputStream stream(&bytes);
    pb::io::CodedOutputStream coded(&stream);
    coded.SetSerializationDeterministic(true);
    copy->SerializeToCodedStream(&coded);
  }
  return sha256Hex(bytes);
}

storage::OperationKey operationKey(const pb::Message& request) {
  const pb::FieldDescriptor* field = request.GetDescriptor()->FindFieldByName("operation_id");
  TINYCAD_ASSERT(field != nullptr && field->type() == pb::FieldDescriptor::TYPE_STRING,
                 "a request without operation_id: " + std::string(request.GetTypeName()));
  return {request.GetReflection()->GetString(request, field), requestFingerprint(request)};
}

}  // namespace tinycad::session
