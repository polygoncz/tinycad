// STEP export: the contract block `exportStep (M15)` of src/kernel/testing.ts and
// test/unit/kernel-occt/occt-step.test.ts (the file read back with STEPControl_Reader).

#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <gtest/gtest.h>
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

std::string trimmed(const std::string& text) {
  const auto first = text.find_first_not_of(" \t\r\n");
  const auto last = text.find_last_not_of(" \t\r\n");
  return first == std::string::npos ? std::string() : text.substr(first, last - first + 1);
}

/** Spec 06: the text, trimmed, starts with ISO-10303-21; and ends with END-ISO-10303-21;. */
void expectStepFrame(const std::string& bytes) {
  ASSERT_FALSE(bytes.empty());
  const std::string text = trimmed(bytes);
  EXPECT_TRUE(text.starts_with("ISO-10303-21;"));
  EXPECT_TRUE(text.ends_with("END-ISO-10303-21;"));
}

/** The temporary export files of this process left in the temporary directory. */
std::vector<std::string> exportFiles() {
  const std::string prefix = "tinycad-export-" + std::to_string(::getpid()) + "-";
  std::vector<std::string> names;
  for (const auto& entry :
       std::filesystem::directory_iterator(std::filesystem::temp_directory_path())) {
    const std::string name = entry.path().filename().string();
    if (name.starts_with(prefix)) names.push_back(name);
  }
  return names;
}

/** The shape of a STEP text read back with STEPControl_Reader. */
TopoDS_Shape readBack(const std::string& bytes) {
  const std::filesystem::path path = std::filesystem::temp_directory_path() /
                                     ("tinycad-read-back-" + std::to_string(::getpid()) + ".step");
  {
    std::ofstream out(path, std::ios::binary);
    out << bytes;
  }
  STEPControl_Reader reader;
  EXPECT_EQ(reader.ReadFile(path.c_str()), IFSelect_RetDone);
  EXPECT_GE(reader.TransferRoots(), 1);
  const TopoDS_Shape shape = reader.OneShape();
  std::filesystem::remove(path);
  return shape;
}

std::vector<double> solidVolumes(const TopoDS_Shape& shape) {
  std::vector<double> volumes;
  for (TopExp_Explorer explorer(shape, TopAbs_SOLID); explorer.More(); explorer.Next()) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(explorer.Current(), props);
    volumes.push_back(props.Mass());
  }
  return volumes;
}

BoundingBox boxOf(const TopoDS_Shape& shape) {
  Bnd_Box box;
  BRepBndLib::AddOptimal(shape, box, false, false);
  double x0 = 0;
  double y0 = 0;
  double z0 = 0;
  double x1 = 0;
  double y1 = 0;
  double z1 = 0;
  box.Get(x0, y0, z0, x1, y1, z1);
  return {{x0, y0, z0}, {x1, y1, z1}};
}

class Step : public ::testing::Test {
 protected:
  ShapeHandle aBox(const BoxInput& box = kBox) { return ok(kernel.makeBox(box)).shape; }

  OcctKernel kernel;
};

TEST_F(Step, ABoxIsASTEPTextFromHeaderToEnd) {
  expectStepFrame(ok(kernel.exportStep(std::vector{aBox()})));
}

TEST_F(Step, TwoBoxesInOneFile) {
  expectStepFrame(ok(kernel.exportStep(std::vector{aBox(), aBox(kSeparate)})));
}

TEST_F(Step, TheInputsStayValidAndNoHandleIsCreated) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kSeparate);
  ok(kernel.exportStep(std::vector{a, b}));
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
  ok(kernel.boundingBox(b));
}

TEST_F(Step, AnEmptyListOrTheSameHandleTwiceFailsWithInvalidInput) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kSeparate);
  EXPECT_EQ(codeOf(kernel.exportStep({})), KernelErrorCode::InvalidInput);
  EXPECT_EQ(codeOf(kernel.exportStep(std::vector{a, b, a})), KernelErrorCode::InvalidInput);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Step, AReleasedHandleFailsWithUnknownHandle) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox();
  ok(kernel.release(std::span(&a, 1)));
  EXPECT_EQ(codeOf(kernel.exportStep(std::vector{b, a})), KernelErrorCode::UnknownHandle);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Step, ABoxWithAHoleReadsBackAsOneSolidOfTheSameVolumeAndBox) {
  const ShapeHandle box = aBox({{0, 0, 0}, {20, 20, 10}});
  const ShapeHandle cylinder = ok(kernel.makeCylinder({{10, 10, -1}, {0, 0, 1}, 3, 12})).shape;
  const ShapeHandle cut =
      ok(kernel.boolean(BooleanOp::Subtract, std::span(&box, 1), std::span(&cylinder, 1))).shape;
  const BoundingBox original = ok(kernel.boundingBox(cut));
  const TopoDS_Shape back = readBack(ok(kernel.exportStep(std::span(&cut, 1))));
  const std::vector<double> volumes = solidVolumes(back);
  ASSERT_EQ(volumes.size(), 1U);
  expectRelativelyClose(volumes[0], 4000 - 90 * std::numbers::pi, 1e-4);
  expectBoxClose(boxOf(back), original.min, original.max, "read back");
}

TEST_F(Step, TwoSeparateBoxesReadBackAsTwoSolidsWithTheSumOfTheVolumes) {
  const ShapeHandle a = aBox({{0, 0, 0}, {1, 2, 3}});
  const ShapeHandle b = aBox({{10, 0, 0}, {2, 2, 2}});
  const TopoDS_Shape back = readBack(ok(kernel.exportStep(std::vector{a, b})));
  const std::vector<double> volumes = solidVolumes(back);
  ASSERT_EQ(volumes.size(), 2U);
  expectRelativelyClose(volumes[0] + volumes[1], 14, 1e-6);
  expectBoxClose(boxOf(back), {0, 0, 0}, {12, 2, 3}, "read back");
}

TEST_F(Step, TheFileIsInMillimetresAndAP214) {
  const std::string text = ok(kernel.exportStep(std::vector{aBox({{0, 0, 0}, {1, 1, 1}})}));
  EXPECT_NE(text.find("SI_UNIT(.MILLI.,.METRE.)"), std::string::npos);
  EXPECT_NE(text.find("AUTOMOTIVE_DESIGN"), std::string::npos);
}

TEST_F(Step, NoTemporaryFileStaysAfterAnExportAFailedOneIncluded) {
  const ShapeHandle a = aBox({{0, 0, 0}, {1, 1, 1}});
  ok(kernel.exportStep(std::span(&a, 1)));
  ok(kernel.exportStep(std::vector{a, aBox({{5, 0, 0}, {1, 1, 1}})}));
  EXPECT_EQ(codeOf(kernel.exportStep(std::vector{a, a})), KernelErrorCode::InvalidInput);
  EXPECT_EQ(exportFiles(), std::vector<std::string>{});
}

}  // namespace
}  // namespace tinycad::kernel
