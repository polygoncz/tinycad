#include "cylinder/schema.hpp"

namespace tinycad::features {

CylinderSchema::CylinderSchema()
    : BuiltInSchema("cylinder", 1, "cylinder.label", "cylinder",
                    {{"base", pointParam("cylinder.base")},
                     {"axis", enumParam("cylinder.axis", "z",
                                        {{"x", "cylinder.axis.x"},
                                         {"y", "cylinder.axis.y"},
                                         {"z", "cylinder.axis.z"}})},
                     {"radius", positiveLength("cylinder.radius", 5)},
                     {"height", positiveLength("cylinder.height", 10)}},
                    Json{{"base", {0, 0, 0}}, {"axis", "z"}, {"radius", 5}, {"height", 10}}) {}

}  // namespace tinycad::features
