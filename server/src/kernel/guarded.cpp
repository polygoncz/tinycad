#include "guarded.hpp"

#include <Standard_Failure.hxx>

#include <exception>
#include <new>

namespace tinycad::kernel::detail {

void fail(KernelErrorCode code, const std::string& message) { throw KernelFailure(code, message); }

KernelError currentError(const std::string& method) {
  try {
    throw;
  } catch (const std::bad_alloc&) {
    throw;
  } catch (const KernelFailure& e) {
    return {e.code(), e.what()};
  } catch (const Standard_Failure& e) {
    return {KernelErrorCode::Internal, method + ": " + e.ExceptionType() + ": " + e.what()};
  } catch (const std::exception& e) {
    return {KernelErrorCode::Internal, method + ": " + e.what()};
  } catch (...) {
    return {KernelErrorCode::Internal, method + ": unknown exception"};
  }
}

}  // namespace tinycad::kernel::detail
