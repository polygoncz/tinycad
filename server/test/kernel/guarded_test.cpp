// detail::currentError (guarded.hpp): what a public method of OcctKernel turns into a KernelError
// and what it lets through (N13, N114).

#include "guarded.hpp"

#include <Standard_Failure.hxx>
#include <gtest/gtest.h>

#include <new>
#include <stdexcept>

#include "tinycad/core/result.hpp"

namespace tinycad::kernel {
namespace {

/** currentError of `thrown`, as a public method calls it from its catch (...). */
template <class E>
KernelError errorOf(const E& thrown) {
  try {
    throw thrown;
  } catch (...) {
    return detail::currentError("method");
  }
}

TEST(CurrentError, KeepsTheCodeOfAKernelFailure) {
  const KernelError error = errorOf(detail::KernelFailure(KernelErrorCode::InvalidInput, "bad"));
  EXPECT_EQ(error.code, KernelErrorCode::InvalidInput);
}

TEST(CurrentError, TurnsOcctAndOtherExceptionsIntoInternal) {
  EXPECT_EQ(errorOf(Standard_Failure("occt")).code, KernelErrorCode::Internal);
  EXPECT_EQ(errorOf(std::runtime_error("other")).code, KernelErrorCode::Internal);
  EXPECT_EQ(errorOf(42).code, KernelErrorCode::Internal);
}

TEST(CurrentError, LetsABugAndRunningOutOfMemoryThrough) {
  EXPECT_THROW((void)errorOf(core::AssertionError("bug")), core::AssertionError);
  EXPECT_THROW((void)errorOf(std::bad_alloc()), std::bad_alloc);
}

}  // namespace
}  // namespace tinycad::kernel
