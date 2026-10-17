#pragma once

#include <string>
#include <string_view>

namespace tinycad::storage {

/**
 * String.prototype.trim of a UTF-8 string: removes the ECMAScript white space and line
 * terminators at both ends, the same set the document.rename handler refuses (M40), so a trimmed
 * name always passes it.
 */
std::string trimName(std::string_view name);

}  // namespace tinycad::storage
