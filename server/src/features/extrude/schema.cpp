#include "extrude/schema.hpp"

namespace tinycad::features {

namespace {

using document::ParamKind;
using document::ParamSchema;
using document::ParamSpec;

ParamSchema extrudeParams() {
  ParamSpec targets = referenceList(ParamKind::Bodies, "extrude.targets", 1);
  targets.group = "extrude.group.merge";
  // p.operation !== 'new' (equals_none: a missing operation shows).
  targets.visibleWhen = whenNone("operation", {"new"});

  // distanceApplies: endType is not 'upToFace'.
  ParamSpec distance = positiveLength("extrude.distance", 10);
  distance.visibleWhen = whenNone("endType", {"upToFace"});

  // Hidden unless 'upToFace', so data of version 1 without upTo stay valid without a migration.
  ParamSpec upTo = referenceList(ParamKind::Topo, "extrude.upTo", 1, 1);
  upTo.entity = document::TopoEntity::Face;
  upTo.visibleWhen = whenAny("endType", {"upToFace"});

  // flipApplies: endType is 'blind'.
  ParamSpec flip = booleanParam("extrude.flip", false);
  flip.visibleWhen = whenAny("endType", {"blind"});

  return {{"regions", referenceList(ParamKind::Region, "extrude.regions", 1)},
          {"operation", enumParam("extrude.operation", "new",
                                  {{"new", "extrude.operation.new"},
                                   {"add", "extrude.operation.add"},
                                   {"remove", "extrude.operation.remove"},
                                   {"intersect", "extrude.operation.intersect"}})},
          {"targets", targets},
          {"endType", enumParam("extrude.endType", "blind",
                                {{"blind", "extrude.endType.blind"},
                                 {"symmetric", "extrude.endType.symmetric"},
                                 {"upToFace", "extrude.endType.upToFace"}})},
          {"distance", distance},
          {"upTo", upTo},
          {"flip", flip}};
}

}  // namespace

ExtrudeSchema::ExtrudeSchema()
    : BuiltInSchema("extrude", 1, "extrude.label", "arrow-big-up-lines", extrudeParams(),
                    Json{{"regions", Json::array()},
                         {"operation", "new"},
                         {"targets", Json::array()},
                         {"endType", "blind"},
                         {"distance", 10},
                         {"upTo", Json::array()},
                         {"flip", false}}) {}

}  // namespace tinycad::features
