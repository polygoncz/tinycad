// Port of test/unit/document/json.test.ts: plain JSON for reading and writing. The JavaScript
// specific cases (undefined, Date, Map, holes) have no C++ counterpart; what nlohmann::json can
// hold but JSON cannot write back (NaN, ±∞, binary, discarded) must be refused.

#include <gtest/gtest.h>

#include <cmath>
#include <limits>

#include "tinycad/document/serialize.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::isJsonObject;
using document::isJsonValue;

TEST(IsJsonValue, AcceptsPlainJson) {
  EXPECT_TRUE(isJsonValue(Json(nullptr)));
  EXPECT_TRUE(isJsonValue(Json("")));
  EXPECT_TRUE(isJsonValue(Json(true)));
  EXPECT_TRUE(isJsonValue(Json(0)));
  EXPECT_TRUE(isJsonValue(Json(-0.0)));
  EXPECT_TRUE(isJsonValue(Json(-12.5)));
  EXPECT_TRUE(isJsonValue(Json(18446744073709551615ULL)));
  EXPECT_TRUE(isJsonValue(Json::array()));
  EXPECT_TRUE(isJsonValue(Json::object()));
  EXPECT_TRUE(isJsonValue(Json::parse(R"({"a":[1,"x",null,{"b":[true]}],"c":{"d":{}}})")));
}

TEST(IsJsonValue, RefusesNaNAndInfinityAnywhere) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  EXPECT_FALSE(isJsonValue(Json(nan)));
  EXPECT_FALSE(isJsonValue(Json(inf)));
  EXPECT_FALSE(isJsonValue(Json(-inf)));
  EXPECT_FALSE(isJsonValue(Json{{"list", Json::array({Json{{"v", nan}}})}}));
  EXPECT_FALSE(isJsonValue(Json::array({Json::array({Json::array({inf})})})));
}

TEST(IsJsonValue, RefusesBinaryAndDiscarded) {
  EXPECT_FALSE(isJsonValue(Json::binary({1, 2, 3})));
  EXPECT_FALSE(isJsonValue(Json(Json::value_t::discarded)));
}

TEST(IsJsonObject, AcceptsAPlainJsonObjectOnly) {
  EXPECT_TRUE(isJsonObject(Json{{"width", 10}, {"origin", {0, 0, 0}}}));
  EXPECT_TRUE(isJsonObject(Json::object()));
  EXPECT_FALSE(isJsonObject(Json::array()));
  EXPECT_FALSE(isJsonObject(Json(nullptr)));
  EXPECT_FALSE(isJsonObject(Json("x")));
  EXPECT_FALSE(isJsonObject(Json{{"size", std::nan("")}}));
  EXPECT_FALSE(isJsonObject(Json{{"size", -std::numeric_limits<double>::infinity()}}));
}

TEST(IsJsonObject, ChecksHundredsOfSketchEntitiesWithoutTrouble) {
  Json entities = Json::array();
  for (int i = 0; i < 2000; ++i) {
    entities.push_back(Json{{"id", "p" + std::to_string(i)}, {"kind", "point"}, {"x", i}, {"y", 0.5}});
  }
  EXPECT_TRUE(isJsonObject(Json{{"entities", entities}}));
}

}  // namespace
}  // namespace tinycad::testing
