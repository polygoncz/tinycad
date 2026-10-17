#pragma once

// JSON of the core value types (nlohmann::json, ADL converters) and the numeric helpers every
// reader of unchecked JSON needs. The JSON shapes are those of the TS domain, so the shared test
// cases (test/shared-cases, spec 13) read and write them unchanged.
//
// Number rules (spec 13 "Porovnání a tolerance"): JSON has one number type, nlohmann has three
// (integer, unsigned, float). Readers accept any of them; "a whole number" is any finite number
// with no fractional part (2.0 is whole, like Number.isInteger in TS). Writers write a double
// with an integral value up to 2^53 as an integer, so output matches JSON.stringify.

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"

namespace tinycad::core {

using Json = nlohmann::json;

/** A finite number (integer, unsigned or float); NaN and ±∞ are not. */
bool isFiniteNumber(const Json& v);

/** A finite number without a fractional part (Number.isInteger). */
bool isWholeNumber(const Json& v);

/** The number as a double; precondition isFiniteNumber(v). */
double numberOf(const Json& v);

/** A finite double as JSON: an integral value within ±2^53 as an integer, else a float. */
Json numberJson(double value);

/** [x, y] of two finite numbers, else nullopt. */
std::optional<Vec2> readVec2(const Json& v);
/** [x, y, z] of three finite numbers, else nullopt. */
std::optional<Vec3> readVec3(const Json& v);

/**
 * A Curve2 from JSON of the TS shape ({ kind, …, id? }), else nullopt. Shape only (finite numbers,
 * arrays of the right length); geometric rules (equal arc radii, valid knots) belong to the
 * consumer (kernel parse*Input, sketch).
 */
std::optional<Curve2> readCurve2(const Json& v);

/** JSON of the TS shape; `id` only when not empty. */
Json curve2Json(const Curve2& curve);

/** { origin, xDir, normal }. */
Json planeJson(const Plane& p);
std::optional<Plane> readPlane(const Json& v);

}  // namespace tinycad::core
