#pragma once

// GeometryService of spec 14: four stateless calls over tinycad_geometry. No session, no
// document: curves in, data out. Errors are google.rpc.Status with ErrorDetail (status.hpp).

#include "tinycad/geometry/geometry.hpp"
#include "tinycad/v1/geometry.grpc.pb.h"

namespace tinycad::rpc {

class GeometryServiceImpl final : public tinycad::v1::GeometryService::Service {
 public:
  grpc::Status Intersections(grpc::ServerContext* context,
                             const tinycad::v1::IntersectionsRequest* request,
                             tinycad::v1::IntersectionsResponse* response) override;
  grpc::Status Segment(grpc::ServerContext* context, const tinycad::v1::SegmentRequest* request,
                       tinycad::v1::SegmentResponse* response) override;
  grpc::Status Fillet(grpc::ServerContext* context, const tinycad::v1::FilletRequest* request,
                      tinycad::v1::FilletResponse* response) override;
  grpc::Status Offset(grpc::ServerContext* context, const tinycad::v1::OffsetRequest* request,
                      tinycad::v1::OffsetResponse* response) override;

 private:
  geometry::Geometry2d geometry_;
};

}  // namespace tinycad::rpc
