#pragma once

// Text helpers shared by every area: String.prototype.trim of TS over UTF-8 (N109). The TS client
// trims names with trim(), so the server must remove exactly the same characters.

#include <string>
#include <string_view>

namespace tinycad::core {

/**
 * String.prototype.trim of a UTF-8 string: removes the ECMAScript white space and line
 * terminators (WhiteSpace, LineTerminator: tab, LF, VT, FF, CR, space, NBSP, U+1680,
 * U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, BOM) at both ends.
 */
std::string trimJs(std::string_view text);

/** trimJs(text) == text: nothing to remove at either end. */
bool isTrimmed(std::string_view text);

}  // namespace tinycad::core
