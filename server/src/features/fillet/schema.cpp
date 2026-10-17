#include "fillet/schema.hpp"

namespace tinycad::features {

namespace {

document::ParamSpec edges(std::string label) {
  document::ParamSpec spec = referenceList(document::ParamKind::Topo, std::move(label), 1);
  spec.entity = document::TopoEntity::Edge;
  return spec;
}

}  // namespace

FilletSchema::FilletSchema()
    : BuiltInSchema("fillet", 1, "fillet.label", "border-radius",
                    {{"edges", edges("fillet.edges")}, {"radius", positiveLength("fillet.radius", 1)}},
                    Json{{"edges", Json::array()}, {"radius", 1}}) {}

}  // namespace tinycad::features
