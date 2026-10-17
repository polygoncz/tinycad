#include "tinycad/rpc/geometry_service.hpp"

#include "convert.hpp"
#include "tinycad/rpc/status.hpp"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using geometry::ErrorCode;
using geometry::GeometryError;

namespace {

/** KERNEL_INVALID_INPUT for a request whose message cannot be read (a curve without a kind…). */
grpc::Status unreadable(const std::string& problem, const std::string& path) {
  return geometryStatus(GeometryError{ErrorCode::InvalidInput, problem}, path);
}

}  // namespace

grpc::Status GeometryServiceImpl::Intersections(grpc::ServerContext* /*context*/,
                                                const v1::IntersectionsRequest* request,
                                                v1::IntersectionsResponse* response) {
  try {
    CurveReader reader;
    const auto curves = reader.readAll(request->curves(), "curves");
    if (!curves) return unreadable(reader.problem(), "curves");
    const auto hits = geometry_.intersections(*curves);
    if (!hits) return geometryStatus(hits.error());
    for (const auto& hit : *hits) {
      auto* out = response->add_hits();
      out->set_a(hit.a);
      out->set_b(hit.b);
      toProto(hit.point, *out->mutable_point());
      out->set_ta(hit.ta);
      out->set_tb(hit.tb);
      out->set_overlap(hit.overlap);
    }
    return grpc::Status::OK;
  } catch (...) {
    return internalGeometryStatusOfCurrentException();
  }
}

grpc::Status GeometryServiceImpl::Segment(grpc::ServerContext* /*context*/,
                                          const v1::SegmentRequest* request,
                                          v1::SegmentResponse* response) {
  try {
    CurveReader reader;
    const auto curve = reader.read(request->curve(), "curve");
    if (!curve) return unreadable(reader.problem(), "curve");
    const auto piece = geometry_.segment(*curve, request->from(), request->to());
    if (!piece) return geometryStatus(piece.error());
    toProto(*piece, *response->mutable_curve());
    return grpc::Status::OK;
  } catch (...) {
    return internalGeometryStatusOfCurrentException();
  }
}

grpc::Status GeometryServiceImpl::Fillet(grpc::ServerContext* /*context*/,
                                         const v1::FilletRequest* request,
                                         v1::FilletResponse* response) {
  try {
    if (!request->has_near()) return unreadable("near is missing", "near");
    CurveReader reader;
    const auto a = reader.read(request->a(), "a");
    if (!a) return unreadable(reader.problem(), "a");
    const auto b = reader.read(request->b(), "b");
    if (!b) return unreadable(reader.problem(), "b");
    const auto arc = geometry_.fillet(*a, *b, request->radius(), fromProto(request->near()));
    if (!arc) return geometryStatus(arc.error());
    toProto(arc->center, *response->mutable_center());
    toProto(arc->pointA, *response->mutable_point_a());
    toProto(arc->pointB, *response->mutable_point_b());
    response->set_ta(arc->ta);
    response->set_tb(arc->tb);
    return grpc::Status::OK;
  } catch (...) {
    return internalGeometryStatusOfCurrentException();
  }
}

grpc::Status GeometryServiceImpl::Offset(grpc::ServerContext* /*context*/,
                                         const v1::OffsetRequest* request,
                                         v1::OffsetResponse* response) {
  try {
    CurveReader reader;
    const auto chain = reader.readAll(request->chain(), "chain");
    if (!chain) return unreadable(reader.problem(), "chain");
    const auto curves = geometry_.offset(*chain, request->closed(), request->distance());
    if (!curves) return geometryStatus(curves.error());
    for (const auto& curve : *curves) {
      auto* out = response->add_curves();
      toProto(curve.curve, *out->mutable_curve());
      out->set_source(curve.source);
    }
    return grpc::Status::OK;
  } catch (...) {
    return internalGeometryStatusOfCurrentException();
  }
}

}  // namespace tinycad::rpc
