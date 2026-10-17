#include "shared-cases/support/regen_describe.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

#include "shared-cases/support/mesh_volume.hpp"

namespace tinycad::testing {

using core::Json;

namespace {

/** The value of a kernel call the description needs; an error is a broken run. */
template <class T>
T valueOf(kernel::KernelResult<T> result, const char* what) {
  if (!result) throw std::runtime_error(std::string(what) + ": " + result.error().message);
  return std::move(*result);
}

/**
 * JSON with sorted keys and no whitespace, numbers as JSON.stringify writes them; "" for null
 * (an issue without params sorts first). canonicalJson of support/sort.ts.
 */
std::string canonicalJson(const Json& value) {
  if (value.is_null()) return "";
  if (value.is_number_float()) {
    const double d = value.get<double>();
    if (std::trunc(d) == d && std::abs(d) <= 9007199254740992.0) {
      return std::to_string(static_cast<long long>(d));
    }
    return value.dump();
  }
  if (value.is_array()) {
    std::string out = "[";
    for (std::size_t i = 0; i < value.size(); ++i) {
      if (i > 0) out += ",";
      out += value[i].is_null() ? "null" : canonicalJson(value[i]);
    }
    return out + "]";
  }
  if (value.is_object()) {
    // nlohmann::json keeps object keys sorted (std::map).
    std::string out = "{";
    bool first = true;
    for (const auto& item : value.items()) {
      if (!first) out += ",";
      first = false;
      out += Json(item.key()).dump() + ":" +
             (item.value().is_null() ? "null" : canonicalJson(item.value()));
    }
    return out + "}";
  }
  return value.dump();
}

Json vec3Json(const core::Vec3& v) { return Json::array({v[0], v[1], v[2]}); }

/** By the names element by element, a shorter prefix first (compareNames). */
int compareNames(const Json& a, const Json& b) {
  const std::size_t n = std::min(a.size(), b.size());
  for (std::size_t i = 0; i < n; ++i) {
    const auto& x = a[i].get_ref<const std::string&>();
    const auto& y = b[i].get_ref<const std::string&>();
    if (x != y) return x < y ? -1 : 1;
  }
  return a.size() == b.size() ? 0 : (a.size() < b.size() ? -1 : 1);
}

int compareNumbers(double a, double b) {
  const double ka = sortKey(a);
  const double kb = sortKey(b);
  return ka == kb ? 0 : (ka < kb ? -1 : 1);
}

/** By the components rounded for sorting (spec 13). */
int compareVectors(const Json& a, const Json& b) {
  for (std::size_t i = 0; i < 3; ++i) {
    const int c = compareNumbers(a[i].get<double>(), b[i].get<double>());
    if (c != 0) return c;
  }
  return 0;
}

/** Faces with the same names: by the surface type, then plane presence, normal and offset. */
int compareFaces(const Json& a, const Json& b) {
  const auto& sa = a["surface"].get_ref<const std::string&>();
  const auto& sb = b["surface"].get_ref<const std::string&>();
  if (sa != sb) return sa < sb ? -1 : 1;
  const bool pa = a.contains("plane");
  const bool pb = b.contains("plane");
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  const int byNormal = compareVectors(a["plane"]["normal"], b["plane"]["normal"]);
  if (byNormal != 0) return byNormal;
  return compareNumbers(a["plane"]["offset"].get<double>(), b["plane"]["offset"].get<double>());
}

Json describeBody(kernel::GeometryKernel& kernel, const regen::Body& body) {
  const auto bbox = valueOf(kernel.boundingBox(body.shape()), "boundingBox");
  const auto topology = valueOf(kernel.topology(body.shape()), "topology");
  const auto mesh = valueOf(kernel.tessellate(body.shape(), kFineMesh), "tessellate");

  std::vector<Json> faces;
  for (std::size_t i = 0; i < topology.faces.size(); ++i) {
    const auto& info = topology.faces[i];
    Json names = Json::array();
    for (const auto& n : body.names()->namesOfFace(static_cast<int>(i))) names.push_back(n.str());
    Json face = {{"names", names}, {"surface", kernel::surfaceTypeName(info.surface)}};
    if (info.plane) {
      const auto& o = info.plane->origin;
      const auto& n = info.plane->normal;
      face["plane"] = {{"normal", vec3Json(n)},
                       {"offset", n[0] * o[0] + n[1] * o[1] + n[2] * o[2]}};
    }
    faces.push_back(std::move(face));
  }
  std::sort(faces.begin(), faces.end(), [](const Json& a, const Json& b) {
    const int byNames = compareNames(a["names"], b["names"]);
    return byNames != 0 ? byNames < 0 : compareFaces(a, b) < 0;
  });

  std::vector<Json> edges;
  for (std::size_t i = 0; i < topology.edges.size(); ++i) {
    // An edge carries at most one name (spec 08).
    const auto name = body.names()->nameOfEdge(static_cast<int>(i));
    Json names = name ? Json::array({name->str()}) : Json::array();
    edges.push_back({{"names", names}, {"midpoint", vec3Json(topology.edges[i].midpoint)}});
  }
  std::sort(edges.begin(), edges.end(), [](const Json& a, const Json& b) {
    const int byNames = compareNames(a["names"], b["names"]);
    return byNames != 0 ? byNames < 0 : compareVectors(a["midpoint"], b["midpoint"]) < 0;
  });

  return {{"id", body.id()},
          {"origin", body.origin().str()},
          {"lastModifiedBy", body.lastModifiedBy().str()},
          {"volume", meshVolume(mesh)},
          {"bbox", {{"min", vec3Json(bbox.min)}, {"max", vec3Json(bbox.max)}}},
          {"faces", faces},
          {"edges", edges},
          {"vertexCount", topology.vertexCount}};
}

/** A loop rotated to start at the curve with the smallest id (normalizeLoop). */
kernel::ProfileLoop normalizeLoop(const kernel::ProfileLoop& loop) {
  std::size_t start = 0;
  for (std::size_t i = 0; i < loop.size(); ++i) {
    if (loop[i].id < loop[start].id) start = i;
  }
  kernel::ProfileLoop out(loop.begin() + static_cast<std::ptrdiff_t>(start), loop.end());
  out.insert(out.end(), loop.begin(), loop.begin() + static_cast<std::ptrdiff_t>(start));
  return out;
}

Json loopJson(const kernel::ProfileLoop& loop) {
  Json out = Json::array();
  for (const auto& c : loop) out.push_back(core::curve2Json(c));
  return out;
}

/** The outline with every loop normalized and the holes sorted by their first id. */
Json outlineJson(const kernel::ProfileRegion& region) {
  std::vector<kernel::ProfileLoop> holes;
  for (const auto& h : region.holes) holes.push_back(normalizeLoop(h));
  std::sort(holes.begin(), holes.end(), [](const auto& a, const auto& b) {
    const std::string fa = a.empty() ? "" : a.front().id;
    const std::string fb = b.empty() ? "" : b.front().id;
    return fa < fb;
  });
  Json holesJson = Json::array();
  for (const auto& h : holes) holesJson.push_back(loopJson(h));
  return {{"name", region.name},
          {"outer", loopJson(normalizeLoop(region.outer))},
          {"holes", holesJson},
          {"area", region.area}};
}

Json describeSketch(const regen::SketchArtifact& sketch) {
  std::vector<std::string> regions;
  for (const auto& r : sketch.regions) regions.push_back(r.name);
  std::sort(regions.begin(), regions.end());
  std::vector<const kernel::ProfileRegion*> outlines;
  for (const auto& o : sketch.outlines) outlines.push_back(&o);
  std::sort(outlines.begin(), outlines.end(),
            [](const auto* a, const auto* b) { return a->name < b->name; });
  Json outlinesJson = Json::array();
  for (const auto* o : outlines) outlinesJson.push_back(outlineJson(*o));
  return {{"id", sketch.id()},
          {"owner", sketch.owner().str()},
          {"regions", regions},
          {"outlines", outlinesJson}};
}

}  // namespace

bool issueBefore(const document::ParamIssue& a, const document::ParamIssue& b) {
  if (a.param != b.param) return a.param < b.param;
  if (a.code != b.code) return a.code < b.code;
  return canonicalJson(a.params) < canonicalJson(b.params);
}

double sortKey(double x) {
  const double scaled = std::round(std::abs(x) * 1e6);
  // -0 and 0 are the same key.
  if (scaled == 0) return 0;
  return x < 0 ? -scaled : scaled;
}

Json describeStatus(const regen::FeatureStatus& status) {
  Json out = {{"kind", regen::featureStatusKindName(status.kind)}};
  if (status.kind != regen::FeatureStatusKind::Error || !status.error) return out;
  out["code"] = regen::featureErrorCodeName(status.error->code);
  // TS leaves `issues` out when a FeatureError has none (UNKNOWN_TYPE, STALE_VERSION).
  if (!status.error->issues.empty()) {
    auto issues = status.error->issues;
    std::sort(issues.begin(), issues.end(), issueBefore);
    Json list = Json::array();
    for (const auto& issue : issues) list.push_back(document::issueJson(issue));
    out["issues"] = list;
  }
  return out;
}

Json describeState(kernel::GeometryKernel& kernel, const regen::RegenState& state) {
  auto bodies = state.bodies();
  std::sort(bodies.begin(), bodies.end(),
            [](const auto& a, const auto& b) { return a->id() < b->id(); });
  Json bodiesJson = Json::array();
  for (const auto& b : bodies) bodiesJson.push_back(describeBody(kernel, *b));
  auto sketches = state.sketches();
  std::sort(sketches.begin(), sketches.end(),
            [](const auto& a, const auto& b) { return a->id() < b->id(); });
  Json sketchesJson = Json::array();
  for (const auto& s : sketches) sketchesJson.push_back(describeSketch(*s));
  return {{"bodies", bodiesJson}, {"sketches", sketchesJson}};
}

Json describeResult(kernel::GeometryKernel& kernel, const regen::RegenResult& result) {
  Json statuses = Json::object();
  for (const auto& [id, status] : result.statuses) statuses[id.str()] = describeStatus(status);
  Json anchors = Json::object();
  for (const auto& [id, featureAnchors] : result.anchors) {
    Json named = Json::object();
    for (const auto& [name, anchor] : featureAnchors) {
      Json a = {{"point", vec3Json(anchor.point)}};
      if (anchor.direction) a["direction"] = vec3Json(*anchor.direction);
      named[name] = a;
    }
    anchors[id.str()] = named;
  }
  Json state = describeState(kernel, *result.finalState);
  return {{"statuses", statuses},
          {"bodies", state["bodies"]},
          {"sketches", state["sketches"]},
          {"anchors", anchors}};
}

}  // namespace tinycad::testing
