#include "revolve/schema.hpp"

#include <numbers>

namespace tinycad::features {

namespace {

using document::ParamKind;
using document::ParamSchema;
using document::ParamSpec;

constexpr double kFullTurn = 2 * std::numbers::pi;

ParamSchema revolveParams() {
  ParamSpec axis;
  axis.kind = ParamKind::Axis;
  axis.label = "revolve.axis";

  ParamSpec targets = referenceList(ParamKind::Bodies, "revolve.targets", 1);
  targets.group = "revolve.group.merge";
  // p.operation !== 'new' (equals_none: a missing operation shows).
  targets.visibleWhen = whenNone("operation", {"new"});

  ParamSpec angle;
  angle.kind = ParamKind::Angle;
  angle.label = "revolve.angle";
  angle.defaultValue = kFullTurn;
  angle.min = 0.0;
  angle.exclusiveMin = true;
  angle.max = kFullTurn;

  // flipApplies: a finite number below a full turn; at a full turn both directions are the same.
  ParamSpec flip = booleanParam("revolve.flip", false);
  document::VisibleWhen belowFullTurn;
  belowFullTurn.param = "angle";
  belowFullTurn.test = document::VisibleWhen::Test::LessThan;
  belowFullTurn.limit = kFullTurn - 1e-9;
  flip.visibleWhen = belowFullTurn;

  return {{"regions", referenceList(ParamKind::Region, "revolve.regions", 1)},
          {"axis", axis},
          {"operation", enumParam("revolve.operation", "new",
                                  {{"new", "revolve.operation.new"},
                                   {"add", "revolve.operation.add"},
                                   {"remove", "revolve.operation.remove"},
                                   {"intersect", "revolve.operation.intersect"}})},
          {"targets", targets},
          {"angle", angle},
          {"flip", flip}};
}

}  // namespace

RevolveSchema::RevolveSchema()
    : BuiltInSchema("revolve", 1, "revolve.label", "rotate-360", revolveParams(),
                    Json{{"regions", Json::array()},
                         {"axis", nullptr},
                         {"operation", "new"},
                         {"targets", Json::array()},
                         {"angle", kFullTurn},
                         {"flip", false}}) {}

}  // namespace tinycad::features
