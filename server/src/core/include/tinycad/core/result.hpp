#pragma once

// Expected failures and programmer errors (decision N7 in docs/40-plan/Rozhodnutí nativního
// jádra.md), the C++ mirror of src/core/result.ts and src/core/assert.ts:
//
// - An expected failure (broken data from outside, an operation OCCT cannot do, a sketch the
//   solver cannot solve) is a value: Result<T, E> = std::expected<T, E> (C++23, libstdc++ 13).
//   Like the TS Result, never an exception.
// - A programmer error (a violated invariant, an unknown registry key, a mutator called with an
//   index out of range) throws std::logic_error via TINYCAD_ASSERT, like assert() in TS.
//
// Every area library declares `target_compile_features(<lib> PUBLIC cxx_std_23)`.

#include <expected>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>

namespace tinycad::core {

template <class T, class E>
using Result = std::expected<T, E>;

/** The failure half of a Result: `return core::fail(SomeError{...});`. */
template <class E>
[[nodiscard]] constexpr std::unexpected<std::decay_t<E>> fail(E&& error) {
  return std::unexpected<std::decay_t<E>>(std::forward<E>(error));
}

/** A violated invariant: a bug in the caller, never an expected failure. */
class AssertionError : public std::logic_error {
 public:
  using std::logic_error::logic_error;
};

}  // namespace tinycad::core

/** Throws core::AssertionError with the message when the condition does not hold. */
#define TINYCAD_ASSERT(condition, message)                                  \
  do {                                                                      \
    if (!(condition)) throw ::tinycad::core::AssertionError(std::string(message)); \
  } while (false)
