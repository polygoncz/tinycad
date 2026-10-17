// Topological names (spec 08, ADR 0018): a port of src/regen/names.ts rule by rule.

#include "tinycad/regen/names.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::regen {

using kernel::SubShapeIndex;
using kernel::SubShapeType;
using kernel::TopologySummary;

namespace {

const std::vector<int> kNoIndices;
const std::vector<TopoName> kNoNames;

/** Name → ascending indices of the sub-shapes that carry it (std::map: keys in byte order). */
std::map<TopoName, std::vector<int>> entriesOf(const std::vector<std::vector<TopoName>>& names) {
  std::map<TopoName, std::vector<int>> byName;
  for (std::size_t i = 0; i < names.size(); ++i) {
    for (const auto& name : names[i]) byName[name].push_back(static_cast<int>(i));
  }
  return byName;
}

const char* typeName(SubShapeType type) {
  switch (type) {
    case SubShapeType::Face:
      return "face";
    case SubShapeType::Edge:
      return "edge";
    case SubShapeType::Vertex:
      return "vertex";
  }
  return "?";
}

/** The index of `sub` if it lies in `topology`, else throws (an adapter bug). */
int checkIndex(const SubShapeIndex& sub, const TopologySummary& topology, const char* where) {
  const std::size_t count = sub.type == SubShapeType::Face ? topology.faces.size()
                            : sub.type == SubShapeType::Edge
                                ? topology.edges.size()
                                : static_cast<std::size_t>(topology.vertexCount);
  if (sub.index < 0 || static_cast<std::size_t>(sub.index) >= count) {
    throw core::AssertionError(std::string(typeName(sub.type)) + " " + std::to_string(sub.index) +
                               " out of range of the " + where + " (" + std::to_string(count) +
                               ")");
  }
  return sub.index;
}

bool isEmptyTopology(const TopologySummary& t) {
  return t.faces.empty() && t.edges.empty() && t.vertexCount == 0;
}

/**
 * An input index is checked only against an input with a known topology: an input without names
 * (NameTable::empty() for a profile face) has an empty topology, and its sub-shapes have no names
 * to look up anyway.
 */
int checkInputIndex(const SubShapeIndex& sub, const NameTable& table) {
  if (isEmptyTopology(table.topology())) return sub.index;
  return checkIndex(sub, table.topology(), "input");
}

const SubShapeIndex& expectFace(const SubShapeIndex& sub, const std::string& where) {
  if (sub.type != SubShapeType::Face) {
    throw core::AssertionError("Expected a face in " + where + ", got " + typeName(sub.type));
  }
  return sub;
}

/** For each vertex the faces around it: the adjacent faces of all edges that hold it. */
std::vector<std::set<int>> vertexFaces(const TopologySummary& topology) {
  std::vector<std::set<int>> around(static_cast<std::size_t>(std::max(0, topology.vertexCount)));
  for (const auto& edge : topology.edges) {
    for (int v : edge.vertices) {
      if (v < 0 || static_cast<std::size_t>(v) >= around.size()) {
        throw core::AssertionError("Vertex " + std::to_string(v) + " out of range");
      }
      around[static_cast<std::size_t>(v)].insert(edge.faces.begin(), edge.faces.end());
    }
  }
  return around;
}

/** The primary name of a source sub-shape; a vertex: vertex:<A>|<B>|… of the faces around it. */
std::optional<std::string> sourceName(const SubShapeIndex& sub, const NameTable& table) {
  if (sub.type == SubShapeType::Face) {
    const auto name = table.nameOfFace(sub.index);
    return name ? std::optional(name->str()) : std::nullopt;
  }
  if (sub.type == SubShapeType::Edge) {
    const auto name = table.nameOfEdge(sub.index);
    return name ? std::optional(name->str()) : std::nullopt;
  }
  const auto around = vertexFaces(table.topology());
  if (sub.index < 0 || static_cast<std::size_t>(sub.index) >= around.size()) return std::nullopt;
  const auto& faces = around[static_cast<std::size_t>(sub.index)];
  if (faces.empty()) return std::nullopt;
  std::set<std::string> names;
  for (int f : faces) {
    const auto name = table.nameOfFace(f);
    if (!name) return std::nullopt;
    names.insert(name->str());
  }
  std::string joined = "vertex:";
  bool first = true;
  for (const auto& n : names) {
    if (!first) joined += '|';
    joined += n;
    first = false;
  }
  return joined;
}

using OptName = std::optional<std::string>;

/** edge:<A>|<B> with A ≤ B; a seam with one face edge:<A>|<A>; a face without a name → none. */
OptName baseEdgeName(const std::vector<int>& faces, const std::vector<OptName>& primary) {
  if (faces.empty() || faces.size() > 2) return std::nullopt;
  const OptName& a = primary[static_cast<std::size_t>(faces[0])];
  const OptName& b = primary[static_cast<std::size_t>(faces.size() == 2 ? faces[1] : faces[0])];
  if (!a || !b) return std::nullopt;
  return *a <= *b ? "edge:" + *a + "|" + *b : "edge:" + *b + "|" + *a;
}

/** Indices of the edges sharing a name with another edge, one group per name. */
std::vector<std::vector<int>> groupsOfSameName(const std::vector<OptName>& names) {
  std::map<std::string, std::vector<int>> byName;
  for (std::size_t i = 0; i < names.size(); ++i) {
    if (names[i]) byName[*names[i]].push_back(static_cast<int>(i));
  }
  std::vector<std::vector<int>> groups;
  for (auto& [name, group] : byName) {
    if (group.size() > 1) groups.push_back(std::move(group));
  }
  return groups;
}

constexpr double kMidpointTolerance = 1e-9;

/** Midpoints lexicographically by x, y, z (equal within 1e-9), then by index. */
bool midpointBefore(const TopologySummary& topology, int a, int b) {
  const auto& pa = topology.edges[static_cast<std::size_t>(a)].midpoint;
  const auto& pb = topology.edges[static_cast<std::size_t>(b)].midpoint;
  for (std::size_t i = 0; i < 3; ++i) {
    const double d = pa[i] - pb[i];
    if (std::abs(d) > kMidpointTolerance) return d < 0;
  }
  return a < b;
}

/** Rule 7 and Q014: the two faces of an edge, then the faces at its ends, then #k by midpoint. */
std::vector<OptName> edgeNames(const TopologySummary& topology,
                               const std::vector<OptName>& primary) {
  std::vector<OptName> names;
  names.reserve(topology.edges.size());
  for (const auto& e : topology.edges) names.push_back(baseEdgeName(e.faces, primary));
  const auto facesAroundVertex = vertexFaces(topology);

  for (const auto& group : groupsOfSameName(names)) {
    for (int index : group) {
      const auto& edge = topology.edges[static_cast<std::size_t>(index)];
      const OptName base = names[static_cast<std::size_t>(index)];
      if (!base) continue;
      std::set<std::string> own;
      for (int f : edge.faces) {
        if (primary[static_cast<std::size_t>(f)]) own.insert(*primary[static_cast<std::size_t>(f)]);
      }
      std::set<std::string> context;
      for (int v : edge.vertices) {
        for (int f : facesAroundVertex[static_cast<std::size_t>(v)]) {
          const OptName& name = primary[static_cast<std::size_t>(f)];
          if (name && !own.contains(*name)) context.insert(*name);
        }
      }
      std::string joined;
      for (const auto& c : context) joined += (joined.empty() ? "" : ",") + c;
      names[static_cast<std::size_t>(index)] = *base + "[" + joined + "]";
    }
  }

  for (auto group : groupsOfSameName(names)) {
    std::stable_sort(group.begin(), group.end(),
                     [&](int a, int b) { return midpointBefore(topology, a, b); });
    for (std::size_t k = 0; k < group.size(); ++k) {
      auto& name = names[static_cast<std::size_t>(group[k])];
      name = name.value_or("") + "#" + std::to_string(k + 1);
    }
  }
  return names;
}

}  // namespace

// =============================================================================================
// NameTable

const NameTablePtr& NameTable::empty() {
  static const NameTablePtr table =
      std::make_shared<const NameTable>(std::vector<std::vector<TopoName>>{},
                                        std::vector<std::optional<TopoName>>{}, TopologySummary{});
  return table;
}

NameTable::NameTable(std::vector<std::vector<TopoName>> faceNames,
                     std::vector<std::optional<TopoName>> edgeNames,
                     kernel::TopologySummary topology)
    : faceNames_(std::move(faceNames)),
      edgeNames_(std::move(edgeNames)),
      topology_(std::move(topology)) {
  TINYCAD_ASSERT(faceNames_.size() == topology_.faces.size(),
                 "NameTable: face names do not match the topology");
  TINYCAD_ASSERT(edgeNames_.size() == topology_.edges.size(),
                 "NameTable: edge names do not match the topology");
  for (auto& names : faceNames_) {
    std::sort(names.begin(), names.end());
    names.erase(std::unique(names.begin(), names.end()), names.end());
  }
  faceEntries_ = entriesOf(faceNames_);
  for (std::size_t i = 0; i < edgeNames_.size(); ++i) {
    if (edgeNames_[i]) edgeEntries_[*edgeNames_[i]].push_back(static_cast<int>(i));
  }
}

const std::vector<int>& NameTable::faces(const TopoName& name) const {
  const auto it = faceEntries_.find(name);
  return it == faceEntries_.end() ? kNoIndices : it->second;
}

const std::vector<int>& NameTable::edges(const TopoName& name) const {
  const auto it = edgeEntries_.find(name);
  return it == edgeEntries_.end() ? kNoIndices : it->second;
}

std::optional<TopoName> NameTable::nameOfFace(int index) const {
  const auto& names = namesOfFace(index);
  if (names.empty()) return std::nullopt;
  return names.front();
}

std::optional<TopoName> NameTable::nameOfEdge(int index) const {
  if (index < 0 || static_cast<std::size_t>(index) >= edgeNames_.size()) return std::nullopt;
  return edgeNames_[static_cast<std::size_t>(index)];
}

const std::vector<TopoName>& NameTable::namesOfFace(int index) const {
  if (index < 0 || static_cast<std::size_t>(index) >= faceNames_.size()) return kNoNames;
  return faceNames_[static_cast<std::size_t>(index)];
}

const std::map<TopoName, std::vector<int>>& NameTable::faceEntries() const { return faceEntries_; }

const std::map<TopoName, std::vector<int>>& NameTable::edgeEntries() const { return edgeEntries_; }

const kernel::TopologySummary& NameTable::topology() const { return topology_; }

// =============================================================================================
// propagateNames and nameShape

NameTablePtr propagateNames(const NamingInput& input) {
  const TopologySummary& topology = input.topology;
  const std::string prefix = input.featureId.str() + "/";
  std::vector<std::set<std::string>> faceNames(topology.faces.size());
  const auto output = [&](const SubShapeIndex& sub) {
    return static_cast<std::size_t>(checkIndex(sub, topology, "output"));
  };

  // Rule 1: roles. Only face roles name faces; edge roles of makeFace are for the kernel.
  std::set<std::size_t> withRole;
  for (const auto& [key, subs] : input.roles) {
    if (!key.starts_with("face:")) continue;
    for (const auto& sub : subs) {
      const std::size_t index = output(expectFace(sub, "role '" + key + "'"));
      withRole.insert(index);
      faceNames[index].insert(prefix + key);
    }
  }

  if (input.history) {
    const auto tableOf = [&](int n) -> const NameTable& {
      if (n < 0 || static_cast<std::size_t>(n) >= input.inputs.size() ||
          input.inputs[static_cast<std::size_t>(n)] == nullptr) {
        throw core::AssertionError("Unknown input " + std::to_string(n));
      }
      return *input.inputs[static_cast<std::size_t>(n)];
    };
    // Rules 2, 3 and 6: an output face inherits all names of each input face it came from.
    for (const auto& link : input.history->modified) {
      const NameTable& table = tableOf(link.input);
      const int from = checkInputIndex(expectFace(link.from, "modified"), table);
      for (const auto& to : link.to) {
        const std::size_t index = output(to);
        if (to.type != SubShapeType::Face) continue;
        for (const auto& name : table.namesOfFace(from)) faceNames[index].insert(name.str());
      }
    }
    // Rule 4: a generated face without a role is named after its named source.
    for (const auto& link : input.history->generated) {
      const NameTable& table = tableOf(link.input);
      checkInputIndex(link.from, table);
      const auto source = sourceName(link.from, table);
      for (const auto& to : link.to) {
        const std::size_t index = output(to);
        if (to.type != SubShapeType::Face || withRole.contains(index) || !source) continue;
        faceNames[index].insert(prefix + "face:" + input.generatedTag + ":" + *source);
      }
    }
    // Rule 5: a deleted face simply passes its names to nobody.
    for (const auto& d : input.history->deleted) checkInputIndex(d.sub, tableOf(d.input));
  }

  // The one place a TopoName is minted (ADR 0018). std::set keeps the names sorted.
  std::vector<std::vector<TopoName>> sortedFaceNames;
  std::vector<OptName> primary;
  for (const auto& names : faceNames) {
    std::vector<TopoName> minted;
    for (const auto& n : names) minted.emplace_back(n);
    primary.push_back(names.empty() ? std::nullopt : OptName(*names.begin()));
    sortedFaceNames.push_back(std::move(minted));
  }
  for (const auto& e : topology.edges) {
    for (int f : e.faces) output(SubShapeIndex{SubShapeType::Face, f});
  }
  std::vector<std::optional<TopoName>> mintedEdges;
  for (const auto& name : edgeNames(topology, primary)) {
    mintedEdges.push_back(name ? std::optional(TopoName(*name)) : std::nullopt);
  }
  return std::make_shared<const NameTable>(std::move(sortedFaceNames), std::move(mintedEdges),
                                           topology);
}

kernel::KernelResult<NameTablePtr> nameShape(kernel::QueryOps& kernel, const FeatureId& featureId,
                                             const kernel::ShapeResult& result,
                                             const std::vector<NameTablePtr>& inputs,
                                             std::string_view generatedTag) {
  auto topology = kernel.topology(result.shape);
  if (!topology) return core::fail(topology.error());
  NamingInput naming{.featureId = featureId,
                     .inputs = inputs,
                     .history = result.history,
                     .roles = result.roles.value_or(kernel::Roles{}),
                     .topology = std::move(*topology),
                     .generatedTag = std::string(generatedTag)};
  return propagateNames(naming);
}

}  // namespace tinycad::regen
