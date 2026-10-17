#include "history.hpp"

#include <TopAbs_ShapeEnum.hxx>

#include <set>

namespace tinycad::kernel::detail {

ShapeHistory HistoryCollector::collect(const std::vector<const ShapeEntry*>& inputs) {
  ShapeHistory history;
  for (std::size_t i = 0; i < inputs.size(); ++i) {
    const int input = static_cast<int>(i);
    const ShapeEntry& entry = *inputs[i];
    for (int index = 0; index < entry.faces().Extent(); ++index) {
      const TopoDS_Shape& face = entry.face(index);
      const SubShapeIndex from{SubShapeType::Face, index};
      if (maker_.IsDeleted(face)) {
        history.deleted.push_back({input, from});
        continue;
      }
      std::vector<SubShapeIndex> to = outputFaces(maker_.Modified(face));
      if (!to.empty()) {
        history.modified.push_back({input, from, std::move(to)});
        continue;
      }
      const int same = output_.faceIndex(face);
      if (same >= 0) {
        history.modified.push_back({input, from, {{SubShapeType::Face, same}}});
      } else {
        history.deleted.push_back({input, from});
      }
    }
    collectGenerated(input, SubShapeType::Face, entry.faces(), history.generated);
    collectGenerated(input, SubShapeType::Edge, entry.edges(), history.generated);
    collectGenerated(input, SubShapeType::Vertex, entry.vertices(), history.generated);
  }
  return history;
}

void HistoryCollector::collectGenerated(int input, SubShapeType type, const ShapeMap& map,
                                        std::vector<HistoryLink>& generated) {
  for (int index = 0; index < map.Extent(); ++index) {
    std::vector<SubShapeIndex> to = outputFaces(maker_.Generated(map.FindKey(index + 1)));
    if (!to.empty()) generated.push_back({input, {type, index}, std::move(to)});
  }
}

std::vector<SubShapeIndex> HistoryCollector::outputFaces(const ShapeList& list) const {
  std::set<int> found;
  for (const TopoDS_Shape& item : list) {
    if (item.ShapeType() != TopAbs_FACE) continue;
    const int index = output_.faceIndex(item);
    if (index >= 0) found.insert(index);
  }
  std::vector<SubShapeIndex> faces;
  for (const int index : found) faces.push_back({SubShapeType::Face, index});
  return faces;
}

}  // namespace tinycad::kernel::detail
