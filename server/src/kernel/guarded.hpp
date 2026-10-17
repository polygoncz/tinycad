#pragma once

// Errors inside tinycad_kernel. The ported algorithms stop with a KernelFailure deep in their
// control flow (as the TS adapter throws createKernelError); every public method of OcctKernel
// runs its body in `try` and turns whatever was thrown into the error of its KernelResult with
// currentError, so no exception leaves the kernel (decision N13). Internal to tinycad_kernel.

#include <stdexcept>
#include <string>

#include "tinycad/kernel/errors.hpp"

namespace tinycad::kernel::detail {

/** An expected failure with its kernel code (createKernelError of src/kernel/errors.ts). */
class KernelFailure : public std::runtime_error {
 public:
  KernelFailure(KernelErrorCode code, const std::string& message)
      : std::runtime_error(message), code_(code) {}

  [[nodiscard]] KernelErrorCode code() const noexcept { return code_; }

 private:
  KernelErrorCode code_;
};

/** Throws KernelFailure(code, message). */
[[noreturn]] void fail(KernelErrorCode code, const std::string& message);

/**
 * Called from a `catch (...)`: the current exception as a KernelError (toKernelError of
 * src/kernel-occt/occt.ts). A KernelFailure keeps its code; an OCCT exception (Standard_Failure)
 * or any other exception becomes Internal with `method` and its text. std::bad_alloc and
 * core::AssertionError are rethrown: running out of memory is not a kernel error (kernel.hpp)
 * and a bug is not an expected failure (N114).
 */
KernelError currentError(const std::string& method);

}  // namespace tinycad::kernel::detail
