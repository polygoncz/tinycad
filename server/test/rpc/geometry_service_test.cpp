// GeometryService (spec 14): the conversion of the messages, the error statuses with their
// ErrorDetail (errors.proto) and one call through a real in-process gRPC channel.

#include <gtest/gtest.h>
#include <grpcpp/grpcpp.h>

#include "google/rpc/status.pb.h"
#include "tinycad/service/geometry_service.hpp"
#include "tinycad/v1/errors.pb.h"

namespace tinycad::service {
namespace {

namespace v1 = tinycad::v1;

void setVec(v1::Vec2* v, double x, double y) {
  v->set_x(x);
  v->set_y(y);
}

v1::Curve2 line(const std::string& id, double x0, double y0, double x1, double y1) {
  v1::Curve2 c;
  c.set_id(id);
  setVec(c.mutable_line()->mutable_from(), x0, y0);
  setVec(c.mutable_line()->mutable_to(), x1, y1);
  return c;
}

/** The ErrorDetail in the details of a failed status. */
v1::ErrorDetail detailOf(const grpc::Status& status) {
  google::rpc::Status rpc;
  EXPECT_TRUE(rpc.ParseFromString(status.error_details()));
  EXPECT_EQ(rpc.code(), static_cast<int>(status.error_code()));
  EXPECT_EQ(rpc.details_size(), 1);
  v1::ErrorDetail detail;
  EXPECT_TRUE(rpc.details(0).UnpackTo(&detail));
  return detail;
}

TEST(GeometryService, IntersectionsOfCrossingLines) {
  GeometryServiceImpl service;
  v1::IntersectionsRequest request;
  *request.add_curves() = line("p", 0, 0, 2, 2);
  *request.add_curves() = line("q", 0, 2, 2, 0);
  v1::IntersectionsResponse response;
  ASSERT_TRUE(service.Intersections(nullptr, &request, &response).ok());
  ASSERT_EQ(response.hits_size(), 1);
  EXPECT_EQ(response.hits(0).a(), "p");
  EXPECT_EQ(response.hits(0).b(), "q");
  EXPECT_NEAR(response.hits(0).point().x(), 1, 1e-9);
  EXPECT_NEAR(response.hits(0).ta(), 0.5, 1e-9);
  EXPECT_FALSE(response.hits(0).overlap());
}

TEST(GeometryService, CurveWithoutIdIsKernelInvalidInput) {
  GeometryServiceImpl service;
  v1::IntersectionsRequest request;
  *request.add_curves() = line("", 0, 0, 1, 0);
  v1::IntersectionsResponse response;
  const grpc::Status status = service.Intersections(nullptr, &request, &response);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_KERNEL_INVALID_INPUT);
}

TEST(GeometryService, CurveWithoutKindIsKernelInvalidInput) {
  GeometryServiceImpl service;
  v1::SegmentRequest request;
  request.mutable_curve()->set_id("p");
  request.set_from(0);
  request.set_to(1);
  v1::SegmentResponse response;
  const grpc::Status status = service.Segment(nullptr, &request, &response);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_KERNEL_INVALID_INPUT);
}

TEST(GeometryService, ImpossibleFilletIsKernelOperationFailed) {
  GeometryServiceImpl service;
  v1::FilletRequest request;
  *request.mutable_a() = line("a", 0, 0, 10, 0);
  *request.mutable_b() = line("b", 0, 5, 10, 5);
  request.set_radius(2);
  setVec(request.mutable_near(), 1, 1);
  v1::FilletResponse response;
  const grpc::Status status = service.Fillet(nullptr, &request, &response);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_KERNEL_OPERATION_FAILED);
}

TEST(GeometryService, OffsetKeepsTheSource) {
  GeometryServiceImpl service;
  v1::OffsetRequest request;
  *request.add_chain() = line("p", 0, 0, 10, 0);
  request.set_distance(1);
  v1::OffsetResponse response;
  ASSERT_TRUE(service.Offset(nullptr, &request, &response).ok());
  ASSERT_EQ(response.curves_size(), 1);
  EXPECT_EQ(response.curves(0).source(), "p");
  EXPECT_TRUE(response.curves(0).curve().id().empty());
  // > 0 is to the right of the direction of travel: below a line running along +x.
  EXPECT_NEAR(response.curves(0).curve().line().from().y(), -1, 1e-9);
}

TEST(GeometryService, SegmentThroughAGrpcChannel) {
  GeometryServiceImpl service;
  grpc::ServerBuilder builder;
  builder.RegisterService(&service);
  const std::unique_ptr<grpc::Server> server = builder.BuildAndStart();
  ASSERT_NE(server, nullptr);
  const auto stub = v1::GeometryService::NewStub(server->InProcessChannel(grpc::ChannelArguments()));

  v1::SegmentRequest request;
  v1::Curve2& circle = *request.mutable_curve();
  circle.set_id("c");
  setVec(circle.mutable_circle()->mutable_center(), 0, 0);
  circle.mutable_circle()->set_radius(1);
  request.set_from(0);
  request.set_to(1.5707963267948966);
  v1::SegmentResponse response;
  grpc::ClientContext context;
  ASSERT_TRUE(stub->Segment(&context, request, &response).ok());
  EXPECT_EQ(response.curve().id(), "c");
  ASSERT_TRUE(response.curve().has_arc());
  EXPECT_NEAR(response.curve().arc().to().y(), 1, 1e-12);
  EXPECT_TRUE(response.curve().arc().ccw());

  // An error crosses the channel with its details.
  v1::SegmentRequest bad = request;
  bad.set_to(0);
  grpc::ClientContext badContext;
  const grpc::Status status = stub->Segment(&badContext, bad, &response);
  EXPECT_EQ(status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_KERNEL_INVALID_INPUT);
  server->Shutdown();
}

}  // namespace
}  // namespace tinycad::service
