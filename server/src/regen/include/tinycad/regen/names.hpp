#pragma once

// Topological names (spec 08, ADR 0018, src/regen/names.ts): from the roles and the history the
// kernel returns and from the topology of the output, a pure function builds the name table of
// one shape. propagateNames is the one place that mints a document::TopoName; everyone else only
// compares and stores it.

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/document/refs.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/kernel/types.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

using document::TopoName;

/**
 * Topological names of the faces and edges of one shape and the topology they came from.
 * Immutable, shared as NameTablePtr; a face has 0..n names (sorted), an edge 0..1.
 */
class NameTable {
 public:
  /** No names, a topology with 0 faces, 0 edges and 0 vertices (EMPTY_NAMES); one shared instance. */
  static const NameTablePtr& empty();

  /**
   * `faceNames[i]` = the sorted names of face i, `edgeNames[i]` = the name of edge i; sizes equal
   * to the face and edge count of `topology` (AssertionError otherwise).
   */
  NameTable(std::vector<std::vector<TopoName>> faceNames,
            std::vector<std::optional<TopoName>> edgeNames, kernel::TopologySummary topology);

  /** Indices of the faces with the name, ascending; unknown name → empty. */
  [[nodiscard]] const std::vector<int>& faces(const TopoName& name) const;
  [[nodiscard]] const std::vector<int>& edges(const TopoName& name) const;
  /** Primary name = the first of the sorted names; no name or index out of range → nullopt. */
  [[nodiscard]] std::optional<TopoName> nameOfFace(int index) const;
  [[nodiscard]] std::optional<TopoName> nameOfEdge(int index) const;
  /** All names of the face, sorted; empty = no name (index out of range too). */
  [[nodiscard]] const std::vector<TopoName>& namesOfFace(int index) const;
  /** Name → ascending indices, keys in byte order (= the TS sort order, names are ASCII). */
  [[nodiscard]] const std::map<TopoName, std::vector<int>>& faceEntries() const;
  [[nodiscard]] const std::map<TopoName, std::vector<int>>& edgeEntries() const;
  /** Topology of the shape the table came from. */
  [[nodiscard]] const kernel::TopologySummary& topology() const;

 private:
  std::vector<std::vector<TopoName>> faceNames_;
  std::vector<std::optional<TopoName>> edgeNames_;
  std::map<TopoName, std::vector<int>> faceEntries_;
  std::map<TopoName, std::vector<int>> edgeEntries_;
  kernel::TopologySummary topology_;
};

struct NamingInput {
  FeatureId featureId;
  /** Tables of the input shapes; index = HistoryLink::input. An unnamed input = NameTable::empty(). */
  std::vector<NameTablePtr> inputs;
  std::optional<kernel::ShapeHistory> history;
  kernel::Roles roles;
  /** Topology of the output shape. */
  kernel::TopologySummary topology;
  /** Tag of the names of generated faces: "gen", "fillet", "chamfer". */
  std::string generatedTag = "gen";
};

/**
 * The name table of an output shape (spec 08, rules 1–8): role names, names inherited through
 * `modified`, names of faces generated from named sub-shapes, then edge names from the faces
 * (with context and #k). Pure and independent of the order of history and roles. An index out
 * of range or an unknown input throws core::AssertionError: an adapter bug, not a user error.
 */
NameTablePtr propagateNames(const NamingInput& input);

/**
 * The one call a builder makes: kernel.topology(result.shape) and propagateNames over the roles
 * and history of `result`. `inputs` are the tables of the input shapes in the order the builder
 * passed them to the kernel. A failing topology call returns its KernelError.
 */
kernel::KernelResult<NameTablePtr> nameShape(kernel::QueryOps& kernel, const FeatureId& featureId,
                                             const kernel::ShapeResult& result,
                                             const std::vector<NameTablePtr>& inputs,
                                             std::string_view generatedTag = "gen");

}  // namespace tinycad::regen
