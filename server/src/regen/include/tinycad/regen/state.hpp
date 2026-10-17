#pragma once

// Regeneration state (spec 07 "Princip", src/regen/state.ts): an immutable snapshot of what exists
// after a feature. A feature is a function `output state = f(input state, params)`.
//
// C++ shape (decisions N9, N41 in docs/40-plan/Rozhodnutí nativního jádra.md):
// - Artifacts are a small class hierarchy (Body, SketchArtifact, PlaneArtifact, AxisArtifact) with
//   kind() and as<T>(), shared as shared_ptr<const …>. A changed artifact is a new object; the
//   untouched ones are the SAME pointers in the next state, like the objects of the TS Map.
// - RegenState keeps the artifacts in insertion order (the order of the TS Map matters: bodies
//   come out in map order, a changed body keeps its place, a new body goes to the end). A state
//   holds tens of artifacts, so lookup by id is a linear scan (KISS).
// - SketchArtifact does not depend on tinycad_sketch (N42): it carries what regen and the read
//   model need as plain data, so regen (M43) does not wait for the sketch model (M44).

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/kernel/profile.hpp"
#include "tinycad/kernel/types.hpp"

namespace tinycad::regen {

using core::Plane;
using core::Vec2;
using core::Vec3;
using document::BodyId;
using document::FeatureId;
using kernel::ShapeHandle;

class NameTable;
using NameTablePtr = std::shared_ptr<const NameTable>;

// =============================================================================================
// Artifacts

/** JSON-free tag of the TS union Artifact. */
enum class ArtifactKind { Body, Sketch, Plane, Axis };

/**
 * Whatever a feature leaves for later features. The id is always '<owner>/<kind>[:<n>]'
 * (ADR 0015): 'f1/body', 'f2/sketch', 'origin/plane:xy', 'origin/axis:z'.
 */
class Artifact {
 public:
  virtual ~Artifact() = default;

  [[nodiscard]] ArtifactKind kind() const { return kind_; }
  [[nodiscard]] const std::string& id() const { return id_; }

  /** The concrete type; the caller has checked kind(). */
  template <class T>
  [[nodiscard]] const T& as() const {
    return static_cast<const T&>(*this);
  }

 protected:
  Artifact(ArtifactKind kind, std::string id) : kind_(kind), id_(std::move(id)) {}

 private:
  ArtifactKind kind_;
  std::string id_;
};

using ArtifactPtr = std::shared_ptr<const Artifact>;

/**
 * A solid. Its identity is its lineage (ADR 0015): the feature that creates it mints the id
 * (document::bodyId) and is its origin; a feature that changes it keeps id, origin and place and
 * becomes lastModifiedBy (modifyBody, body_operation.hpp); a feature that consumes it removes it.
 */
class Body final : public Artifact {
 public:
  Body(BodyId id, FeatureId origin, FeatureId lastModifiedBy, ShapeHandle shape, NameTablePtr names);

  [[nodiscard]] BodyId bodyId() const { return BodyId(id()); }
  /** The feature whose builder minted the id; it does not change along the lineage. */
  [[nodiscard]] const FeatureId& origin() const { return origin_; }
  /** The last feature that gave the body a new shape. */
  [[nodiscard]] const FeatureId& lastModifiedBy() const { return lastModifiedBy_; }
  [[nodiscard]] ShapeHandle shape() const { return shape_; }
  /** Never null (NameTable::empty() at least). */
  [[nodiscard]] const NameTablePtr& names() const { return names_; }

 private:
  FeatureId origin_;
  FeatureId lastModifiedBy_;
  ShapeHandle shape_;
  NameTablePtr names_;
};

using BodyPtr = std::shared_ptr<const Body>;

/** A line of a sketch in sketch coordinates (construction lines too): the Revolve axis (M13). */
struct SketchLineSegment {
  /** Id of the sketch entity. */
  std::string id;
  Vec2 p1{};
  Vec2 p2{};
};

/** A region of a sketch and its planar face in the kernel (SketchOps::makeFace). */
struct SketchRegionFace {
  /** The region name of profileRegions ('l1,l2,l3,l4'). */
  std::string name;
  ShapeHandle face{};
};

/**
 * The result of a sketch (spec 12 "Featura skici", M12, M30): its plane, the solved geometry for
 * the read model and the planar faces of its regions. Filled by the sketch builder (M44.1) with
 * public members before it is shared as const (KISS: a data carrier, no invariants of its own).
 */
class SketchArtifact final : public Artifact {
 public:
  /** id = document::sketchId(owner). */
  explicit SketchArtifact(FeatureId owner);

  [[nodiscard]] const FeatureId& owner() const { return owner_; }

  Plane plane;
  /**
   * The solved entities as the params JSON of spec 12 (SketchEntity[]), shared, never null after
   * the builder (an empty array for a test artifact). SketchView sends them (spec 14).
   */
  std::shared_ptr<const core::Json> entities;
  /**
   * The pattern copies as entity JSON (Sketch::patternCopies + entityJson), the "derived"
   * entities of SketchView; an empty array when the sketch has no pattern.
   */
  std::shared_ptr<const core::Json> derivedEntities;
  /** Every line entity with its point coordinates, for resolveAxis (sketch entity ref). */
  std::vector<SketchLineSegment> lines;
  /** In the order of `outlines` (the order of profileRegions, sorted by name). */
  std::vector<SketchRegionFace> regions;
  /** The outlines of the regions from the kernel, same order and names as `regions` (M30). */
  std::vector<kernel::ProfileRegion> outlines;

  /** The face of the region `name`, nullopt when the sketch has no such region. */
  [[nodiscard]] std::optional<ShapeHandle> regionFace(std::string_view name) const;

 private:
  FeatureId owner_;
};

using SketchArtifactPtr = std::shared_ptr<const SketchArtifact>;

/** A plane (M12): the origin planes of the owner document::ORIGIN; construction planes later. */
class PlaneArtifact final : public Artifact {
 public:
  PlaneArtifact(document::PlaneId id, FeatureId owner, Plane plane);
  [[nodiscard]] const FeatureId& owner() const { return owner_; }
  [[nodiscard]] const Plane& plane() const { return plane_; }

 private:
  FeatureId owner_;
  Plane plane_;
};

/** An axis (M13): the origin axes of the owner document::ORIGIN. */
class AxisArtifact final : public Artifact {
 public:
  AxisArtifact(document::AxisId id, FeatureId owner, Vec3 origin, Vec3 direction);
  [[nodiscard]] const FeatureId& owner() const { return owner_; }
  [[nodiscard]] const Vec3& origin() const { return origin_; }
  /** Unit. */
  [[nodiscard]] const Vec3& direction() const { return direction_; }

 private:
  FeatureId owner_;
  Vec3 origin_;
  Vec3 direction_;
};

// =============================================================================================
// RegenState

class RegenState;
using StatePtr = std::shared_ptr<const RegenState>;

class RegenState {
 public:
  /**
   * The state in front of the first feature (EMPTY_STATE): the three origin planes (xy, xz, yz)
   * and behind them the three origin axes (x, y, z). One shared instance.
   */
  static const StatePtr& empty();

  /** Throws core::AssertionError on a null artifact or a duplicate id. */
  explicit RegenState(std::vector<ArtifactPtr> artifacts);

  /** In insertion order (the order of the TS Map). */
  [[nodiscard]] const std::vector<ArtifactPtr>& artifacts() const { return artifacts_; }
  /** nullptr when there is no artifact with the id. */
  [[nodiscard]] ArtifactPtr find(std::string_view id) const;

  /** The artifacts of one kind, in insertion order (bodiesOf, sketchesOf, planesOf, axesOf). */
  [[nodiscard]] std::vector<BodyPtr> bodies() const;
  [[nodiscard]] std::vector<SketchArtifactPtr> sketches() const;
  [[nodiscard]] std::vector<std::shared_ptr<const PlaneArtifact>> planes() const;
  [[nodiscard]] std::vector<std::shared_ptr<const AxisArtifact>> axes() const;

  /** A new state: the artifact replaces the one with the same id in place, or goes to the end. */
  [[nodiscard]] StatePtr with(ArtifactPtr artifact) const;

  /**
   * replaceBodies (spec 07, identity rule): each body of `changed` takes the place of the body
   * with its id, bodies of `consumed` leave (consumed wins over changed), everything else stays
   * the same pointer. A changed body whose id is not in this state is not added.
   */
  [[nodiscard]] StatePtr replaceBodies(const std::map<BodyId, BodyPtr>& changed,
                                       const std::set<BodyId>& consumed) const;

 private:
  std::vector<ArtifactPtr> artifacts_;
};

// =============================================================================================
// Feature errors and statuses (spec 07 "Stav featury")

enum class FeatureErrorCode {
  InvalidParams,
  UnresolvedReference,
  Kernel,
  UnknownType,
  /** typeVersion of the feature is not the version of its schema: data that missed migration. */
  StaleVersion,
};

/** "INVALID_PARAMS", "UNRESOLVED_REFERENCE", "KERNEL", "UNKNOWN_TYPE", "STALE_VERSION". */
std::string_view featureErrorCodeName(FeatureErrorCode code);

struct FeatureError {
  FeatureErrorCode code = FeatureErrorCode::Kernel;
  /** Technical text for logs; never compared by tests (spec 13). */
  std::string message;
  /**
   * INVALID_PARAMS: the issues of schema.validate or of the builder ('extrude.upToFace',
   * 'fillet.failed', 'chamfer.failed'); UNRESOLVED_REFERENCE: one 'param.unresolvedRef' at the
   * param; KERNEL: one { param: '', code: 'kernel.operationFailed' | 'kernel.invalidInput' |
   * 'kernel.internal' }. Empty for UNKNOWN_TYPE and STALE_VERSION.
   */
  std::vector<document::ParamIssue> issues;
};

/** JSON "ok" | "warning" | "error" | "suppressed" | "rolledBack" ('pending' is UI only). */
enum class FeatureStatusKind { Ok, Warning, Error, Suppressed, RolledBack };

std::string_view featureStatusKindName(FeatureStatusKind kind);

struct FeatureStatus {
  FeatureStatusKind kind = FeatureStatusKind::Ok;
  /** Warning only: the messages of ctx.warn joined with '\n' (Q045). */
  std::string message;
  /** Error only. */
  std::optional<FeatureError> error;

  static FeatureStatus ok();
  static FeatureStatus warning(std::string message);
  static FeatureStatus failed(FeatureError error);
  static FeatureStatus suppressed();
  static FeatureStatus rolledBack();
};

}  // namespace tinycad::regen
