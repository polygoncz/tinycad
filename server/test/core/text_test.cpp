// trimJs and isTrimmed: String.prototype.trim of TS over UTF-8 (N109).

#include "tinycad/core/text.hpp"

#include <gtest/gtest.h>

#include <string>

namespace tinycad::core {
namespace {

TEST(TrimJs, RemovesAsciiWhiteSpaceAndLineTerminatorsAtBothEnds) {
  EXPECT_EQ(trimJs(" \t\n\v\f\rName \r\n"), "Name");
  EXPECT_EQ(trimJs("  a b  "), "a b");
  EXPECT_EQ(trimJs(""), "");
  EXPECT_EQ(trimJs(" \t "), "");
}

TEST(TrimJs, RemovesTheUnicodeWhiteSpaceOfEcmaScript) {
  // NBSP, U+1680, U+2000, U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, BOM.
  const std::string spaces =
      "\xC2\xA0\xE1\x9A\x80\xE2\x80\x80\xE2\x80\x8A\xE2\x80\xA8\xE2\x80\xA9\xE2\x80\xAF"
      "\xE2\x81\x9F\xE3\x80\x80\xEF\xBB\xBF";
  EXPECT_EQ(trimJs(spaces + "D\xC3\xADl" + spaces), "D\xC3\xADl");
}

TEST(TrimJs, KeepsWhatTrimKeeps) {
  // U+200B (zero width space) and U+0085 (next line) are not white space in ECMAScript.
  EXPECT_EQ(trimJs("\xE2\x80\x8B" "a"), "\xE2\x80\x8B" "a");
  EXPECT_EQ(trimJs("a\xC2\x85"), "a\xC2\x85");
  EXPECT_EQ(trimJs("a \xC2\xA0 b"), "a \xC2\xA0 b");
}

TEST(IsTrimmed, IsTrueExactlyWhenTrimJsChangesNothing) {
  for (const std::string text : {"", "a", "a b", " a", "a ", "\xC2\xA0" "a", "a\xE3\x80\x80",
                                 "\xE2\x80\x8B" "a"}) {
    EXPECT_EQ(isTrimmed(text), trimJs(text) == text) << text;
  }
}

}  // namespace
}  // namespace tinycad::core
