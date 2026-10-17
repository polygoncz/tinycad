#include "box/schema.hpp"

namespace tinycad::features {

BoxSchema::BoxSchema()
    : BuiltInSchema("box", 1, "box.label", "box",
                    {{"origin", pointParam("box.origin")},
                     {"width", positiveLength("box.width", 10)},
                     {"depth", positiveLength("box.depth", 10)},
                     {"height", positiveLength("box.height", 10)}},
                    Json{{"origin", {0, 0, 0}}, {"width", 10}, {"depth", 10}, {"height", 10}}) {}

}  // namespace tinycad::features
