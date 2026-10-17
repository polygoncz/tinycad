#pragma once

// Comparing the output of a runner with the expected output of a shared case (spec 13,
// "Porovnání a tolerance"; port of test/integration/shared-cases/support/compare.ts): objects by
// their keys, arrays in order, strings, booleans and null exactly, numbers within a tolerance
// chosen by the name of the nearest key.

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

namespace tinycad::testing {

/** The tolerances of a comparison; the defaults of spec 13 (Q110). */
struct Tolerance {
  /** Absolute, for numbers in general (mm, curve parameters, counts). */
  double length = 1e-6;
  /** Absolute, for numbers under the key 'angle' (rad). */
  double angle = 1e-9;
  /** Relative, for numbers under the key 'volume'. */
  double relative = 1e-6;
};

/** The defaults overridden by the `tolerance` object of a case (may be null). */
Tolerance resolveTolerance(const nlohmann::json& override);

/**
 * The first difference as `<path>: <expected> ≠ <actual>`, or nullopt when the values match.
 * Numbers under 'volume' compare relatively, under 'angle' with the angle tolerance, the rest
 * with length; an array element takes the key of its array.
 */
std::optional<std::string> firstDifference(const nlohmann::json& expected,
                                           const nlohmann::json& actual,
                                           const Tolerance& tolerance,
                                           const std::string& path = "expected");

}  // namespace tinycad::testing
