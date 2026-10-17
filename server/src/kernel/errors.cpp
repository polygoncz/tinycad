#include "tinycad/kernel/errors.hpp"

namespace tinycad::kernel {

std::string_view kernelErrorCodeName(KernelErrorCode code) {
  switch (code) {
    case KernelErrorCode::InvalidInput:
      return "invalid-input";
    case KernelErrorCode::OperationFailed:
      return "operation-failed";
    case KernelErrorCode::UnknownHandle:
      return "unknown-handle";
    case KernelErrorCode::Internal:
      break;
  }
  return "internal";
}

}  // namespace tinycad::kernel
