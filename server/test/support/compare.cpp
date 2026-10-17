#include "support/compare.hpp"

#include <cmath>
#include <regex>

namespace tinycad::testing {

namespace {

using nlohmann::json;

std::string pathOf(const std::string& parent, const std::string& key) {
  static const std::regex identifier("^[A-Za-z_$][A-Za-z0-9_$]*$");
  return std::regex_match(key, identifier) ? parent + "." + key
                                           : parent + "[" + json(key).dump() + "]";
}

bool numbersMatch(double expected, double actual, const Tolerance& tolerance,
                  const std::string& key) {
  const double delta = std::abs(expected - actual);
  if (key == "volume") return delta <= tolerance.relative * std::abs(expected);
  if (key == "angle") return delta <= tolerance.angle;
  return delta <= tolerance.length;
}

std::optional<std::string> differenceAt(const json& expected, const json& actual,
                                        const Tolerance& tolerance, const std::string& path,
                                        const std::string& key) {
  const auto differs = [&] { return path + ": " + expected.dump() + " ≠ " + actual.dump(); };
  if (expected.is_number() && actual.is_number()) {
    if (numbersMatch(expected.get<double>(), actual.get<double>(), tolerance, key)) {
      return std::nullopt;
    }
    return differs();
  }
  if (expected.is_array() && actual.is_array()) {
    if (expected.size() != actual.size()) {
      return path + ": length " + std::to_string(expected.size()) +
             " ≠ " + std::to_string(actual.size());
    }
    for (std::size_t i = 0; i < expected.size(); ++i) {
      if (auto found = differenceAt(expected[i], actual[i], tolerance,
                                    path + "[" + std::to_string(i) + "]", key)) {
        return found;
      }
    }
    return std::nullopt;
  }
  if (expected.is_object() && actual.is_object()) {
    for (const auto& [k, value] : expected.items()) {
      if (!actual.contains(k)) return pathOf(path, k) + ": missing in the actual value";
      if (auto found = differenceAt(value, actual.at(k), tolerance, pathOf(path, k), k)) {
        return found;
      }
    }
    for (const auto& [k, value] : actual.items()) {
      if (!expected.contains(k)) return pathOf(path, k) + ": unexpected key";
    }
    return std::nullopt;
  }
  // Strings, booleans and null exactly; values of different types never match.
  return expected == actual ? std::nullopt : std::optional<std::string>(differs());
}

}  // namespace

Tolerance resolveTolerance(const json& override) {
  Tolerance tolerance;
  if (!override.is_object()) return tolerance;
  if (override.contains("length")) tolerance.length = override.at("length").get<double>();
  if (override.contains("angle")) tolerance.angle = override.at("angle").get<double>();
  if (override.contains("relative")) tolerance.relative = override.at("relative").get<double>();
  return tolerance;
}

std::optional<std::string> firstDifference(const json& expected, const json& actual,
                                           const Tolerance& tolerance, const std::string& path) {
  return differenceAt(expected, actual, tolerance, path, "");
}

}  // namespace tinycad::testing
