#pragma once

// The data half of a feature type (spec 03 "Schéma featury", ADR 0004, src/document/schema.ts and
// validate.ts): params, defaults, validation, migration. Geometry is the FeatureBuilder in regen
// (M43). The declarative part (ParamSpec) is also what the server sends to the client as
// FeatureTypeDescriptor (spec 14 "Schéma featur", server/proto/tinycad/v1/schema.proto).
//
// Difference to TS (decision N20, Q105): `visibleWhen` is DATA (VisibleWhen), not a predicate,
// so it can cross the wire and the client and the server evaluate the same thing.

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/core/math.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/model.hpp"
#include "tinycad/document/param_rule.hpp"

namespace tinycad::document {

// ---------------------------------------------------------------------------------------------
// VisibleWhen (Q105, proto VisibleWhen)

struct VisibleWhen {
  enum class Test {
    /** The value equals one of `values` (pivot == "point"); a missing param is hidden. */
    EqualsAny,
    /**
     * The value equals none of `values` (operation != "new"). A MISSING param is visible; a value
     * of another JSON type than the options (a number where the options are strings) is hidden.
     */
    EqualsNone,
    /** The value is a finite number below `limit` (revolve: angle < 2π − 1e-9); else hidden. */
    LessThan,
  };

  /** Key of the param whose value is tested. */
  std::string param;
  Test test = Test::EqualsAny;
  /** EqualsAny, EqualsNone. */
  std::vector<Json> values;
  /** LessThan. */
  double limit = 0;
};

// ---------------------------------------------------------------------------------------------
// ParamSpec: the kinds of the TS ParamSpec (and of the proto oneof ParamDescriptor.spec).
// KISS (N9): one plain struct with `kind`; only the fields of the kind are meaningful.

enum class ParamKind {
  // Plain values
  Length,
  Angle,
  Number,
  Boolean,
  Enum,
  Point,
  /** Any JSON without a form field (the sketch); the schema's own validate checks the content. */
  Data,
  // References (RefParamKind, M20): arrays counted by min/max, except Axis
  Bodies,
  Topo,
  Region,
  /** PlaneRef or TopoRef (a planar face, M14) items. */
  Planes,
  /** A single AxisRef | SketchEntityRef, empty as null (M13). */
  Axis,
};

enum class TopoEntity { Face, Edge, Vertex };

struct EnumOption {
  std::string value;
  /** Translation key. */
  std::string label;
};

struct ParamSpec {
  ParamKind kind = ParamKind::Length;
  /** Translation key of the field, "box.width". */
  std::string label;
  /** Translation key of the dialog section heading; validation ignores it. */
  std::optional<std::string> group;
  /** Unset = always visible. A hidden param is neither required nor checked. */
  std::optional<VisibleWhen> visibleWhen;

  /** Default of a plain value kind (number, bool, string or [x, y, z]); null for Data and refs. */
  Json defaultValue;

  /**
   * Length, Angle, Number: bounds, inclusive unless marked exclusive (Q050).
   * Bodies, Topo, Region, Planes: the number of references (unset = 0..∞).
   */
  std::optional<double> min;
  std::optional<double> max;
  bool exclusiveMin = false;
  bool exclusiveMax = false;
  /** Number only. */
  bool integer = false;
  /** Enum only. */
  std::vector<EnumOption> options;
  /** Topo only. */
  TopoEntity entity = TopoEntity::Face;

  /** Bodies, Topo, Region, Planes, Axis. */
  [[nodiscard]] bool isReference() const;
};

struct ParamEntry {
  std::string key;
  ParamSpec spec;
};

/** The params in the order of the dialog (an ordered list, not a map: the order is data). */
using ParamSchema = std::vector<ParamEntry>;

/**
 * Whether the param applies to these UNCHECKED params (isParamVisible): true without visibleWhen.
 * Never throws, whatever `params` is (not an object → the tested value counts as missing).
 */
bool isParamVisible(const ParamSpec& spec, const Json& params);

// ---------------------------------------------------------------------------------------------
// Issues and validation

struct ParamIssue {
  /** Key of the param, "" for the params object as a whole. */
  std::string param;
  /** Translation key, "param.atOrBelowMin" (ADR 0014); the codes are in spec 03. */
  std::string code;
  /** Values for the text, e.g. { min: 0 }: a JSON object of strings and numbers, or null. */
  Json params;

  friend bool operator==(const ParamIssue&, const ParamIssue&) = default;
};

/** JSON { param, code, params? } (params only when not empty), numbers via core::numberJson. */
Json issueJson(const ParamIssue& issue);

/**
 * The generic checks driven by ParamSpec (validateAgainstSchema, spec 03): not an object →
 * one issue { "", param.wrongType }; per visible param missing / wrong type / bounds / unknown
 * option / reference rules; then every key not in the schema → param.unexpected. Issue order is
 * NOT a contract (the shared cases sort, spec 13).
 */
std::vector<ParamIssue> validateAgainstSchema(const ParamSchema& schema, const Json& params);

/**
 * The declarative rules of a feature type (param_rule.hpp, M49, N148): appends their issues to
 * `issues`, in the order of the rules. Precondition: `issues` holds exactly
 * validateAgainstSchema(schema, params) (a rule skips params the generic checks reported). Never
 * throws, whatever `params` is. Implemented in M49 (src/document/rules.cpp).
 */
void checkParamRules(const ParamSchema& schema, const ParamRules& rules, const Json& params,
                     std::vector<ParamIssue>& issues);

// ---------------------------------------------------------------------------------------------
// FeatureSchema and its registry

class FeatureSchema {
 public:
  virtual ~FeatureSchema() = default;

  /** Registry key, "box". */
  [[nodiscard]] virtual const std::string& type() const = 0;
  /** >= 1; version > 1 requires migrate (enforced by the registry via hasMigrate). */
  [[nodiscard]] virtual int version() const = 0;
  /** Translation key of the display name, "box.label". */
  [[nodiscard]] virtual const std::string& label() const = 0;
  /** Tabler icon name; "" = generic icon. */
  [[nodiscard]] virtual const std::string& icon() const = 0;
  [[nodiscard]] virtual const ParamSchema& params() const = 0;
  /**
   * The declarative rules beyond the generic checks (param_rule.hpp, M49, N148), sent to the
   * client in FeatureTypeDescriptor.rules. validate() must report them too (BuiltInSchema does it
   * by checkParamRules). Default: none.
   */
  [[nodiscard]] virtual const ParamRules& rules() const {
    static const ParamRules none;
    return none;
  }
  /** Params of a new feature (a JSON object). */
  [[nodiscard]] virtual Json defaults() const = 0;
  /**
   * Takes unchecked params. Usually validateAgainstSchema + checkParamRules(rules()) + rules that
   * cannot be data (the sketch). Never throws.
   */
  [[nodiscard]] virtual std::vector<ParamIssue> validate(const Json& params) const = 0;
  [[nodiscard]] virtual bool hasMigrate() const { return false; }
  /**
   * Older params → params of version(); called only for 1 <= fromVersion < version(). Data it
   * cannot handle → an error message (fromData reports it at 'params'); must drop params the new
   * version no longer has (Q028).
   */
  [[nodiscard]] virtual core::Result<Json, std::string> migrate(int fromVersion,
                                                                const Json& raw) const;
};

using FeatureSchemaPtr = std::shared_ptr<const FeatureSchema>;

/** The read role of the registry (RegistryReader in TS). */
class FeatureSchemaRegistryReader {
 public:
  virtual ~FeatureSchemaRegistryReader() = default;
  /** nullptr for an unknown type. */
  [[nodiscard]] virtual const FeatureSchema* find(std::string_view type) const = 0;
  /** Unknown type throws AssertionError. */
  [[nodiscard]] virtual const FeatureSchema& get(std::string_view type) const = 0;
  /** In registration order. */
  [[nodiscard]] virtual std::vector<const FeatureSchema*> all() const = 0;
};

class FeatureSchemaRegistry final : public FeatureSchemaRegistryReader {
 public:
  /** Throws AssertionError: duplicate type, version < 1, version > 1 without migrate, and an
   * invalid rule (no code, unknown param, param == other, a param that is not a reference list). */
  void add(FeatureSchemaPtr schema);

  [[nodiscard]] const FeatureSchema* find(std::string_view type) const override;
  [[nodiscard]] const FeatureSchema& get(std::string_view type) const override;
  [[nodiscard]] std::vector<const FeatureSchema*> all() const override;

 private:
  std::vector<FeatureSchemaPtr> schemas_;
};

// ---------------------------------------------------------------------------------------------
// Evaluation (src/document/evaluate.ts): the one way from raw params to values computed with.

struct Evaluated {
  /** The params exactly when `issues` is empty (no variables yet, Q003: the same JSON). */
  std::optional<Json> params;
  std::vector<ParamIssue> issues;
};

Evaluated evaluateParams(const FeatureSchema& schema, const Json& params);

}  // namespace tinycad::document
