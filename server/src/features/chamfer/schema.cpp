#include "chamfer/schema.hpp"

namespace tinycad::features {

namespace {

document::ParamSpec edges(std::string label) {
  document::ParamSpec spec = referenceList(document::ParamKind::Topo, std::move(label), 1);
  spec.entity = document::TopoEntity::Edge;
  return spec;
}

}  // namespace

ChamferSchema::ChamferSchema()
    : BuiltInSchema("chamfer", 1, "chamfer.label", "border-corner-square",
                    {{"edges", edges("chamfer.edges")},
                     {"distance", positiveLength("chamfer.distance", 1)}},
                    Json{{"edges", Json::array()}, {"distance", 1}}) {}

}  // namespace tinycad::features
