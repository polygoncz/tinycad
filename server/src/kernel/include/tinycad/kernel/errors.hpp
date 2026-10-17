#pragma once

// Kernel errors (spec 06 "Chyby", src/kernel/errors.ts). In TS a rejected Promise with `code`;
// here the error half of KernelResult (decision N13). An OCCT exception (Standard_Failure) never
// leaves an implementation: it becomes OperationFailed or Internal per method (spec 06 Kontrakt).

#include <string>
#include <string_view>

#include "tinycad/core/result.hpp"

namespace tinycad::kernel {

enum class KernelErrorCode {
  /** The input breaks the contract of the method. */
  InvalidInput,
  /** OCCT cannot do it (a boolean without a solid, a fillet too large, no fillet center). */
  OperationFailed,
  /** A handle that was never created or is already released. */
  UnknownHandle,
  /** An unexpected failure inside the implementation. */
  Internal,
};

/** "invalid-input", "operation-failed", "unknown-handle", "internal" (the TS codes, spec 06). */
std::string_view kernelErrorCodeName(KernelErrorCode code);

struct KernelError {
  KernelErrorCode code = KernelErrorCode::Internal;
  /** Technical text for logs; never compared by tests. */
  std::string message;
};

template <class T>
using KernelResult = core::Result<T, KernelError>;

}  // namespace tinycad::kernel
