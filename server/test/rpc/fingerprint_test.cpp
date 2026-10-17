// The request fingerprint of idempotence (spec 14 "Idempotence", N57).

#include "tinycad/rpc/fingerprint.hpp"

#include <gtest/gtest.h>

#include "tinycad/v1/session.pb.h"

namespace tinycad::rpc {
namespace {

namespace v1 = tinycad::v1;

v1::DispatchRequest aDispatch() {
  v1::DispatchRequest request;
  request.set_session_id("s1");
  request.set_operation_id("op-1");
  request.set_label("Rename");
  request.mutable_op()->mutable_feature_rename()->set_feature_id("f1");
  request.mutable_op()->mutable_feature_rename()->set_name("Base");
  return request;
}

TEST(Sha256Hex, MatchesTheKnownVectors) {
  EXPECT_EQ(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  EXPECT_EQ(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST(RequestFingerprint, IsLowercaseHexOf64Characters) {
  const std::string fingerprint = requestFingerprint(aDispatch());
  EXPECT_EQ(fingerprint.size(), 64u);
  EXPECT_EQ(fingerprint.find_first_not_of("0123456789abcdef"), std::string::npos);
}

TEST(RequestFingerprint, IgnoresSessionOperationIdAndReadOptions) {
  const std::string base = requestFingerprint(aDispatch());

  v1::DispatchRequest other = aDispatch();
  other.set_session_id("s2");
  other.set_operation_id("op-2");
  other.mutable_read()->add_known_meshes("1-1.7");
  other.mutable_read()->set_input_of("f1");
  EXPECT_EQ(requestFingerprint(other), base);
}

TEST(RequestFingerprint, DependsOnTheOperationAndTheLabel) {
  const std::string base = requestFingerprint(aDispatch());

  v1::DispatchRequest otherOp = aDispatch();
  otherOp.mutable_op()->mutable_feature_rename()->set_name("Top");
  EXPECT_NE(requestFingerprint(otherOp), base);

  v1::DispatchRequest otherLabel = aDispatch();
  otherLabel.set_label("Other");
  EXPECT_NE(requestFingerprint(otherLabel), base);
}

TEST(RequestFingerprint, IsIndependentOfTheOrderParamsWereWritten) {
  v1::ApplyRequest a;
  auto* fieldsA = a.mutable_op()->mutable_feature_set_params()->mutable_params()->mutable_fields();
  (*fieldsA)["width"].set_number_value(1);
  (*fieldsA)["depth"].set_number_value(2);
  v1::ApplyRequest b;
  auto* fieldsB = b.mutable_op()->mutable_feature_set_params()->mutable_params()->mutable_fields();
  (*fieldsB)["depth"].set_number_value(2);
  (*fieldsB)["width"].set_number_value(1);
  EXPECT_EQ(requestFingerprint(a), requestFingerprint(b));
}

TEST(RequestFingerprint, IsTheSha256OfTheCanonicalJsonWithTheOperationOfSpec04) {
  // N107: proto field names, the operation as the JSON of spec 04, keys sorted, no white space.
  EXPECT_EQ(requestFingerprint(aDispatch()),
            sha256Hex(R"({"label":"Rename","op":{"featureId":"f1","name":"Base",)"
                      R"("type":"feature.rename","v":1}})"));
}

TEST(RequestFingerprint, WritesWholeNumbersOfParamsAsIntegers) {
  v1::ApplyRequest request;
  request.set_operation_id("op-1");
  auto* setParams = request.mutable_op()->mutable_feature_set_params();
  setParams->set_feature_id("f1");
  setParams->set_type_version(1);
  (*setParams->mutable_params()->mutable_fields())["width"].set_number_value(2);
  (*setParams->mutable_params()->mutable_fields())["depth"].set_number_value(0.5);
  EXPECT_EQ(requestFingerprint(request),
            sha256Hex(R"({"op":{"featureId":"f1","params":{"depth":0.5,"width":2},)"
                      R"("type":"feature.setParams","typeVersion":1,"v":2}})"));
}

TEST(RequestFingerprint, AnOperationTheCodecRefusesStillHasAFingerprint) {
  v1::ApplyRequest empty;
  empty.mutable_op();
  v1::ApplyRequest other;
  EXPECT_EQ(requestFingerprint(empty).size(), 64u);
  EXPECT_NE(requestFingerprint(empty), requestFingerprint(other));
}

TEST(RequestFingerprint, DoesNotChangeTheRequest) {
  const v1::DispatchRequest request = aDispatch();
  (void)requestFingerprint(request);
  EXPECT_EQ(request.session_id(), "s1");
  EXPECT_EQ(request.operation_id(), "op-1");
}

TEST(OperationKey, TakesTheIdAndTheFingerprint) {
  const storage::OperationKey key = operationKey(aDispatch());
  EXPECT_EQ(key.id, "op-1");
  EXPECT_EQ(key.fingerprint, requestFingerprint(aDispatch()));
}

TEST(OperationKey, ARequestWithoutOperationIdIsAProgrammerError) {
  EXPECT_THROW((void)operationKey(v1::GetReadModelRequest()), core::AssertionError);
}

}  // namespace
}  // namespace tinycad::rpc
